# Changelog

## 0.1.5 — 2026-11-23

Every Expo / EAS reference re-checked against docs.expo.dev and the eas-cli changelog on 2026-11-23.

- `eas-build-submit`: Play tracks corrected (`alpha` is closed testing, `beta` is open). A draft
  `releaseStatus` is for uploading without rolling out, not a must for the first release; `eas submit`
  can create the first internal release. A draft app's set-up tasks block promotion to production.
- `eas-build-submit`: notes Expo's auto-submit rule (an explicit `track` needs `completed`), all
  workspace managers for monorepos, `sdk-<N>` image aliases, and that the workflow example is adapted.
- `diagnose-build-log.mjs`: the Play draft-app cause now says the app's set-up is unfinished.
- `app-store-review-guard`: rejection triage says where to send the fix and the reply (App Store Connect / Play Console).
- README: first eval run with the scripts actually running (23 Nov 2026).

## 0.1.4 — 2026-11-22

Store rules re-checked against official sources on 2026-11-22 (no changes to the Apple guidelines or
Google Play's target API since 0.1.0).

- `app-store-review-guard`: when the script can't run, the agent still checks for an account-deletion
  flow whenever an account library is installed.
- `app-store-review-guard`: Apple's new age rating questions (16 Nov 2026) must be answered before the
  next update can be submitted.
- `eas-build-submit`: SDK 57 on the Xcode 27 image also needs `ios.enableSceneSupport`, not just `expo@57.0.23+`.
- New manual `eval` workflow runs the agent evals in CI; README shows the 22 Nov 2026 results.

## 0.1.3 — 2026-11-16

- `preflight.mjs` no longer warns about a missing privacy manifest by default: `pod install` merges every pod's
  manifest and React Native core's reasons into the app's. It still warns when that aggregation is turned off.

## 0.1.2 — 2026-11-15

- Each GitHub release gets one zip per skill, ready to upload to Claude.ai or a skill marketplace.
- Every `SKILL.md` carries the kit version in `metadata.version`.
- CI uses Node 24 versions of `actions/checkout` and `actions/setup-node`.

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
