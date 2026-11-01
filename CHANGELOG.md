# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.2.0] – 2026-11-01

Completes the comparison with the former Python (CustomTkinter) version: every function of that
edition is now available.

### Added

- **Sequence mode for presets**: a command chain of steps, each with its own format, data and pause;
  the command's line end and _Append CRC_ apply to every step. Sent once, periodically (whole chain)
  or from the send table. Python presets with `is_sequence` and `steps` are imported with their steps.
- **Graph channels with own patterns**: detection mode _own patterns (regex)_ with one regular
  expression, name and colour per channel (the first group is the value; decimal commas accepted),
  and a colour picker for every curve in the legend. Colours and channels are saved.
- **Multi-port separate view**: switch between the combined list and one panel per port with its
  own byte counters; both views stay filled.
- **Decoder packet details**: the decoded packets are a selectable list; the details pane shows
  every field, the validity and the raw data (hex with offsets for Modbus RTU).
- **Storage folders**: a folder for commands and sequences (Python _preset save path_; existing
  files are used, missing ones copied) and a folder for logs and exports (Python _log save path_):
  start folder of all save dialogs and target of automatic stop captures. The Python log path is
  taken over.

### Fixed

- Presets of the former Python versions kept their format: the field `format` was ignored and every
  imported preset became HEX.
- Presets of the CustomTkinter version (`serial_presets.json`, also from its own preset folder) are
  imported on the first start.
- _Reset to defaults_ in the settings no longer removes triggers, schedules or the chosen folders.

### Tests

- Unit tests for sequence steps and their import, regex channels and stored colours, the data folder
  (copy, reuse, rejection of unusable folders) and the CustomTkinter preset import.
- Electron end-to-end tests for sending a sequence preset, the step editor, graph channels and
  colours, the separate multi-port view, decoder details and the folder settings.

## [1.1.0] – 2026-11-01

This release restores the transmit and automation functions of the former Python
(CustomTkinter) version that were missing after the move to TypeScript.

### Added

- **CRC when sending, as in the Python version**: _Add CRC_ in the Monitor, algorithm and
  little-/big-endian byte order, a signed position counted within the data like Python slicing
  (`0` appends, `1` makes the CRC the 2nd byte, `-1` puts it before the last byte), and
  _Include header/footer in CRC_. Impossible positions block sending instead of moving the CRC.
- **Header and footer in the Monitor**: added automatically around every input, written in the send
  format; a coloured preview shows header, data, CRC, footer and line end before sending.
- **Periodic sending** of the Monitor input and of single presets, with its own interval per preset.
- **Presets**: _Append CRC_ per command (Python `add_crc`), description and periodic interval;
  Python preset exports are read with these fields.
- **CRC tools**: two-part layout as in the Python version – transmit settings with a live transmit
  example and the algorithm parameters, and an independent calculator (format, algorithm, byte order).
- **Stop condition actions**: log only, pause the Monitor display, or pause and save the Monitor
  content as CSV without a dialog (`Documents/Serial Monitor Pro`).
- **Automation**: triggers that answer received text, HEX or regular-expression patterns (with a
  cooldown against echo loops), a scheduler for timed sends, and macro recording of manual sends into
  sequence steps. Triggers and scheduler always start switched off.
- **Multi-port**: bridge mode (one or both directions) and RX/TX byte counters per slot.
- **Live graph**: statistics per curve (count, min, max, mean, standard deviation, median, range) and
  CSV export.
- **Protocol decoder**: total/valid/invalid counters with success rate, _Show invalid packets_ and
  CSV export of all decoded packets.
- **Legacy import**: CRC, header/footer and periodic settings of the CustomTkinter version
  (`serial_monitor_settings.json`) are taken over on the first start.
- **Flow control and signals**: none, RTS/CTS or XON/XOFF; manual DTR/RTS with supported modes;
  CTS/DSR/DCD indicators and a 250 ms BREAK action. RTS/CTS reserves signal control for the driver.
- **Send file**: binary blocks or preserved text lines, configurable block size and pause, progress,
  cancellation, and protection against interleaved Monitor writes. Files remain byte-for-byte unchanged.
- **Update notice**: startup/manual checks, release links and cumulative changes from every newer
  stable release, including paginated feeds; per-version skip and an automatic-check setting.
- **Distribution**: macOS Universal DMG/ZIP and native x64/arm64 Snap builds alongside existing packages.
- Shared Codex/Claude work ledger and repository entry-point instructions.

### Changed

- **Consistent interface**: every tool shows its output in a titled card with _Clear output_ in the
  card header; all cards carry an icon; form fields align on one line even when some have hints.
- The tab bar scrolls on narrow windows while theme and settings stay visible; the active tab is
  scrolled into view.
- The Monitor's display options keep filter and _Clear_ together; the send area is grouped in two rows.
- Python defaults for CRC sending: CRC-16/MODBUS, big-endian, appended, header/footer not in the CRC.

### Fixed

- A single instance now owns each application profile. Closing the last window also exits on macOS;
  final settings saves, log writes and serial shutdown complete before exit.
- Requested control-line failures are reported instead of silently accepted; hardware flow control
  cannot be overwritten by manual line or BREAK operations.
- Opening, closing and scanning ports reserve ownership throughout asynchronous transitions.
- File pieces are generated on demand, so a large file with one-byte blocks does not allocate millions of arrays.
- Cancelling file transmission closes the port to release stalled writes, and pause listeners are
  removed after each block. Progress counts completed writes rather than claiming device acknowledgement.
- Release notes are rendered as text/Markdown elements without HTML execution; version validation,
  duplicate filtering, request deadlines and pagination errors have dedicated regression tests.

### Tests

- CRC vectors computed independently in Python (zlib and a bitwise Modbus CRC with Python slicing):
  byte orders, signed positions, header/footer coverage, all input formats, UTF-8 and invalid input.
- Unit tests for triggers (packet borders, regular expressions, cooldown), scheduler timing, macro
  recording, graph statistics/CSV, decoder validity, settings and legacy import.
- Electron end-to-end tests with the simulators for CRC/header/footer sending, persistence, preset CRC,
  periodic sending, stop actions, triggers, scheduler, macros, bridge, decoder and graph export.
- No physical device was opened during this change; hardware/long-run acceptance remains a separate step.

## [1.0.2] – 2026-10-18

### Fixed

- **Automation**: an answer that arrived before the _expect response_ step had started was missed
  and the sequence ended with a timeout – with fast devices (answers within a few milliseconds)
  almost every time. Everything received since the last send now counts.

### Changed

- **Documentation**: a complete user guide in the README – every tool explained with annotated
  pictures, a CRC reference table, the simulated devices, files and troubleshooting. The disclaimer now
  comes first. The documentation is English only; the German README was merged into it (the
  application itself stays bilingual).
- Build and test tooling: Vite 8, electron-vite 6, @vitejs/plugin-react 6, Vitest 5.
- Tests: the real-port code path also runs against a scripted serial driver, so failures such as
  a vanished device are tested on every platform including Windows; higher minimum test coverage.
- Hardware tests: also through the user interface (`tests/e2e/hardware.spec.ts`); the loopback test
  sends in small blocks so that it tests the application, not the buffer size of the adapter.

## [1.0.1] – 2026-10-17

### Fixed

- **Frame parser**: when a telegram ended shortly before the end of the received data, its last
  bytes were kept as a possible header start. Together with the next data they could form a false
  header, so the result depended on how the operating system split the stream.
- **Live graph**: numbers beyond the floating-point range (such as `1e999`) are ignored instead of
  being plotted as infinity.

### Changed

- Electron 44.7.2.
- Tests: randomised robustness tests for frame parser, line assembly, decoders and stop conditions;
  more tests on a virtual serial port (load, busy port, lost device, baud rate scanner), now also on
  macOS; minimum test coverage; opt-in hardware test through the application's serial code.

## [1.0.0] – 2026-10-17

First open-source release – a complete rewrite in TypeScript/Electron.

### Added

- **Monitor** with ASCII / HEX / DEC / BIN display, timestamps, Δt, hex dump, UTF-8, visible control
  characters, filter with highlighting, file logging and export to TXT/CSV. Changing a display option
  re-renders everything that has already been received.
- **Line assembly**: received data is grouped into lines (or packets, separated by pauses) instead of
  arbitrary operating-system chunks.
- **Presets / sequences** and **send table** sharing one command list, with import/export (also of files
  from the former Python version).
- **CRC tools** with 11 algorithms, verified against the official check values.
- **Stop conditions** (pattern, bytes, lines, time) – the time limit fires even when no data arrives.
- **Protocol decoder** for Modbus RTU (requests, responses, exceptions, single and multiple writes) and
  NMEA 0183 with checksum verification.
- **Automation** with send / wait / expect / note steps.
- **Multi-port monitoring** of up to four additional ports.
- **Frame parser** for custom telegrams (header, length field, payload, CRC, footer).
- **Live graph** of values extracted from received lines.
- **Baud rate scanner**.
- **Auto-reconnect** when a device is unplugged and plugged in again.
- **Simulated test devices** (loopback, sensor, Modbus slave, GPS, binary telegrams) to try everything
  without hardware.
- Light and dark theme, English and German user interface, keyboard shortcuts.
- Packages for Windows, macOS and Linux (deb, rpm, pacman, AppImage, Flatpak, tar.gz) on x64 and arm64.
- Quality checks: ESLint, Prettier, TypeScript, unit tests, end-to-end tests against simulated and
  virtual serial ports, hardware loopback test.

### Removed

- The licence manager, licence server, admin tool and all build scripts of the former Python version.
  Every function is available to everyone.

[Unreleased]: https://github.com/Ujap1994/Serial-Monitor-Pro/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Ujap1994/Serial-Monitor-Pro/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/Ujap1994/Serial-Monitor-Pro/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/Ujap1994/Serial-Monitor-Pro/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Ujap1994/Serial-Monitor-Pro/releases/tag/v1.0.0
