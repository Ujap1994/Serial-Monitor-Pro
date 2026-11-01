# Automated long-run test

The long-run test runs Serial Monitor Pro for hours or days against real boards and checks every
byte. It complements the manual [checklist](LONG_RUN_TEST_CHECKLIST.md): what can be measured
automatically is measured here. How to prepare the boards: [hardware/README.md](../hardware/README.md).

## Start

```bash
npm run longrun
```

The starter asks for:

1. **Duration in minutes** (per test).
2. **What should run:**
   - **Terminal** – the serial layer of the application (`SerialManager`) without a window, all
     devices in parallel. Fast and exact: every request has exactly one correct answer.
   - **GUI** – the real application, visible, as a user would use it (see below).
   - **Both** – first the terminal test, then the GUI test, each for the duration.
3. **Devices or simulator** – the boards of `hardware/devices.local.json`, or the simulated test
   device `sim:testdevice` (useful to try the test itself).

Before a run with devices, every board is asked for its identity; missing boards are reported. On
macOS the computer is kept awake for the whole run (`caffeinate`). Without questions:

```bash
npm run longrun -- --minutes 480 --mode both --devices --yes
```

The underlying commands can also be called directly: `SMP_SOAK_MINUTES=60 SMP_SOAK_DEVICES=1 npm run soak`
(terminal) and `… npm run soak:gui` (GUI).

## Terminal test

Every board gets a mix of requests, one at a time with a short pause:

| Request                  | Checked                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `PING <n>`               | The answer `PONG <n>` and the round-trip time.                                                                                                  |
| CRC frame `AA 55 …`      | The **device** recalculates the CRC and answers `ACK` – every 100th frame is damaged on purpose and must be rejected (`NAK`).                   |
| `ECHO <random text>`     | The text comes back byte for byte.                                                                                                              |
| `BURST <64…1024>`        | Every byte of the burst and its CRC.                                                                                                            |
| `STAT?` (every 30 s)     | The device's own frame and CRC-error counters must equal what was sent.                                                                         |
| Restarts (as configured) | Firmware `RESET`, closing and reopening the port, a DTR or RTS reset – see _Unattended restarts_.                                               |
| Sensor and NMEA streams  | Running in the background the whole time: no sequence number may be missing; NMEA checksums are verified (intentional faults must be reported). |

A loopback adapter (RX and TX bridged) first gets a short probe. Only if it comes back unchanged
does the adapter get numbered blocks with a CRC that must come back unchanged as well; otherwise
nothing more is sent to that port – it might be a real device. If a device disappears (hub switch,
re-enumeration), the test finds it again by its serial number and records the reconnection and the
downtime. A device that does not answer after reconnecting is tried less and less often (1 s up to
30 s).

**Passed** when no answer was missing or changed, no valid frame was rejected and no damaged one
accepted, no stream item went missing, every burst was complete, the device counters match, the
device never had to drop output (the port was always read) and no device restarted without being
asked.

## Unattended restarts

Long runs cannot rely on someone at the hub switches, so the test restarts the boards itself – each
kind every few minutes, as set per device in `hardware/devices.local.json`:

| Setting                           | What happens                                                                                      | Boards                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `resetEveryMin`                   | The firmware command `RESET`.                                                                     | All; the Nano ESP32 leaves USB and comes back – a real reconnect. |
| `reopenEveryMin`                  | The port is closed and opened again, as a user would.                                             | All; Uno and Mega restart on open.                                |
| `lineReset` + `lineResetEveryMin` | `dtr`: a DTR pulse (reset capacitor of Uno and Mega); `rts`: RTS pulls EN low (ESP32 auto-reset). | Uno, Mega (`dtr`), ESP32-WROOM (`rts`); not the Nano ESP32.       |

After every restart the device must answer again and is set up from scratch; the report counts each
kind. A restart nobody asked for is reported as **unplanned** – with the reason the ESP32 boards
give (`boot=watchdog`, `panic`, `usb-stall` …). A restart after the connection was lost and the
board started from power (hub switch, unplugged) is noted, but not counted as a failure.

The ESP32 test firmware recovers by itself instead of hanging until someone pulls the plug: a loop
that hangs for 5 s restarts the board (task watchdog), and on the Nano ESP32 a USB port that takes
nothing for 10 s while the host holds it open restarts it as well. Such a restart is always
reported as unplanned, so it never goes unnoticed.

## GUI test

The application is started with a fresh profile and used like this, all at once:

- **Monitor:** connected to the first test device; _Add CRC_ and _Header_ `AA 55` on, the frame
  `03 11 22 33` is sent **periodically** every 250 ms. The device checks every frame.
- **Graph:** records the sensor stream of that device. **Protocol decoder:** decodes its NMEA stream live.
- **Multi-port:** the other boards stream into the slots (they were set to `AUTO 100` before the
  start and are reset to `AUTO 0` afterwards), shown one panel per port.
- **Multi-port bridge:** a loopback adapter of the device list (an RS232 adapter with pins 2 and 3
  bridged; simulator: `sim:loopback`) takes the last slot after its probe came back unchanged. The
  bridge forwards the stream of the first slot to it in one direction; the adapter sends everything
  back. At the end the first slot is disconnected and the test compares: every forwarded byte must
  have come back (adapter TX = forwarded = adapter RX), and the last lines in the adapter's panel
  must equal those of the source.
- **Automation:** a trigger watches for `NAK` (rejected frames), the scheduler asks for `STAT?`
  every minute.
- Every two seconds the test switches tabs; every minute it records the working set of the main,
  renderer and GPU processes, the JavaScript heap of the window, the number of DOM nodes (in total
  and per tab), the time of a tab change, the byte counters and the bytes forwarded by the bridge.
- With `SMP_SOAK_PROFILE=1` the window's CPU time of minutes 2–3 is profiled; the report lists the
  functions that used the most time (`soak-reports/renderer.cpuprofile` opens in Chrome DevTools).

**Passed** when the device rejected no frame, accepted at least 90 % of the frames the period allows,
the trigger never fired, every byte through the bridge came back unchanged and the renderer reported
no error. A window that stops reacting fails the run as well: every tab change must finish within
30 seconds.

This test found a real problem before 1.4.0: the outputs of multi-port, automation, stop condition
and frame parser scrolled to the newest line after **every** line, which made the browser lay out
the whole output each time. Under full load (four boards, bridge, graph, decoder, periodic sending)
the window used 27 of every 60 seconds for that, grew to 1.3 GB and stopped reacting after about
five minutes. Now the outputs scroll at most once per frame and keep their lines in blocks the
browser can skip; the same run uses about 380 MB and the window is idle most of the time.

## Reports

Every run writes `soak-reports/<date-time>[-gui]/`:

- `report.md` – the verdict, a table per device (requests, timeouts, changed answers, stream lines,
  gaps, bursts, restarts by kind – RESET / reopen / line / unplanned –, reconnects, downtime,
  latency p50/p95/p99/max) and the last notes per device, including the device's own counters.
- `report.json` – everything, for comparisons between runs.
- `memory.csv` / `samples.csv` – memory over time, for spotting leaks.

## Device sessions as replay tests

The boards of the device list also provide the test data for the automated build: a fixed script
(identity, ping, echo with UTF-8, a valid and a damaged CRC frame, sensor, NMEA and Modbus streams,
a burst, statistics, an unknown command; the ESP32-WROOM is restarted to keep its boot messages) is
recorded with the session capture of the application:

```bash
SMP_RECORD_FIXTURES=1 npm run soak -- record-fixtures
```

The captures go to `tests/fixtures/captures/<device>.smpcap` without port names.
`tests/unit/capture-fixtures.test.ts` replays them in every build: the application's NMEA and Modbus
decoders and CRC calculation must accept what the real firmware sent, and every capture, replayed as
a device, must give exactly the recorded answers. Record them again after changing the firmware.

## Recommended sequence

1. `npm run longrun` with the **simulator** for a few minutes – checks the test itself.
2. 10 minutes with the boards – check the latencies and that every board passes.
3. 2 hours, then overnight (e.g. 480 minutes, mode _both_), then a weekend.
4. Physical reconnects (optional, the test restarts the boards by itself): switch a port of the
   hub off and on during the terminal test; the report shows the reconnection and the downtime.

## Known limits

- The ATmega16U2 USB chip of Uno and Mega has small buffers; sustained traffic far above the paced
  test load can lose bytes in the adapter rather than in the application. The test paces its
  requests for that reason.
- ESP32 boards print their boot messages at 74880 baud after a restart; they are ignored while a
  device is being set up.
- Build the Nano ESP32 firmware with the Espressif core (`esp32:esp32:nano_nora`, 3.x). With the
  older Arduino core (`arduino:esp32`, 2.0.x) its USB stack stopped sending after a restart or a
  reopen of the port – in a long run that meant a board that only came back after a power cycle.
- The tests measure the application on this computer; they do not certify a device.
- Only configured devices are opened. Never add measuring equipment or other production devices to
  the device list.

The simulator-only parts run in every CI build (`tests/unit/soak-runner.test.ts`), so the test
program itself stays correct.
