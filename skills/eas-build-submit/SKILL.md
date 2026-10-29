---
name: eas-build-submit
description: Set up, run and debug EAS Build and EAS Submit for Expo / React Native apps — eas.json profiles (development/preview/production), credentials, App Store Connect API keys and Google Play service accounts, auto-submit, staged rollouts, EAS Workflows CI, and diagnosing failed builds or submissions from the log. Use this whenever someone mentions eas build, eas submit, eas.json, a failed EAS build ("build failed", "Run fastlane failed", "gradlew failed", "pod install failed"), signing/provisioning errors, TestFlight or Play Console uploads, "Only releases with status draft", versionCode/buildNumber already used, or wants CI/CD for an Expo app — even if they don't name EAS.
license: MIT
compatibility: Node.js 18+ for the scripts. EAS CLI (`npm i -g eas-cli`) for the commands it suggests.
metadata:
  version: "0.1.0"
  rules-checked-on: "2026-10-29"
  part-of: expo-ship-kit
---

# EAS Build & Submit

Two jobs: get a correct pipeline from code to TestFlight / Play Console, and get a red build green
quickly. Sibling skills: `expo-release-preflight` (is this commit ready to build?),
`app-store-review-guard` (will review reject it?), `expo-ota-updates` (does it even need a build?).

Script paths below are relative to this skill's folder (in a Claude Code plugin:
`${CLAUDE_PLUGIN_ROOT}/skills/eas-build-submit`).

## Mode 1 — A build or submission failed

0. If the user pasted a single, recognisable error line, check the tables in `references/submit.md`
   (submission errors) or the script's patterns directly — no need to run anything.
1. Get the log. Ask the user to paste the failed phase's output or download the log from the build page
   on expo.dev. The **earliest failing phase** matters; "Run fastlane" or "Run gradlew" errors often just
   echo an earlier JS bundling or install failure.
2. Run the matcher:
   ```bash
   node <skill-dir>/scripts/diagnose-build-log.mjs build.log      # or: pbpaste | node … -
   ```
   It prints known causes, earliest first, with fixes and the matching log lines (exit 3 = nothing
   matched).
   For **submission** failures (EAS Submit, App Store Connect, Play Console), read `references/submit.md`
   too: first-release rules, tracks and account requirements live there.
3. If nothing matched, use `references/build-errors.md` (method + more patterns), and reproduce locally
   — the fastest loops are `npx expo export` (JS bundle, seconds), `npx expo-doctor`, then a local
   release build (`npx expo run:android --variant release`, `npx expo run:ios --configuration Release`)
   or `eas build --local`. The build page's **Compare** button diffs against the last green build.
4. Answer with: root cause in one or two sentences, the fix (exact file/key/command), and whether the
   next attempt needs a full rebuild, just a resubmit, or a credentials change.

## Mode 2 — Set up or review the pipeline

1. Validate what exists:
   ```bash
   node <skill-dir>/scripts/check-eas-config.mjs
   ```
   It checks build/submit profiles, `extends` chains, secrets in `env`, committed credential files,
   rollout settings, old iOS images, and `.eas/workflows` references.
2. For a new or messy setup, start from the annotated template in `references/eas-json.md` and adapt it.
   Explain each change briefly; don't silently rewrite someone's working profiles.
3. Submission specifics (first submissions, API keys, service accounts, tracks, staged rollouts, common
   rejections at upload): `references/submit.md`.
4. CI: `references/workflows.md` has EAS Workflows examples (build → submit on push to main, and the
   fingerprint-based "update or build" pattern). Check job keys against Expo's workflow syntax
   reference before relying on them — that schema evolves.

## Commands worth knowing

```bash
eas build -p ios --profile production                  # or -p android / -p all
eas build -p all --profile production --auto-submit     # build, then submit with the same-named submit profile
eas build --local -p android --profile production       # reproduce on your machine
eas submit -p ios --latest                              # submit the most recent build
eas credentials -p ios                                  # inspect / regenerate certs, profiles, ASC API key
eas build:version:set -p android                        # seed remote versioning with the last store number
eas env:list --environment production                   # what the production build will see
eas workflow:run .eas/workflows/release.yml             # run a workflow manually
```

## Judgement calls to make explicit

- **Local vs remote credentials**: remote (EAS-managed) is the default and the right choice unless the
  team already manages signing elsewhere. Never commit `.p8`, `.p12`, keystores or service-account JSON.
- **Auto-submit to production**: fine for iOS (it lands in TestFlight; release is still manual). On
  Android, prefer `releaseStatus: "draft"` or a staged `inProgress` rollout over `completed` at 100%.
- **Resource class**: `large` fixes most out-of-memory and timeout failures but costs more; check the
  bundle size first.
- **Images**: leave `ios.image` / `android.image` unset unless there's a reason; EAS picks the image that
  matches the Expo SDK. `latest` is currently Xcode 27, which needs Expo SDK 58 (or scene support enabled
  on SDK 57, `expo@57.0.23+`) for the app to launch on iOS 27.
