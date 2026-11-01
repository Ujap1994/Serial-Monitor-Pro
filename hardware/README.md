# Long-run test boards

Firmware and tools for the automated long-run test of Serial Monitor Pro. The test itself is
described in [docs/LONG_RUN_TEST.md](../docs/LONG_RUN_TEST.md); this page is about the boards.

## Supported boards

| Board                   | USB (VID:PID)       | FQBN                              | Notes                                                                                            |
| ----------------------- | ------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------ |
| Arduino Uno R3          | 2341:0043           | `arduino:avr:uno`                 | Restarts when the port is opened (DTR). 64-byte receive buffer – keep `maxPayload` at 32.        |
| Arduino Mega 2560 R3    | 2341:0042           | `arduino:avr:mega:cpu=atmega2560` | Like the Uno.                                                                                    |
| Arduino Nano ESP32      | 2341:0070           | `arduino:esp32:nano_nora`         | Native USB: `RESET` makes the port disappear and come back – a real reconnect test.              |
| ESP32-WROOM-32 (CP2102) | 10c4:ea60           | `esp32:esp32:esp32`               | The CP2102 reports the serial number `0001`, which other CP2102 devices share – see below.       |
| USB-RS232/485 adapter   | depends on the chip | –                                 | Not flashed: bridge RX and TX (RS232: pins 2 and 3 of the DB9) and use it with `role: loopback`. |

All boards run the same sketch, [smp-testdevice](smp-testdevice/smp-testdevice.ino), at 115200 baud
8N1. It implements protocol SMP-TD/1 exactly like the reference in
[src/shared/core/testdevice.ts](../src/shared/core/testdevice.ts), which also drives the simulated
device `sim:testdevice`.

## Preparing the boards

1. **Remove every jumper** between RX and TX (pins 0 and 1) and between RESET and GND. With a
   loopback jumper the upload fails with `not in sync: resp=0x30` (the programmer receives its own
   bytes) – and the test device would echo instead of answer.
2. Connect the boards to the computer (a powered USB hub is fine). Nothing else may be wired to the
   pins.
3. Close every other program that could use the ports (Arduino IDE serial monitor, a second
   instance of Serial Monitor Pro, PuTTY …).
4. Install [arduino-cli](https://arduino.github.io/arduino-cli/) and the cores:

   ```bash
   arduino-cli core install arduino:avr arduino:esp32
   arduino-cli config add board_manager.additional_urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
   arduino-cli core update-index && arduino-cli core install esp32:esp32
   ```

5. List the ports – this opens nothing:

   ```bash
   npm run firmware -- detect
   ```

6. Create the device list `hardware/devices.local.json` (it stays on your computer):

   ```bash
   npm run firmware -- init
   ```

   `init` adds the Arduino boards it recognises by their USB IDs. Add ESP32 boards with generic
   USB-UART chips and adapters by hand, and put every device that must never be touched on the
   `never` list (see the example below).

7. Flash and check:

   ```bash
   npm run firmware -- flash all
   npm run firmware -- check all     # every board must answer "ID SMP-TD/1 board=…"
   ```

   If an ESP32-WROOM board does not start the upload, hold its **BOOT** button while
   "Connecting…" is shown.

## Device list

```json
{
  "devices": [
    {
      "name": "uno",
      "role": "testdevice",
      "serialNumber": "4423631363535101D012",
      "fqbn": "arduino:avr:uno",
      "baudRate": 115200,
      "maxPayload": 32,
      "streamMs": 200,
      "nmeaMs": 500,
      "faultEvery": 10,
      "gapMs": 20,
      "resetEveryMin": 1
    },
    {
      "name": "esp32-wroom",
      "role": "testdevice",
      "serialNumber": "0001",
      "vendorId": "10c4",
      "productId": "ea60",
      "fqbn": "esp32:esp32:esp32",
      "baudRate": 115200,
      "maxPayload": 60
    },
    {
      "name": "rs232",
      "role": "loopback",
      "serialNumber": "<serial number of the adapter>",
      "baudRate": 115200
    }
  ],
  "never": ["<serial number of a device that must never be opened>"]
}
```

| Field                   | Meaning                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `role`                  | `testdevice` (SMP test firmware) or `loopback` (RX and TX bridged).                                   |
| `serialNumber`          | USB serial number – devices are found by it, also after re-plugging with a new port name.             |
| `vendorId`, `productId` | Narrow the match. Required when several devices share a serial number (e.g. CP2102 `0001`).           |
| `path`                  | Fixed port instead of the serial number – for devices without a unique one.                           |
| `fqbn`                  | Board for `npm run firmware -- flash`.                                                                |
| `maxPayload`            | Largest ECHO text / frame payload. 32 for Uno and Mega (64-byte receive buffer), 60 for ESP32.        |
| `streamMs`, `nmeaMs`    | Period of the sensor and NMEA streams during the terminal test.                                       |
| `faultEvery`            | Every n-th NMEA sentence gets a wrong checksum on purpose; the test checks it is reported (0 = off).  |
| `gapMs`                 | Pause between two requests – keeps the load moderate.                                                 |
| `resetEveryMin`         | Send `RESET` every n minutes (0 = never).                                                             |
| `dtr`, `rts`            | Control lines after opening (default on). Some ESP32 boards need both off to avoid the download mode. |

Only devices on this list are ever opened or flashed, and nothing whose serial number is on the
`never` list – even if it is listed. When several connected ports match an entry, the tools refuse
to guess.

## Protocol SMP-TD/1 (summary)

Text commands end with LF. Binary frames: `AA 55 <len 0…64> <payload> <CRC-16/MODBUS over len and
payload, little-endian>` → `ACK <crc>` or `NAK <expected> <received>`.

| Command       | Answer                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------ |
| `PING <n>`    | `PONG <n>`                                                                                 |
| `ECHO <text>` | `ECHO <text>` (byte for byte)                                                              |
| `ID?`         | `ID SMP-TD/1 board=<board> fw=<version> uptime=<ms>`                                       |
| `STAT?`       | Counters: received/sent bytes, lines, frames, CRC errors, streamed items, faults, free RAM |
| `CLEAR`       | `OK CLEAR` – counters to zero                                                              |
| `STREAM <ms>` | `Temp:…, Humidity:…, Pressure:…, Seq:<n>` every _ms_ (0 = off)                             |
| `NMEA <ms>`   | `$GPGGA` with the sequence number as time                                                  |
| `MODBUS <ms>` | Modbus RTU responses `01 03 04 <seq> <value> CRC`                                          |
| `FAULT <n>`   | Every n-th NMEA/Modbus item with a wrong checksum                                          |
| `BURST <n>`   | `BURST <n>`, n bytes `0, 1, 2 …`, `BURSTEND <crc>`                                         |
| `AUTO <ms>`   | Stored permanently: the sensor stream starts after every boot (used by the GUI test)       |
| `RESET`       | `OK RESET`, restart, `READY …`                                                             |
