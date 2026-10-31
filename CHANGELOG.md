# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.0] – 2026-10-31

### Added

- **CRC transmission**: persistent little-/big-endian selection, signed insertion position,
  automatic CRC for manual Monitor input, independent header/footer coverage and exact HEX previews.
  Position `0` appends, `1` inserts before the second byte, and `-1` before the penultimate byte.
  Invalid positions and mismatching framing block transmission. Separate line endings are added last.
- **Flow control and signals**: none, RTS/CTS or XON/XOFF; manual DTR/RTS with supported modes;
  CTS/DSR/DCD indicators and a 250 ms BREAK action. RTS/CTS reserves signal control for the driver.
- **Send file**: binary blocks or preserved text lines, configurable block size and pause, progress,
  cancellation, and protection against interleaved Monitor writes. Files remain byte-for-byte unchanged.
- **Update notice**: startup/manual checks, release links and cumulative changes from every newer
  stable release, including paginated feeds; per-version skip and an automatic-check setting.
- **Distribution**: macOS Universal DMG/ZIP and native x64/arm64 Snap builds alongside existing packages.
- **Collaboration**: shared Codex/Claude work ledger and repository entry-point instructions.
- Expanded English guide with anonymized screenshots, code audit/CLI assessment and a long-run checklist.

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

- Known-vector CRC packet tests cover byte order, signed offsets, all input formats, independent
  framing coverage and invalid input. Electron tests verify actual simulator sends and saved settings.
- Driver-mock tests exercise line failures and port lifecycle races. Electron tests cover file bytes,
  cancellation/reconnect, cumulative update notes, single-instance behaviour and immediate-close persistence.
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
