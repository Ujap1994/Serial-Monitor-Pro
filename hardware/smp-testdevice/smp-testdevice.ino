// SMP test device – firmware for the long-run test of Serial Monitor Pro.
//
// Protocol "SMP-TD/1", identical to the reference implementation in
// src/shared/core/testdevice.ts (which also drives the simulated device
// "sim:testdevice"). Keep both in step.
//
// Boards: Arduino Uno R3, Arduino Mega 2560, Arduino Nano ESP32, ESP32-WROOM-32.
// Serial: 115200 baud 8N1 (the Nano ESP32 uses native USB; the baud rate is ignored).
//
// Text commands end with LF (CR is ignored). Binary frames start with AA 55:
//   AA 55 <len 0..64> <payload> <CRC-16/MODBUS over len+payload, little-endian>
//
//   PING <n>      -> PONG <n>
//   ECHO <text>   -> ECHO <text>
//   ID?           -> ID SMP-TD/1 board=<board> fw=<version> uptime=<ms> [boot=<reason>]
//   STAT?         -> STAT uptime=.. rxbytes=.. txbytes=.. lines=.. frames=.. crcerr=.. badframes=..
//                    errors=.. streamed=.. faults=.. dropped=.. free=<bytes of free RAM>
//   CLEAR         -> OK CLEAR
//   STREAM <ms>   -> OK STREAM <ms>, then "Temp:.., Humidity:.., Pressure:.., Seq:<n>" (0 = off)
//   NMEA <ms>     -> OK NMEA <ms>, then $GPGGA with the sequence as time (0 = off)
//   MODBUS <ms>   -> OK MODBUS <ms>, then Modbus RTU 01 03 04 <seq> <value> CRC (0 = off)
//   FAULT <n>     -> OK FAULT <n>: every n-th NMEA/Modbus item gets a wrong checksum (0 = off)
//   BURST <n>     -> "BURST <n>", n bytes (i & 0xFF), "BURSTEND <crc16 hex>"
//   AUTO <ms>     -> OK AUTO <ms>: stored permanently, the sensor stream starts after every boot (0 = off)
//   RESET         -> OK RESET, restart, READY ...
//   frame         -> ACK <crc> | NAK <expected> <received> | NAK LEN <len> | NAK TIMEOUT
//
// ESP32 boards report why they started (boot=power|reset|watchdog|panic|usb-stall|brownout|
// other) and restart by themselves when the loop hangs (task watchdog, 5 s). The Nano ESP32
// never blocks on its native USB port: output the host does not take within 100 ms is
// dropped and counted (dropped=), and a USB port that takes nothing for 10 s while the
// host holds it open restarts the board – a long run without anyone at the hub recovers.

#include <Arduino.h>
#include <math.h>

#if defined(ESP32)
#include <Esp.h>
#include <Preferences.h>
#include <esp_attr.h>
#include <esp_system.h>
#elif defined(__AVR__)
#include <EEPROM.h>
#endif

#define TD_PROTOCOL "SMP-TD/1"
#define TD_FIRMWARE "1.1"
#define TD_BAUD 115200
#define TD_MAX_FRAME 64
#define TD_MAX_LINE 120
#define TD_MAX_BURST 4096
#define TD_MIN_PERIOD 10
#define TD_FRAME_TIMEOUT 1000
#define TD_TX_WAIT 100        // ms a native USB port may take to accept output
#define TD_USB_STALL 10000    // ms without any progress while the host holds the port

// Native USB through TinyUSB (Nano ESP32): writes block while the host holds the port.
#if defined(ESP32) && ARDUINO_USB_CDC_ON_BOOT && !ARDUINO_USB_MODE
#define TD_NATIVE_USB 1
#else
#define TD_NATIVE_USB 0
#endif
#if defined(ESP32)
#define TD_TX_BUFFER 256
#else
#define TD_TX_BUFFER 64
#endif

#if defined(ARDUINO_AVR_UNO)
#define TD_BOARD "uno"
#elif defined(ARDUINO_AVR_MEGA2560)
#define TD_BOARD "mega2560"
#elif defined(ARDUINO_NANO_ESP32)
#define TD_BOARD "nano-esp32"
#elif defined(ARDUINO_ESP32_DEV)
#define TD_BOARD "esp32-wroom"
#else
#define TD_BOARD "unknown"
#endif

// ── Counters ─────────────────────────────────────────────────────────────────
struct Counters {
  uint32_t rxbytes, txbytes, lines, frames, crcerr, badframes, errors, streamed, faults, dropped;
};
static Counters counters;

static uint32_t bootTime = 0;
static uint16_t faultEvery = 0;

// ── Parser state ─────────────────────────────────────────────────────────────
static uint8_t line[TD_MAX_LINE + 1];
static uint8_t lineLength = 0;
static bool lineOverflow = false;
static bool pendingAa = false;
static bool inFrame = false;
static uint8_t frame[TD_MAX_FRAME + 3];
static uint8_t frameLength = 0;
static uint32_t frameStart = 0;

struct TdStream {
  uint32_t period, due, seq;
};
static TdStream sensorStream, nmeaStream, modbusStream;

// ── Output (counted, sent in whole lines) ────────────────────────────────────
static uint8_t txBuffer[TD_TX_BUFFER];
static size_t txLength = 0;
#if TD_NATIVE_USB
static bool txBlocked = false;  // the last write did not get through: do not wait again
#endif

static void flushOut() {
  if (!txLength) return;
#if TD_NATIVE_USB
  // USBCDC::write() spins until the host takes the data – never call it without room.
  size_t done = 0;
  uint32_t since = millis();
  while (done < txLength) {
    int room = Serial.availableForWrite();
    if (room > 0) {
      size_t n = txLength - done < (size_t)room ? txLength - done : (size_t)room;
      size_t sent = Serial.write(txBuffer + done, n);
      if (sent) {
        done += sent;
        since = millis();
        txBlocked = false;
        continue;
      }
    }
    if (txBlocked || millis() - since >= TD_TX_WAIT) {
      txBlocked = true;
      break;
    }
    delay(1);
  }
  counters.dropped += txLength - done;
#else
  Serial.write(txBuffer, txLength);
#endif
  txLength = 0;
}

static void out(const uint8_t *data, size_t n) {
  counters.txbytes += n;
  while (n) {
    size_t take = TD_TX_BUFFER - txLength < n ? TD_TX_BUFFER - txLength : n;
    memcpy(txBuffer + txLength, data, take);
    txLength += take;
    data += take;
    n -= take;
    if (txLength == TD_TX_BUFFER) flushOut();
  }
}
static void outByte(uint8_t b) { out(&b, 1); }
static void outText(const char *s) { out((const uint8_t *)s, strlen(s)); }
static void outNumber(uint32_t n) {
  char buffer[12];
  ultoa(n, buffer, 10);
  outText(buffer);
}
static void outHex4(uint16_t v) {
  char buffer[5];
  const char *digits = "0123456789ABCDEF";
  for (int i = 3; i >= 0; i--) {
    buffer[i] = digits[v & 0x0f];
    v >>= 4;
  }
  buffer[4] = 0;
  outText(buffer);
}
static void outHex2(uint8_t v) {
  const char *digits = "0123456789ABCDEF";
  outByte(digits[v >> 4]);
  outByte(digits[v & 0x0f]);
}
/** A float with a fixed number of decimals (dtostrf works on every core). */
static void outFloat(float v, uint8_t decimals) {
  char buffer[20];
  dtostrf(v, 0, decimals, buffer);
  outText(buffer);
}
static void newline() {
  outByte('\n');
  flushOut();
}

// ── Checksums ────────────────────────────────────────────────────────────────
static uint16_t crc16Update(uint16_t crc, uint8_t b) {
  crc ^= b;
  for (uint8_t i = 0; i < 8; i++) crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : crc >> 1;
  return crc;
}
static uint16_t crc16(const uint8_t *data, size_t n) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < n; i++) crc = crc16Update(crc, data[i]);
  return crc;
}

static uint32_t freeMemory() {
#if defined(ESP32)
  return ESP.getFreeHeap();
#elif defined(__AVR__)
  extern int __heap_start, *__brkval;
  int v;
  return (uint32_t)((int)&v - (__brkval == 0 ? (int)&__heap_start : (int)__brkval));
#else
  return 0;
#endif
}

static void resetState() {
  memset(&counters, 0, sizeof counters);
  faultEvery = 0;
  lineLength = 0;
  lineOverflow = false;
  pendingAa = false;
  inFrame = false;
  sensorStream = nmeaStream = modbusStream = TdStream{0, 0, 0};
}

// ── AUTO period, kept across restarts (EEPROM / NVS) ─────────────────────────
#define TD_AUTO_MAGIC 0x5D
static uint16_t loadAuto() {
#if defined(ESP32)
  Preferences prefs;
  prefs.begin("smp-td", true);
  uint16_t ms = prefs.getUShort("auto", 0);
  prefs.end();
  return ms;
#elif defined(__AVR__)
  if (EEPROM.read(0) != TD_AUTO_MAGIC) return 0;
  return EEPROM.read(1) | (uint16_t)(EEPROM.read(2) << 8);
#else
  return 0;
#endif
}
static void saveAuto(uint16_t ms) {
  if (loadAuto() == ms) return;  // spare the EEPROM
#if defined(ESP32)
  Preferences prefs;
  prefs.begin("smp-td", false);
  prefs.putUShort("auto", ms);
  prefs.end();
#elif defined(__AVR__)
  EEPROM.update(0, TD_AUTO_MAGIC);
  EEPROM.update(1, ms & 0xff);
  EEPROM.update(2, ms >> 8);
#endif
}

// ── Why the board started (ESP32) ────────────────────────────────────────────
#if defined(ESP32)
#define TD_RESTART_COMMAND 0x5D0C0001UL
#define TD_RESTART_USB_STALL 0x5D0C0002UL
// Survives a software restart, not a power cycle.
static RTC_NOINIT_ATTR uint32_t plannedRestart;
static const char *bootReason = "other";

static void readBootReason() {
  esp_reset_reason_t reason = esp_reset_reason();
  if (reason == ESP_RST_SW && plannedRestart == TD_RESTART_COMMAND) bootReason = "reset";
  else if (reason == ESP_RST_SW && plannedRestart == TD_RESTART_USB_STALL) bootReason = "usb-stall";
  else if (reason == ESP_RST_POWERON) bootReason = "power";
  else if (reason == ESP_RST_EXT) bootReason = "pin";
  else if (reason == ESP_RST_SW) bootReason = "software";
  else if (reason == ESP_RST_PANIC) bootReason = "panic";
  else if (reason == ESP_RST_INT_WDT || reason == ESP_RST_TASK_WDT || reason == ESP_RST_WDT)
    bootReason = "watchdog";
  else if (reason == ESP_RST_BROWNOUT) bootReason = "brownout";
  else bootReason = "other";
  plannedRestart = 0;
}

static void restartBecause(uint32_t why) {
  plannedRestart = why;
  delay(20);
  ESP.restart();
}
#endif

static void outBootReason() {
#if defined(ESP32)
  outText(" boot=");
  outText(bootReason);
#endif
}

static void ready() {
  outText("READY " TD_PROTOCOL " board=" TD_BOARD " fw=" TD_FIRMWARE);
  outBootReason();
  newline();
  uint16_t autoMs = loadAuto();
  if (autoMs) {
    sensorStream.period = autoMs < TD_MIN_PERIOD ? TD_MIN_PERIOD : autoMs;
    sensorStream.due = millis() + sensorStream.period;
  }
}

// ── Commands ─────────────────────────────────────────────────────────────────
static bool wordIs(const char *word, const char *expected) { return strcmp(word, expected) == 0; }

static long parseNumber(const uint8_t *s, uint8_t n, bool &ok) {
  long v = 0;
  ok = n > 0;
  for (uint8_t i = 0; i < n; i++) {
    if (s[i] < '0' || s[i] > '9' || v > 100000000L) {
      ok = false;
      return 0;
    }
    v = v * 10 + (s[i] - '0');
  }
  return v;
}

static void setStream(TdStream &stream, const uint8_t *arg, uint8_t argLength, const char *word) {
  bool ok;
  long ms = parseNumber(arg, argLength, ok);
  if (!ok) {
    counters.errors++;
    outText("ERR ARG ");
    outText(word);
    newline();
    return;
  }
  stream.period = ms == 0 ? 0 : (ms < TD_MIN_PERIOD ? TD_MIN_PERIOD : (uint32_t)ms);
  stream.due = millis() + stream.period;
  outText("OK ");
  outText(word);
  outByte(' ');
  outNumber(stream.period);
  newline();
}

static void restart() {
  flushOut();
  Serial.flush();
#if defined(ESP32)
  restartBecause(TD_RESTART_COMMAND);
#else
  delay(20);
  // AVR: start the program again (state reset below, the hardware stays as it is).
  resetState();
  bootTime = millis();
  ready();
#endif
}

static void command() {
  counters.lines++;
  // Split "WORD arg"; the word is ASCII, the argument stays raw for ECHO.
  uint8_t space = 0;
  while (space < lineLength && line[space] != ' ') space++;
  char word[12];
  uint8_t wordLength = 0;
  for (uint8_t i = 0; i < space && wordLength < sizeof word - 1; i++) {
    uint8_t c = line[i];
    if (c >= 'a' && c <= 'z') c -= 32;
    word[wordLength++] = (char)c;
  }
  word[wordLength] = 0;
  if (!wordLength) return;
  const uint8_t *arg = space < lineLength ? line + space + 1 : line + lineLength;
  uint8_t argLength = space < lineLength ? lineLength - space - 1 : 0;
  // Trimmed copy of the argument for numbers.
  uint8_t start = 0, end = argLength;
  while (start < end && arg[start] == ' ') start++;
  while (end > start && arg[end - 1] == ' ') end--;

  if (wordIs(word, "PING")) {
    outText("PONG ");
    out(arg + start, end - start);
    newline();
  } else if (wordIs(word, "ECHO")) {
    outText("ECHO ");
    out(arg, argLength);
    newline();
  } else if (wordIs(word, "ID?")) {
    outText("ID " TD_PROTOCOL " board=" TD_BOARD " fw=" TD_FIRMWARE " uptime=");
    outNumber(millis() - bootTime);
    outBootReason();
    newline();
  } else if (wordIs(word, "STAT?")) {
    outText("STAT uptime=");
    outNumber(millis() - bootTime);
    outText(" rxbytes=");
    outNumber(counters.rxbytes);
    outText(" txbytes=");
    outNumber(counters.txbytes);
    outText(" lines=");
    outNumber(counters.lines);
    outText(" frames=");
    outNumber(counters.frames);
    outText(" crcerr=");
    outNumber(counters.crcerr);
    outText(" badframes=");
    outNumber(counters.badframes);
    outText(" errors=");
    outNumber(counters.errors);
    outText(" streamed=");
    outNumber(counters.streamed);
    outText(" faults=");
    outNumber(counters.faults);
    outText(" dropped=");
    outNumber(counters.dropped);
    outText(" free=");
    outNumber(freeMemory());
    newline();
  } else if (wordIs(word, "CLEAR")) {
    memset(&counters, 0, sizeof counters);
    outText("OK CLEAR");
    newline();
  } else if (wordIs(word, "STREAM")) {
    setStream(sensorStream, arg + start, end - start, "STREAM");
  } else if (wordIs(word, "NMEA")) {
    setStream(nmeaStream, arg + start, end - start, "NMEA");
  } else if (wordIs(word, "MODBUS")) {
    setStream(modbusStream, arg + start, end - start, "MODBUS");
  } else if (wordIs(word, "FAULT")) {
    bool ok;
    long n = parseNumber(arg + start, end - start, ok);
    faultEvery = ok && n > 0 && n < 65536 ? (uint16_t)n : 0;
    outText("OK FAULT ");
    outNumber(faultEvery);
    newline();
  } else if (wordIs(word, "BURST")) {
    bool ok;
    long n = parseNumber(arg + start, end - start, ok);
    if (!ok || n < 1 || n > TD_MAX_BURST) {
      counters.errors++;
      outText("ERR ARG BURST");
      newline();
      return;
    }
    outText("BURST ");
    outNumber((uint32_t)n);
    newline();
    uint16_t crc = 0xFFFF;
    for (long i = 0; i < n; i++) {
      uint8_t b = (uint8_t)(i & 0xff);
      crc = crc16Update(crc, b);
      outByte(b);
    }
    flushOut();
    outText("BURSTEND ");
    outHex4(crc);
    newline();
  } else if (wordIs(word, "AUTO")) {
    bool ok;
    long n = parseNumber(arg + start, end - start, ok);
    uint16_t ms = 0;
    if (ok && n > 0) ms = n < TD_MIN_PERIOD ? TD_MIN_PERIOD : (n > 60000 ? 60000 : (uint16_t)n);
    saveAuto(ms);
    outText("OK AUTO ");
    outNumber(ms);
    newline();
  } else if (wordIs(word, "RESET")) {
    outText("OK RESET");
    newline();
    restart();
  } else {
    counters.errors++;
    outText("ERR UNKNOWN ");
    outText(word);
    newline();
  }
}

static void finishFrame() {
  uint8_t len = frame[0];
  uint16_t expected = crc16(frame, len + 1);
  uint16_t received = frame[len + 1] | (uint16_t)(frame[len + 2] << 8);
  if (expected == received) {
    counters.frames++;
    outText("ACK ");
    outHex4(expected);
  } else {
    counters.crcerr++;
    outText("NAK ");
    outHex4(expected);
    outByte(' ');
    outHex4(received);
  }
  newline();
}

static void receive(uint8_t b) {
  counters.rxbytes++;
  if (inFrame) {
    frame[frameLength++] = b;
    if (frameLength == 1 && frame[0] > TD_MAX_FRAME) {
      counters.badframes++;
      outText("NAK LEN ");
      outNumber(frame[0]);
      newline();
      inFrame = false;
    } else if (frameLength == frame[0] + 3) {
      finishFrame();
      inFrame = false;
    }
    return;
  }
  if (pendingAa) {
    pendingAa = false;
    if (b == 0x55) {
      inFrame = true;
      frameLength = 0;
      frameStart = millis();
      return;
    }
    counters.errors++;
  }
  if (b == 0xAA && lineLength == 0) {
    pendingAa = true;
    return;
  }
  if (b == '\r') return;
  if (b == '\n') {
    if (lineOverflow) {
      counters.errors++;
      outText("ERR LONG");
      newline();
    } else {
      command();
    }
    lineLength = 0;
    lineOverflow = false;
    return;
  }
  if (lineLength >= TD_MAX_LINE) lineOverflow = true;
  else line[lineLength++] = b;
}

// ── Streams ──────────────────────────────────────────────────────────────────
static bool due(TdStream &s, uint32_t now) {
  if (!s.period || (int32_t)(now - s.due) < 0) return false;
  s.due = (now - s.due > 10 * s.period) ? now + s.period : s.due + s.period;
  s.seq++;
  counters.streamed++;
  return true;
}

static void sensorItem(uint32_t seq) {
  outText("Temp:");
  outFloat(23.5 + 1.8 * sin(seq / 8.0), 2);
  outText(", Humidity:");
  outFloat(45.0 + 6.0 * cos(seq / 13.6), 1);
  outText(", Pressure:");
  outFloat(1013.2 + 2.5 * sin(seq / 24.8), 1);
  outText(", Seq:");
  outNumber(seq);
  newline();
}

static void nmeaItem(uint32_t seq, bool fault) {
  char body[80];
  char time[7];
  uint32_t t = seq % 1000000UL;
  for (int i = 5; i >= 0; i--) {
    time[i] = '0' + (t % 10);
    t /= 10;
  }
  time[6] = 0;
  snprintf(body, sizeof body, "GPGGA,%s,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,", time);
  uint8_t cs = 0;
  for (const char *p = body; *p; p++) cs ^= (uint8_t)*p;
  if (fault) cs ^= 0xFF;
  outByte('$');
  outText(body);
  outByte('*');
  outHex2(cs);
  newline();
}

static void modbusItem(uint32_t seq, bool fault) {
  uint16_t s = (uint16_t)seq;
  uint16_t value = (uint16_t)(seq * 7);
  uint8_t f[9] = {0x01, 0x03, 0x04, (uint8_t)(s >> 8), (uint8_t)s, (uint8_t)(value >> 8), (uint8_t)value, 0, 0};
  uint16_t crc = crc16(f, 7);
  if (fault) crc ^= 0xFFFF;
  f[7] = crc & 0xff;
  f[8] = crc >> 8;
  out(f, 9);
}

#if TD_NATIVE_USB
// A host that holds the port (DTR and RTS set) but receives nothing for 10 s:
// the USB stack is stuck. Only a restart helps – nobody is at the hub.
static bool stalled = false;
static uint32_t stallSince = 0;
static void watchUsb(uint32_t now) {
  if (Serial && Serial.availableForWrite() == 0) {
    if (!stalled) {
      stalled = true;
      stallSince = now;
    } else if ((int32_t)(now - stallSince) > TD_USB_STALL) {
      restartBecause(TD_RESTART_USB_STALL);
    }
  } else {
    stalled = false;
  }
}
#endif

void setup() {
#if defined(ESP32)
  readBootReason();
#endif
#if TD_NATIVE_USB
  // DTR/RTS sequences and 1200 baud would jump into the ROM bootloader; uploads
  // use DFU, so a test run toggling the lines must not stop the firmware.
  Serial.enableReboot(false);
#endif
  Serial.begin(TD_BAUD);
  resetState();
  bootTime = millis();
  // Native USB (Nano ESP32): give the host a moment to open the port.
#if defined(ARDUINO_NANO_ESP32)
  uint32_t wait = millis();
  while (!Serial && millis() - wait < 1500) delay(10);
#endif
  ready();
#if defined(ESP32)
  enableLoopWDT();  // a hanging loop restarts the board after 5 s
#endif
}

void loop() {
  int budget = 128;  // keep streams and timeouts going under heavy input
  while (Serial.available() > 0 && budget-- > 0) receive((uint8_t)Serial.read());

  uint32_t now = millis();
  if (inFrame && now - frameStart > TD_FRAME_TIMEOUT) {
    inFrame = false;
    counters.badframes++;
    outText("NAK TIMEOUT");
    newline();
  }
  if (due(sensorStream, now)) sensorItem(sensorStream.seq);
  if (due(nmeaStream, now)) {
    bool fault = faultEvery && nmeaStream.seq % faultEvery == 0;
    if (fault) counters.faults++;
    nmeaItem(nmeaStream.seq, fault);
  }
  if (due(modbusStream, now)) {
    bool fault = faultEvery && modbusStream.seq % faultEvery == 0;
    if (fault) counters.faults++;
    modbusItem(modbusStream.seq, fault);
  }
  flushOut();  // Modbus frames have no line end
#if TD_NATIVE_USB
  watchUsb(now);
#endif
}
