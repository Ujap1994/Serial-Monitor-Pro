# Development status and CLI assessment

Serial Monitor Pro is open-source software and may contain errors or bugs. Tests reduce risk;
they do not certify the application or a connected device. This assessment covers the TypeScript
repository as reviewed on 2026-10-31, including the changes prepared for 1.1.0.

## Completed in this change

- Shared CRC packet construction for calculator previews and manual Monitor sends: byte order,
  signed insertion position, independent header/footer coverage, validation and persistent settings.
- Integration and verification of the earlier draft for flow control, DTR/RTS, modem inputs,
  file sending and cumulative update notices. File cancellation disconnects and releases the port;
  competing Monitor transmissions cannot interleave with a file transfer.
- Release feed pagination, duplicate/version validation and a single request deadline. Notes from
  every newer stable release are displayed without injecting HTML.
- One instance per application profile. Closing the last window also exits on macOS; final settings
  writes, file logs and serial connections are completed/closed before exit. Concurrent saves to
  the same settings file are ordered.
- Windows x64/arm64 installer and portable builds; macOS arm64/x64/Universal DMG and ZIP builds;
  Linux AppImage, deb, rpm, pacman, Snap, Flatpak and tar.gz builds for x64/arm64.
- Shared work ledger linked from both AGENTS.md and CLAUDE.md.

This is a source review and regression-test assessment, **not a certified complete Python-to-
TypeScript parity audit**. The repository history available here begins with the TypeScript 1.0.0
release; the original Python implementation is not present. Legacy import maps selected settings,
presets and sequences, not every historical option. CRC settings from the former Python UI must be
configured explicitly; their old storage keys have not been guessed.

## Recommended order of remaining work

| Priority | Work                                 | Evidence / reason                                                                                                                                                                     | Completion criterion                                                                                                                      |
| -------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Long-run and hardware acceptance     | Simulators and mock drivers cannot measure a real adapter's buffers, flow signals or reset behaviour.                                                                                 | Complete the [test checklist](LONG_RUN_TEST_CHECKLIST.md) with measured rates, loss counts, memory trend and a saved report.              |
| 2        | Raw capture and deterministic replay | TXT/CSV export and simulated/fuzz tests exist; there is no dedicated timestamped binary session format and replay runner.                                                             | Versioned capture with exact bytes, direction and timing; anonymized hardware fixtures replayed in CI.                                    |
| 3        | Device-specific protocol acceptance  | Generic file sending has pauses but no ACK/NAK, retries or receiver verification. Multi-Port and scanner do not inherit all Monitor controls.                                         | Define required device behaviour, then test timeout/retry/error handling against captures and a simulator.                                |
| 4        | Complete migration inventory         | Python sources/settings schema are unavailable in this checkout.                                                                                                                      | Compare each former screen and persisted field to a tracked parity matrix; add regression tests for confirmed omissions.                  |
| 5        | Small, headless CLI                  | The shared pure core is reusable, but no public CLI command/exit-code contract exists.                                                                                                | Start with offline CRC/decode commands, then explicitly configured serial sessions backed by the same tested services.                    |
| 6        | Distribution assurance               | Native runtime tests cover the host architecture; cross-built Windows ARM and Linux ARM archives do not all receive an install/run test. Signing/notarization credentials are absent. | Real/native-VM smoke tests per supported package; optional signed Windows and notarized macOS distribution when credentials are supplied. |

Further useful features, after stability: graph export, saved connection profiles, session import,
device-response-aware transfer, and a documented protocol-extension API. These are opportunities,
not defects claimed to have existed in Python.

## CLI recommendation

A CLI is useful for a test manager, CI fixtures and scripted byte verification. It should be a
small Node.js executable sharing `src/shared/core`, not a second implementation of CRC or framing,
and not a replacement for the Electron desktop application. No CLI is implemented in 1.1.0.

Suggested staged interface (design examples, **not available commands**):

```text
smp crc --algorithm CRC-16/MODBUS --hex "01 03 00 00 00 0A" --endian little --position 0 --json
smp decode --protocol modbus --input capture.jsonl --json
smp ports --json
smp send --port <explicit-port> --baud 115200 --hex "01 03 ..." --timeout 2000 --json
```

Stage one should only transform files/bytes: stable JSON output, documented errors, meaningful exit
codes, stdin support and byte-for-byte CLI/core agreement tests. This provides immediate automation
value without taking ownership of hardware.

Stage two can add port listing, capture and bounded send/expect operations. It needs explicit port,
baud and framing options; no automatic probing/opening of every port; bounded timeouts, cancellation,
port ownership, backpressure and reproducible replay tests. Decide whether the test manager owns a
port or talks to an already-running desktop session—two independent processes must not contend for
the same device. Any local IPC should be narrowly scoped and authenticated. Prefer a CLI over a
general HTTP API until there is a concrete multi-client requirement.

## Review limits

- No physical device was opened for this change. Prior hardware results are not repeated or claimed
  as validation of the new flow controls.
- Settings for DTR/RTS take effect after opening; a driver-created reset pulse may still occur.
- With RTS/CTS, the current serialport API cannot safely set DTR/BREAK without also touching RTS,
  so those manual controls are deliberately disabled. The simulator cannot validate electric signals.
- Update checking requires network access to GitHub and can fail offline or under rate limiting.
  It displays release information, not automatic installation.
- GUI automation and numerical coverage do not guarantee usability or long-term stability.
- The shared ledger is a coordination convention, not a distributed lock. Separate worktrees and
  explicit file claims are still necessary when Codex and Claude run at the same time.
