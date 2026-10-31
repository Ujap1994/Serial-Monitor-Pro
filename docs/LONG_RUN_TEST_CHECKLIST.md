# Long-run and acceptance test checklist

Serial Monitor Pro is open-source software and may contain errors or bugs. Run this checklist on a
test setup before relying on it in a production measurement workflow. This document is a procedure;
unchecked items are **not** evidence that a test has passed.

## Record the setup

- [ ] Record version/commit, OS and architecture, package type, Electron version and start time.
- [ ] Record adapter model/firmware, driver version, baud, data/parity/stop bits and flow control.
- [ ] Use an isolated application profile and a dedicated, identified test device. Do not use another
      application's active measurement port. Record the device privately; anonymize published data.
- [ ] Begin with simulators. Only after they pass, use the specifically approved physical device.
- [ ] For an Uno R3 echo test, verify the intended loopback wiring with the device owner: TX–RX and
      RESET–GND. An Uno loopback does not validate external RTS/CTS handshaking.

## Short acceptance pass (about 20–30 minutes)

- [ ] Start twice: the second launch focuses the existing window and leaves only one active instance.
- [ ] Switch English/German and light/dark; verify controls at 1024×640 and larger windows.
- [ ] Connect `sim:loopback`; send HEX, ASCII, DEC and BIN; compare TX/RX exact bytes and counters.
- [ ] CRC-16/MODBUS, `01 03 00 00 00 0A`: verify little-endian `C5 CD`, big-endian `CD C5`.
- [ ] Verify positions `0`, `1`, `-1`, `-2` against the README table (Python slicing); confirm
      insertion adds bytes and out-of-range positions block sending by both button and Enter.
- [ ] Monitor header/footer: ticked header and footer are added around the input in the send format;
      verify _Include header/footer in CRC_ independently against a reference calculation.
- [ ] Turn _Add CRC_, header and footer off: the original bytes must be sent unchanged. Confirm that a
      separate newline is appended only once and outside CRC coverage. Commands without _Append CRC_
      stay unchanged; commands with it get the CRC but never the Monitor header/footer.
- [ ] Restart: algorithm, byte order, position, header/footer texts, all checkboxes and the periodic
      interval must persist.
- [ ] Periodic sending (Monitor input and a preset) at 100 ms for 5 minutes: count TX lines against
      elapsed time; stop by button and by disconnect.
- [ ] Triggers: text, HEX and regex patterns with a cooldown against the loopback device – no echo
      loop. Scheduler: two schedules with different intervals, count sends. Both stay off after restart.
- [ ] Record a macro of three manual sends, stop recording, run the sequence and compare the bytes.
- [ ] Stop condition actions: _pause receiving_ freezes the display and _Resume display_ continues;
      _pause and save log_ writes a complete CSV into `Documents/Serial Monitor Pro`.
- [ ] Multi-port bridge in one and both directions between two simulator slots; compare counters.
- [ ] Send a known binary file and compare the received bytes/hash. Test line mode with LF, CRLF,
      empty lines, a long line, and a final line without LF; no implicit CRC/newline is allowed.
- [ ] Cancel during a long pause, then while the test device pauses transmission through supported
      flow control. The port must disconnect; already queued bytes may still reach the device.
- [ ] Run a send/expect sequence with immediate replies and with intentional timeouts.
- [ ] Check the update notice against a controlled feed containing several newer versions; verify
      cumulative notes, draft/prerelease exclusion, skip behaviour and an offline error.

## Simulator soak (minimum 2 hours; then overnight)

- [ ] Run the sensor/GPS/binary-frame simulators, graph recording and Multi-Port monitoring together.
- [ ] Enable file logging to a disk with sufficient free space. Set a bounded Monitor line limit.
- [ ] Every 15 minutes record elapsed time, process RSS, CPU, RX/TX counts, log size, visible errors
      and responsiveness. Expect memory to fluctuate; investigate sustained growth after warm-up.
- [ ] Toggle display format, timestamps, filtering and tabs under load. Minimize/restore repeatedly.
- [ ] Confirm the deliberately corrupt frame every seventh simulator telegram is still reported.
- [ ] Stop recording, save/export and verify the final complete log/CSV. Close normally; no hidden
      process or open port should remain. Immediately relaunch and verify settings.

## Physical-device soak (after simulator acceptance)

- [ ] Agree on a realistic payload, packet interval and expected response with the device owner.
      Start at a conservative baud/rate; measure before increasing either. Avoid random commands.
- [ ] Transmit numbered, checksummed packets for 30 minutes, then 2 hours, then an agreed overnight
      period. Compare exact payloads, missing/duplicate/out-of-order sequence numbers and CRC errors.
- [ ] Separately test paced packets and sustained streams. Record both outcomes; do not infer a
      universal baud ceiling or adapter-buffer size from one run.
- [ ] For supported adapters, verify RTS/CTS and XON/XOFF pause/resume with a suitable peer or logic
      analyzer; confirm binary payload restrictions for software flow control.
- [ ] Measure actual DTR/RTS changes and opening/reset behaviour. Do not infer line voltage from UI
      state or a successful API return. Check CTS/DSR/DCD where the adapter exposes them.
- [ ] Unplug/replug only the test device; test reconnect, manual disconnect, device reset, sleep/wake
      and busy-port errors. Confirm no unintended automatic transmission after reconnect.
- [ ] With the device owner's agreement only: periodic sending, a trigger and a schedule at intervals
      the device is known to tolerate; measure response times before shortening any interval.
- [ ] Cancel a file transfer under backpressure and verify the application recovers. Record partial
      data received; cancellation cannot retract bytes already queued in hardware.

## Pass/fail record

| Item                                          | Observation |
| --------------------------------------------- | ----------- |
| Build / platform / package                    |             |
| Device and driver (private record)            |             |
| Duration / baud / payload / pacing            |             |
| Sent / received / missing / duplicate packets |             |
| CRC or byte mismatches                        |             |
| RSS at start / warm-up / end; maximum CPU     |             |
| Disconnect/reconnect and cancellation results |             |
| Logs / anonymized replay fixture references   |             |
| Pass / fail / unresolved issue links          |             |

Pass requires no unexplained byte mismatch, loss, duplication or hang at the agreed workload,
successful reconnect/cancel/exit, and no sustained unbounded memory growth. Hardware limitations
must be documented with the tested rate and pacing; lower the supported workload and rerun rather
than masking losses. File a reproducible issue for every failure and add a replay or regression test.
