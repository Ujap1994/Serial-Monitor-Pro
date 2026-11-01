# Development status, Python parity and CLI assessment

Serial Monitor Pro is open-source software and may contain errors or bugs. Tests reduce risk;
they do not certify the application or a connected device. This document describes the state of
version 1.2.0 (2026-11-01).

## Python-to-TypeScript parity

The TypeScript application was first migrated from the PySide6 edition of the former Python program.
That edition was only stage 1 of a migration (monitor, connection, quick commands); the complete
feature set lived in the CustomTkinter edition (`serial_monitor_full.py`, v3.5). For 1.1.0 and 1.2.0 the
CustomTkinter source was compared screen by screen with this repository. The table lists every
function of that edition and its state here.

| Area                | Function of the Python (CustomTkinter) edition                                                    | State in 1.1.0                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Monitor             | ASCII/HEX/DEC/BIN, timestamp, auto-scroll, UTF-8, control characters, line break, clear, CSV/TXT  | ✅ (plus Δt, hex dump, filter, log to file)                                                                                                                  |
| Monitor send        | Send format, TX history, line end                                                                 | ✅                                                                                                                                                           |
| Monitor send        | **Add CRC**, **Header**, **Footer** checkboxes with header/footer fields                          | ✅ restored in 1.1.0 – same packet order: header + data (CRC at position) + footer + line end                                                                |
| Monitor send        | **Periodic (ms)** start/stop                                                                      | ✅ restored in 1.1.0                                                                                                                                         |
| CRC tools           | Transmit settings: method, byte order, append / insert at index (negative index = from the right) | ✅ one signed position (`0` = append, Python slicing for other values)                                                                                       |
| CRC tools           | Include header / footer in CRC                                                                    | ✅ restored in 1.1.0                                                                                                                                         |
| CRC tools           | CRC parameters, note on byte order, separate calculator (format, method, byte order, HEX/DEC/BIN) | ✅ (plus compare-all and check vector)                                                                                                                       |
| Presets             | Name, format, data, description, periodic interval, **add CRC**, import/export                    | ✅ restored in 1.1.0                                                                                                                                         |
| Presets             | Sequence mode (a preset with several steps and pauses)                                            | ✅ restored in 1.2.0 – steps with format, data and pause; Python sequence presets are imported with their steps                                              |
| Quick presets panel | Send, periodic, edit                                                                              | ✅ send; periodic and edit on the Presets tab                                                                                                                |
| Stop condition      | Byte sequence, actions _pause receiving_, _log only_, _log all incl. stop condition_              | ✅ restored in 1.1.0 (plus byte, line and time limits and disconnect); the capture is saved to `Documents/Serial Monitor Pro` instead of the Python log path |
| Graph               | Live plot, pause, clear, max points, autoscale, export, statistics (min/max/avg/std/median/range) | ✅ statistics table and CSV export restored in 1.1.0                                                                                                         |
| Graph               | Per-channel regular expressions and colour choice                                                 | ✅ restored in 1.2.0 – detection mode _own patterns_ plus a colour picker for every curve                                                                    |
| Protocol decoder    | Modbus RTU, **Modbus ASCII**, NMEA; show invalid; statistics; export                              | ✅ Modbus ASCII, statistics, filter and export restored in 1.1.0                                                                                             |
| Protocol decoder    | Separate packet-details pane                                                                      | ✅ restored in 1.2.0 – packet list with a details pane                                                                                                       |
| Automation          | Macro recording/playback, triggers (regex → response), scheduler, statistics                      | ✅ restored in 1.1.0; macros become sequence steps, triggers also match text/HEX and have a cooldown                                                         |
| Multi-port          | Port slots, connect/disconnect, RX/TX statistics, **bridge mode** (one or both directions)        | ✅ restored in 1.1.0                                                                                                                                         |
| Multi-port          | Separate view per port                                                                            | ✅ restored in 1.2.0 – combined or one panel per port                                                                                                        |
| Send table          | Commands with pauses, loop                                                                        | ✅                                                                                                                                                           |
| Frame parser        | Header, length field, CRC, footer, statistics                                                     | ✅                                                                                                                                                           |
| Settings            | Language, theme                                                                                   | ✅                                                                                                                                                           |
| Settings            | Configurable presets and log paths                                                                | ✅ restored in 1.2.0 – folder for commands/sequences and for logs/exports                                                                                    |
| Legacy data         | Settings, presets, automation                                                                     | ✅ including CRC/header/footer/periodic settings from `serial_monitor_settings.json`                                                                         |
| Licensing           | Licence manager, licence server, admin tools                                                      | ➖ intentionally not migrated – the application is MIT-licensed                                                                                              |
| Build tools         | Build studio, installer builder, NSIS/deb/flatpak scripts                                         | ➖ replaced by electron-builder and GitHub Actions                                                                                                           |

✅ available · ➖ intentionally not migrated – no function of the CustomTkinter edition is missing any more

## Recommended order of remaining work

| Priority | Work                                 | Reason                                                                                                                                                                                | Completion criterion                                                                                                                      |
| -------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Long-run and hardware acceptance     | Simulators and mock drivers cannot measure a real adapter's buffers, flow signals or reset behaviour – including periodic sending, triggers and the bridge with real devices.         | Complete the [test checklist](LONG_RUN_TEST_CHECKLIST.md) with measured rates, loss counts, memory trend and a saved report.              |
| 2        | Raw capture and deterministic replay | TXT/CSV export and simulated tests exist; there is no timestamped binary session format and replay runner.                                                                            | Versioned capture with exact bytes, direction and timing; anonymized hardware fixtures replayed in CI.                                    |
| 3        | Small, headless CLI                  | See below.                                                                                                                                                                            | Offline commands first, with a documented exit-code contract.                                                                             |
| 4        | Distribution assurance               | Native runtime tests cover the host architecture; cross-built Windows ARM and Linux ARM archives do not all receive an install/run test. Signing/notarization credentials are absent. | Real/native-VM smoke tests per supported package; optional signed Windows and notarized macOS distribution when credentials are supplied. |

## CLI recommendation

A command-line interface is **worth having, in a small form**. It is useful for test benches, CI
fixtures and scripted byte verification – for example to compute the exact CRC packet a test script
must send, or to decode a captured telegram in a pipeline. It should be a small Node.js entry point
that reuses `src/shared/core` (the same CRC, framing and decoder code the application uses), not a
second implementation, and not a replacement for the desktop application. No CLI is part of 1.2.0.

Suggested staged interface (design examples, **not available commands**):

```text
smp crc --algorithm CRC-16/MODBUS --hex "01 03 00 00 00 0A" --endian little --position 0 --json
smp frame --hex "31 32 33" --header "AA 55" --footer "0D" --crc CRC-16/MODBUS --include-header
smp decode --protocol modbus-ascii ":01030000000AF2" --json
smp ports --json
smp send --port <explicit-port> --baud 115200 --hex "01 03 ..." --expect "01 03" --timeout 2000
```

**Stage one** only transforms bytes: stable JSON output, documented errors, meaningful exit codes,
stdin support and tests proving byte-for-byte agreement between CLI and application. This brings
immediate automation value without touching hardware.

**Stage two** can add port listing and bounded send/expect operations. It needs explicit port, baud
and framing options; no automatic probing of every port; timeouts, cancellation and reproducible
replay tests. Two processes must never compete for the same device, so it has to be decided whether
the CLI owns a port or talks to a running desktop session. A local HTTP API is not recommended until
there is a concrete multi-client requirement.

## Review limits

- No physical device was opened for these changes. Prior hardware results are not repeated or claimed
  as validation of the new functions.
- Triggers and the scheduler send to the connected device; they start switched off after every
  program start. Periodic sending, triggers and scheduler are limited by user-chosen intervals and
  cooldowns – measure what a real device tolerates before long runs.
- Settings for DTR/RTS take effect after opening; a driver-created reset pulse may still occur.
- With RTS/CTS, the current serialport API cannot safely set DTR/BREAK without also touching RTS,
  so those manual controls are deliberately disabled. The simulator cannot validate electric signals.
- Update checking requires network access to GitHub and can fail offline or under rate limiting.
- GUI automation and numerical coverage do not guarantee usability or long-term stability.
- The shared ledger is a coordination convention, not a distributed lock.
