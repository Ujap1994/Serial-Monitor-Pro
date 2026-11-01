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

| Request                 | Checked                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `PING <n>`              | The answer `PONG <n>` and the round-trip time.                                                                                                  |
| CRC frame `AA 55 …`     | The **device** recalculates the CRC and answers `ACK` – every 100th frame is damaged on purpose and must be rejected (`NAK`).                   |
| `ECHO <random text>`    | The text comes back byte for byte.                                                                                                              |
| `BURST <64…1024>`       | Every byte of the burst and its CRC.                                                                                                            |
| `STAT?` (every 30 s)    | The device's own frame and CRC-error counters must equal what was sent.                                                                         |
| `RESET` (as configured) | The device restarts and is set up again; Nano ESP32 boards re-enumerate on USB.                                                                 |
| Sensor and NMEA streams | Running in the background the whole time: no sequence number may be missing; NMEA checksums are verified (intentional faults must be reported). |

A loopback adapter gets numbered blocks with a CRC that must come back unchanged. If a device
disappears (hub switch, re-enumeration), the test finds it again by its serial number and records
the reconnection and the downtime.

**Passed** when no answer was missing or changed, no valid frame was rejected and no damaged one
accepted, no stream item went missing, every burst was complete, the device counters match and no
unexpected reboot happened.

## GUI test

The application is started with a fresh profile and used like this, all at once:

- **Monitor:** connected to the first test device; _Add CRC_ and _Header_ `AA 55` on, the frame
  `03 11 22 33` is sent **periodically** every 250 ms. The device checks every frame.
- **Graph:** records the sensor stream of that device. **Protocol decoder:** decodes its NMEA stream live.
- **Multi-port:** the other boards stream into the slots (they were set to `AUTO 100` before the
  start and are reset to `AUTO 0` afterwards).
- **Automation:** a trigger watches for `NAK` (rejected frames), the scheduler asks for `STAT?`
  every minute.
- Every two seconds the test switches tabs; every minute it records the working set of the main,
  renderer and GPU processes, the number of DOM nodes, the time of a tab change and the byte counters.

**Passed** when the device rejected no frame, accepted at least 90 % of the frames the period allows,
the trigger never fired and the renderer reported no error.

## Reports

Every run writes `soak-reports/<date-time>[-gui]/`:

- `report.md` – the verdict, a table per device (requests, timeouts, changed answers, stream lines,
  gaps, bursts, reconnects, downtime, latency p50/p95/p99/max) and the last notes per device.
- `report.json` – everything, for comparisons between runs.
- `memory.csv` / `samples.csv` – memory over time, for spotting leaks.

## Recommended sequence

1. `npm run longrun` with the **simulator** for a few minutes – checks the test itself.
2. 10 minutes with the boards – check the latencies and that every board passes.
3. 2 hours, then overnight (e.g. 480 minutes, mode _both_), then a weekend.
4. Physical reconnects: switch a port of the hub off and on during the terminal test; the report
   shows the reconnection and the downtime.

## Known limits

- The ATmega16U2 USB chip of Uno and Mega has small buffers; sustained traffic far above the paced
  test load can lose bytes in the adapter rather than in the application. The test paces its
  requests for that reason.
- ESP32 boards print their boot messages at 74880 baud after a restart; they are ignored while a
  device is being set up.
- The tests measure the application on this computer; they do not certify a device.
- Only configured devices are opened. Never add measuring equipment or other production devices to
  the device list.

The simulator-only parts run in every CI build (`tests/unit/soak-runner.test.ts`), so the test
program itself stays correct.
