# Shared work ledger — Codex and Claude Code

Read this file and `git status` before editing. Record a claim before starting;
do not edit another agent's claimed files without an explicit handoff. Use a
separate branch/worktree for concurrent changes. This ledger is coordination,
not an atomic lock: check with the active agent before overlapping work.

## Active work — 2026-10-31

| Owner       | Status                                                                                                                                                                                                                                                       | Scope / files                                                                                                                                    | Next handoff                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Codex       | Local validation complete                                                                                                                                                                                                                                    | CRC transmit core, settings, CRC/Monitor UI, translations, integration tests, documentation and release                                          | GitHub CI and release package results                             |
| Claude Code | Done – 1.4.0: GUI long-run test with the multi-port bridge to the RS232 loopback; session capture and replay (exact bytes, direction, timing; replay as simulated device; hardware fixtures in CI); terminal mode (ANSI colours, interactive keyboard input) | `tests/soak`, `src/main` (serial, capture, simulator), `src/shared/core`, `src/renderer` (monitor, terminal), i18n, docs                         | Commit on `main`, CI, release                                     |
| Claude Code | Done – 1.3.1: unattended restarts in the long-run test (RESET/reopen/DTR/RTS), unplanned-restart and dropped-output checks, loopback probe, firmware 1.1 (watchdog, USB-stall recovery, `boot=`), Nano ESP32 on `esp32:esp32`                                | `hardware/`, `scripts/firmware.mjs`, `tests/soak`, `src/main/simulator.ts`, `src/main/serial.ts`, docs                                           | Commit on `main`, CI, release                                     |
| Claude Code | Done – 1.3.0: HEX input formatting everywhere, update notice checkbox, long-run test (firmware for Uno/Nano ESP32/Mega 2560/ESP32-WROOM, `sim:testdevice`, soak runner, `npm run longrun`)                                                                   | src (inputs, update dialog, simulator), `hardware/`, `scripts/`, `tests/soak`, docs                                                              | Commit on `main`, CI, release                                     |
| Claude Code | Done – 1.2.0 on `main`: sequence presets, graph regex channels/colours, multi-port separate view, decoder detail pane, configurable storage paths                                                                                                            | Presets/commands core, graph, multi-port, protocol, settings/storage (main+renderer), tests, docs, release                                       | Commit on `main`, CI and release links below                      |
| Claude Code | Done – merged to `main`, release v1.1.0                                                                                                                                                                                                                      | CRC transmit rework (position semantics, header/footer framing), CRC/Monitor UI, UI consistency review, Python parity audit, docs, 1.1.0 release | Commit on `main`, CI and release links recorded below             |
| Claude Code | Draft integrated by Codex                                                                                                                                                                                                                                    | Flow control, DTR/RTS, file sending and update notices; originally uncommitted on 1.0.2                                                          | Integrated and tested; no concurrent claim from Claude is assumed |

Working branch: `codex/crc-transmit`, starting at `48920f1` (1.0.2).
The original tracked diff is backed up locally at `/private/tmp/smp-before-codex.patch`.
The draft has been incorporated into this release; no original work was discarded.

## Handoff rules

1. Record owner, branch/worktree, claimed files, start date and next step.
2. Before handoff, record the commit, checks actually run, results and unresolved issues.
3. A reviewer should claim tests or review in a separate worktree and avoid changing
   implementation concurrently. Label review by the actual agent; never imply
   Claude reviewed work that was checked only by Codex.
4. Keep documentation and this ledger in English; communicate with the owner in German.
5. Test with simulated ports first. Never open an arbitrary physical serial port.
   Physical-device tests require the user's identified device and current task scope.
6. Commit/push/release are authorized for this task. Preserve unrelated work and
   verify the exact commit being published. Record CI and release links here.

## Verification and handoff — 1.1.0

- `npm run check`: passed on local macOS, 915 unit/integration tests and 38 Electron E2E tests.
  Hardware tests remained opt-in (16 unit, 3 E2E skipped); no physical port was opened.
- Coverage: statements 94.46%, branches 85.21%, functions 95.29%, lines 96.53%.
- `npm run docs:screenshots`: 26 anonymized images regenerated; new CRC and update views visually inspected.
- Separate Codex review/test workers contributed main-process/packaging/test changes, but their
  work was interrupted by a usage limit. Parent Codex completed integration and validation.
  This is not a claim that Claude Code reviewed the resulting patch.
- Release packaging is being verified by GitHub; publication status and links will be added here.
- Follow-up scope is in `docs/DEVELOPMENT_STATUS.md`; hardware/soak acceptance is in
  `docs/LONG_RUN_TEST_CHECKLIST.md`. CLI is assessed, not implemented.

- Follow-up: file transfer now generates pieces lazily, including the 16 MiB / one-byte-block edge case. The first package run was cancelled before publication to include this fix.

## Claude Code handoff — 2026-11-01 (merged to `main`, tag `v1.1.0`)

Owner request: restore the Python (CustomTkinter) behaviour and replace the earlier Codex CRC design,
fix UI inconsistencies, update tests, documentation and screenshots, release.

- CRC transmit like Python: Monitor _Add CRC_ / _Header_ / _Footer_, header/footer added in the send
  format, signed position with Python slicing (`-1` = before the last byte), include header/footer in
  CRC, Python defaults. Per-preset _Append CRC_ (`add_crc`), description and periodic interval.
- Restored Python functions: periodic sending (Monitor and preset), stop actions (log/pause/save),
  triggers, scheduler, macro recording, multi-port bridge and counters, graph statistics/export,
  decoder statistics/filter/export, Modbus ASCII, legacy import of `serial_monitor_settings.json`.
- UI: tab bar actions never scroll away, form fields aligned, output cards with _Clear output_ in the
  header everywhere, card icons, compact Monitor send area.
- Parity table and CLI assessment: `docs/DEVELOPMENT_STATUS.md`.

Checks run locally (macOS): `npm run check` passed – format, lint, types, 1089 unit/integration tests
(16 hardware tests skipped), coverage statements 94.72 % / branches 85.64 % / functions 95.62 % /
lines 96.74 %, build, 50 Electron E2E tests (3 hardware tests skipped). `npm run docs:screenshots`
regenerated 29 images; all were inspected. No physical port was opened.
Open: hardware/long-run acceptance, remaining ⚠️ parity items, CLI (not implemented).

Published: CI on `main` (`da513e9`) passed on Linux, Windows and macOS –
https://github.com/Ujap1994/Serial-Monitor-Pro/actions/runs/41251568652. Release workflow passed –
https://github.com/Ujap1994/Serial-Monitor-Pro/actions/runs/41251988922. Release with 24 packages and
SHA256SUMS: https://github.com/Ujap1994/Serial-Monitor-Pro/releases/tag/v1.1.0

## Claude Code handoff — 2026-11-01 (1.2.0, merged to `main`, tag `v1.2.0`)

Owner request: close the remaining Python parity items. Sequence-mode presets (step editor, sending
with pauses, Python import incl. the `format` field fix and `serial_presets.json`), graph channels
with own regular expressions and colours, multi-port separate view, decoder packet list with a
details pane, folders for commands/sequences and logs/exports (copy-if-missing, validation in main).

Checks run locally (macOS): `npm run check` passed – 1139 unit/integration tests (16 hardware
skipped), coverage statements 94.78 % / branches 85.92 % / functions 95.84 % / lines 96.78 %,
57 Electron E2E tests (3 hardware skipped) incl. a layout test at 1024×640 and 1280×800. Screenshots regenerated (34) and inspected; the storage
picture is anonymised. No physical port was opened.

Published 1.2.0: a first CI run failed on macOS because the runner's small screen squeezed the
multi-port output to zero height – fixed in the layout (minimum output heights, page scrolls) and
covered by `tests/e2e/layout.spec.ts`. CI on `main` (`5bf8a9c`) passed on Linux, Windows and macOS –
https://github.com/Ujap1994/Serial-Monitor-Pro/actions/runs/41260417056. Release workflow passed –
https://github.com/Ujap1994/Serial-Monitor-Pro/actions/runs/41260852217. Release with 24 packages and
SHA256SUMS: https://github.com/Ujap1994/Serial-Monitor-Pro/releases/tag/v1.2.0

## Claude Code handoff — 2026-11-01 (1.3.0)

HEX fields format while typing everywhere; update notice: "don't notify about this version"
checkbox, setting renamed "automatic update check at program start" (live GitHub feed verified:
1.1.0 sees 1.2.0, 1.2.0 is up to date). Long-run test: firmware `hardware/smp-testdevice`
(SMP-TD/1) flashed on Uno R3, Mega 2560, Nano ESP32 and ESP32-WROOM-32 via `npm run firmware`;
`sim:testdevice`; terminal runner (`npm run soak`), GUI runner (`npm run soak:gui`), starter
`npm run longrun`. Devices are approved only via the local, git-ignored
`hardware/devices.local.json` (serial number + VID/PID; "never" list for the VDE tester and the
monitor).

Measured: 3-minute terminal runs with all four boards passed (≈5 000 requests each, 0 timeouts,
0 changed answers, 0 stream gaps, Nano ESP32 reconnects after RESET); 3-minute GUI run with all four
boards passed (715 frames accepted by the Uno, 0 rejected, 0 console errors). `npm run check`
passed locally (60 Electron tests, 3 hardware skipped). Open: overnight/weekend runs by the owner,
RS232/485 loopback adapter not yet connected.

## Claude Code handoff — 2026-11-01 (1.3.1)

Long runs without anyone at the hub: the soak runner restarts each board itself (firmware `RESET`,
reopen, DTR pulse for Uno/Mega, RTS/EN for ESP32-WROOM) and the simulator's test device reacts to
DTR/RTS like the boards. Root cause of the Nano ESP32 hangs: the TinyUSB CDC of the Arduino core
`arduino:esp32` 2.0.18 stopped sending after a restart/reopen (loop then spun in `USBCDC::write`,
only a power cycle helped). Fix: build with `esp32:esp32:nano_nora` (3.3.12); firmware 1.1 adds a
loop watchdog, non-blocking USB output with `dropped=` counter, a USB-stall restart and `boot=`
reasons; the runner reports unplanned restarts, dropped output, probes loopback ports before use
and backs off reconnects. The owner confirmed that FTDI FT9N7051 (US232R) is now an RS232 loopback
with pins 2–3 bridged (VDE tester disconnected); it is a `loopback` lane in the local device list.

Measured: Nano ESP32 alone, RESET every minute + reopen every 90 s for 6 min – passed (core 2.0.18
failed the same test). All five lanes for 8 min with a restart of every kind every 1–2 min –
passed (≈14 000 requests per board, 11 692 loopback blocks, 0 timeouts, 0 changed answers,
0 unplanned restarts).

Published 1.3.1: `npm run check` passed locally (1157 unit/integration tests, 60 Electron tests).
CI on `main` (`78604a1`) passed on Linux, Windows and macOS –
https://github.com/Ujap1994/Serial-Monitor-Pro/actions/runs/41321921809. Release workflow passed –
https://github.com/Ujap1994/Serial-Monitor-Pro/actions/runs/41322572765. Release with 24 packages and
SHA256SUMS: https://github.com/Ujap1994/Serial-Monitor-Pro/releases/tag/v1.3.1. Not rerun with
firmware 1.1: the GUI long-run test on the boards (unchanged code path; the terminal run covered the
firmware). Open: overnight/weekend runs by the owner.

## Claude Code handoff — 2026-11-01 (1.4.0)

GUI long-run test: the multi-port bridge forwards a board's stream to the RS232 loopback adapter
(FTDI FT9N7051, pins 2–3 bridged, confirmed by the owner); every byte must come back. New samples:
JS heap, DOM nodes per tab; `SMP_SOAK_PROFILE=1` profiles the renderer. Finding: `TextLog` (multi-port,
automation, stop, frame parser) forced a full layout on every appended line (`scrollTop =
scrollHeight`) – under full load the window froze after ~5 min at 1.3 GB (27 s of 60 s in that
callback). Fixed: follow-scroll at most once per animation frame, rows in `content-visibility` blocks.

Session capture (`src/shared/core/capture.ts`, `src/main/capture.ts`, SerialManager taps) and replay
(`src/shared/core/replay.ts`, `sim:replay-<n>` in the simulator, replay dialog). Real board sessions
recorded with `SMP_RECORD_FIXTURES=1 npm run soak -- record-fixtures` into `tests/fixtures/captures/`
(anonymised) and replayed in `tests/unit/capture-fixtures.test.ts`. Terminal view (xterm.js) and ANSI
colours in the monitor (`src/shared/core/ansi.ts`, setting `ansi`, `monitorView`, `terminalEnter`,
`terminalEcho`).

Measured for 1.4.0: GUI long-run test with four boards and the RS232 bridge for 20 minutes passed
(4 750 frames accepted, 0 rejected; 638 650 bytes through the bridge, all back unchanged; window
plateau ≈ 550 MB once the outputs reached their line limits; before the fix it froze after ~5 min).
`npm run check` passed locally (1 245 unit/integration tests, 63 Electron tests). CI on `main`
(`59881bd`) passed on Linux, Windows and macOS –
https://github.com/Ujap1994/Serial-Monitor-Pro/actions/runs/41342788026. Release workflow passed –
https://github.com/Ujap1994/Serial-Monitor-Pro/actions/runs/41396577004. Release with 24 packages and
SHA256SUMS: https://github.com/Ujap1994/Serial-Monitor-Pro/releases/tag/v1.4.0. Open: overnight and
weekend runs by the owner; device profiles, network ports, log rotation, CLI (DEVELOPMENT_STATUS).
