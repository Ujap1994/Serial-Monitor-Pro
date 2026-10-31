# Shared work ledger — Codex and Claude Code

Read this file and `git status` before editing. Record a claim before starting;
do not edit another agent's claimed files without an explicit handoff. Use a
separate branch/worktree for concurrent changes. This ledger is coordination,
not an atomic lock: check with the active agent before overlapping work.

## Active work — 2026-10-31

| Owner       | Status                                                  | Scope / files                                                                                                                                    | Next handoff                                                      |
| ----------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Codex       | Local validation complete                               | CRC transmit core, settings, CRC/Monitor UI, translations, integration tests, documentation and release                                          | GitHub CI and release package results                             |
| Claude Code | Paused (usage limit), branch `claude/crc-python-parity` | CRC transmit rework (position semantics, header/footer framing), CRC/Monitor UI, UI consistency review, Python parity audit, docs, 1.1.0 release | Commit on `main`, CI and release links recorded below             |
| Claude Code | Draft integrated by Codex                               | Flow control, DTR/RTS, file sending and update notices; originally uncommitted on 1.0.2                                                          | Integrated and tested; no concurrent claim from Claude is assumed |

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

## Claude Code handoff — 2026-10-31 (branch `claude/crc-python-parity`, not merged)

Reworked CRC transmit to match the Python (CustomTkinter) original, per owner request:
position semantics like Python slicing (-1 = before the last byte; 0 = append), Monitor
header/footer with use-checkboxes added automatically (send format), CRC include checkboxes,
per-preset "Append CRC" (`add_crc`), Monitor periodic sending, legacy import of
`serial_monitor_settings.json`, two-column CRC tab, tab bar actions no longer scroll away,
form-grid alignment, Monitor options grouping.

Checks run: `tsc` (node/web/test) clean, `eslint` clean, `vitest run` 960 passed / 16 skipped.
NOT yet done: E2E specs (`tests/e2e/crc-transmit.spec.ts` still targets the old design and will
fail), `scripts/screenshots.mjs` (`.sendbar` selector, CRC views), README/guide/CHANGELOG,
parity matrix in `docs/DEVELOPMENT_STATUS.md`, `npm run check`, merge to main, 1.1.0 release.
