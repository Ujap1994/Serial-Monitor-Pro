# Contributing to Serial Monitor Pro

Thanks for helping! This guide gets you from clone to pull request.

## Setup

```bash
git clone https://github.com/Ujap1994/Serial-Monitor-Pro.git
cd Serial-Monitor-Pro
npm ci                 # also installs the git hooks
npm run dev:sim        # app with hot reload and simulated devices
```

Requirements: Node.js 22+, Git. On Linux the end-to-end tests additionally need `xvfb` (when no
display is available). Install `socat` for the virtual serial port tests – without it they are
skipped silently: `sudo apt install xvfb socat` (Linux) or `brew install socat` (macOS).

## The quality check

| Command                                                                | Purpose                                                                       |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `npm run check`                                                        | Everything: format, lint, types, unit tests, build, end-to-end tests          |
| `npm run check:quick`                                                  | Fast subset without build and end-to-end tests (runs before every `git push`) |
| `npm run check -- --fix`                                               | Format and auto-fix first                                                     |
| `npm run check:watch`                                                  | Type checker and unit tests in watch mode                                     |
| `npm run test:e2e`                                                     | Build and run only the end-to-end tests                                       |
| `npm run test:hardware -- --port <path>`                               | Loopback test with a real adapter (TX ↔ RX)                                   |
| `SMP_HW_PORT=<path> npx vitest run tests/unit/serial-hardware.test.ts` | The same through the app's serial code, several baud rates and frame formats  |
| `SMP_HW_PORT=<path> npx playwright test tests/e2e/hardware.spec.ts`    | The real app through its UI against the adapter (build first)                 |
| `SMP_APP_EXECUTABLE=<path> npx playwright test`                        | End-to-end tests against a packaged build                                     |

A pull request is ready when `npm run check` passes locally. CI runs the same check on Linux, Windows
and macOS.

## Where things live

- `src/shared/core/` – pure logic without UI (CRC, formats, frame parser, decoders, stop conditions,
  settings). **New logic belongs here and gets unit tests in `tests/unit/`.**
- `src/shared/i18n/` – translations. `de.ts` is the reference; TypeScript and a unit test make sure
  `en.ts` has the same keys and placeholders.
- `src/main/` – Electron main process: `serial.ts` (ports), `simulator.ts` (virtual devices),
  `storage.ts`, `menu.ts`.
- `src/renderer/src/` – React UI: `pages/` (one file per tab), `dialogs/`, `components/`,
  `state/` (stores and serial routing).
- `tests/e2e/` – Playwright tests that drive the real app. Elements are addressed via `data-testid`.

## Adding a feature

1. Put the logic into `src/shared/core/` and test it in `tests/unit/`. Anything that consumes the
   serial stream also belongs in `tests/unit/robustness.test.ts`: the result must not depend on
   where the stream is split. The check fails when the coverage drops below the thresholds in
   `vitest.config.ts`.
2. Add texts to `src/shared/i18n/de.ts` **and** `en.ts`.
3. Build the UI in `src/renderer/src/`.
4. If the feature needs a device, extend a simulated device in `src/main/simulator.ts` and add an
   end-to-end test.
5. Run `npm run check`, update `CHANGELOG.md` (section _Unreleased_) and the README if it is visible
   to users.

To regenerate the screenshots in `docs/images` run `npm run docs:screenshots`
(Linux without display: `xvfb-run -a npm run docs:screenshots`). The icons are generated from
`assets/brand/logo.svg` with `npm run icons`.

## Releasing

1. Update the version in `package.json` and move the _Unreleased_ section of `CHANGELOG.md` to the
   new version.
2. Commit, then tag: `git tag v1.2.3 && git push origin v1.2.3`.
3. The _Release_ workflow verifies the code, builds every package (Windows, macOS, Linux; x64 and
   arm64), tests the packaged app and publishes the GitHub release with checksums.

## Code style

Prettier formats, ESLint (type-aware) checks. Prefer clear names over comments; where a comment is
needed, explain _why_, not _what_.
