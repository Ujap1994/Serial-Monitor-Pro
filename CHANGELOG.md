# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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

[1.0.0]: https://github.com/Ujap1994/Serial-Monitor-Pro/releases/tag/v1.0.0
