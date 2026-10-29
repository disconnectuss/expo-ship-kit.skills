# Changelog

## 0.1.1 — 2026-10-30

- `release-check.mjs` and `preflight.mjs` report source paths with `/` on Windows too.
- README: removed a stray heading.

## 0.1.0 — 2026-10-29

First release. Rules checked against official sources on 2026-10-29.

- Skills: `expo-release-preflight`, `eas-build-submit`, `expo-ota-updates`, `app-store-review-guard`.
- Scripts: `release-check.mjs`, `check-eas-config.mjs`, `diagnose-build-log.mjs`, `ota-or-build.mjs`,
  `preflight.mjs`. Zero dependencies, Node 18+, `--json` output, non-zero exit on blockers.
- `ota-or-build.mjs` requires `--base` when the repo has no tags instead of guessing a ref.
- Resolved config now keeps `ios.config` / `android.config` (no more false export-compliance notes).
- Windows path handling in `ota-or-build.mjs`; npm `` `npm ci` `` lockfile errors are recognised.
- Deterministic script tests and CI on Linux and Windows (Node 18 and 22), weekly rules-freshness check.
- Agent evals for every skill, including a clean project that must not be flagged. First measured run in README.
- `preflight.mjs` warns when the privacy manifest lacks the API categories React Native core uses.
- Skills: verdict rules for review readiness; a missing channel on the profile being built counts for this build.
