---
name: expo-release-preflight
description: Release-readiness check for Expo / React Native apps before cutting a production build — will the EAS build succeed, and will it ship what you think it ships? Checks versions and build numbers, eas.json profiles and environments, EAS environment variables vs EXPO_PUBLIC_ usage, gitignored assets that won't upload, committed ios/android folders that silently ignore app.json changes, localhost URLs and leaked keys, runtimeVersion/channel setup, dependency alignment with expo-doctor, and a release smoke-test plan. Use this whenever someone says they're about to release, cut a build, bump the version, "ship to production", run eas build --profile production, or asks what to check before a release — even if they don't mention a checklist.
license: MIT
compatibility: Node.js 18+ and git for scripts/release-check.mjs. Run inside the Expo project root.
metadata:
  version: "0.1.0"
  rules-checked-on: "2026-10-28"
  part-of: expo-ship-kit
---

# Expo Release Preflight

A failed production build costs 15–40 minutes of queue and build time; a *successful* build with the
wrong API URL, a missing env var or stale native config costs a store review cycle. This skill catches
both before `eas build` runs.

It's about build correctness. Store-review risks (permission strings, account deletion, IAP, privacy)
belong to the sibling skill `app-store-review-guard`; building and submitting belongs to
`eas-build-submit`; JS-only fixes that don't need a build belong to `expo-ota-updates`. Point the user
there when their question is really about those.

## Workflow

### 1. Run the static check

From the project root (the script path is relative to this skill's folder; in a Claude Code plugin
that's `${CLAUDE_PLUGIN_ROOT}/skills/expo-release-preflight`):

```bash
node <skill-dir>/scripts/release-check.mjs                       # production profile
node <skill-dir>/scripts/release-check.mjs --profile preview
node <skill-dir>/scripts/release-check.mjs --expect-version 1.4.0  # the version the user says they're shipping
node <skill-dir>/scripts/release-check.mjs --run-expo-checks     # + expo-doctor + expo install --check
node <skill-dir>/scripts/release-check.mjs --json                # for CI
```

It exits 1 on blockers. `--run-expo-checks` needs `node_modules` and usually network access; if it
can't run here, ask the user to run `npx expo-doctor` and paste the output.

If the user names the version they're shipping, pass `--expect-version`; with remote versioning EAS
never bumps the user-facing `version`, so "shipped as 1.0.0 again" is a common slip.

Read the findings with judgement. A localhost URL inside a `__DEV__` branch is fine; a committed
`android/` folder is fine for a bare project that edits native code on purpose. Say so instead of
repeating the warning.

### 2. Cover what a script can't see

Go through `references/release-checklist.md` and pick the items that apply. If the user wants a
quick answer ("building tonight"), don't turn this into a Q&A: put the open questions in the
report's "Check before building" list. The ones people most
often skip:

- **Which backend does the production build talk to?** Confirm the `EXPO_PUBLIC_API_URL` (or similar)
  value in the EAS *production* environment, not the local `.env`.
- **Has a release build been run on a real device?** Debug builds hide release-only crashes
  (Hermes/minification, missing env, ProGuard/R8 stripping). `npx expo run:ios --configuration Release`
  / `npx expo run:android --variant release`, or an internal-distribution EAS build.
- **Native change since the last store build?** If the only changes are JS/assets and the runtime
  version is unchanged, an OTA update may be enough — hand off to `expo-ota-updates`.
- **Migration paths**: users updating from the previous version with existing local data/storage.

### 3. Report

```markdown
# Release preflight: <app> <version> (<profile>)

**Verdict:** Ready to build / Fix first / Blocked
**Ships as:** new store build (native changes: <yes/no/unknown>) — or OTA update is enough

## Blockers
- <area>: problem → fix (file/key/command)

## Check before building
- [ ] ...

## Not this build, but will bite later
- <other profiles, submit config, monitoring>

## Release smoke test (on a release build)
- [ ] Cold start, login, the main flow, a deep link, a push notification, offline start
- [ ] Upgrade install over the previous store version

## Next step
<e.g. "eas build -p all --profile production --auto-submit" — see eas-build-submit>
```

Keep fixes concrete: the key in `eas.json`, the `eas env` command, the file to gitignore.

## Things worth explaining when they come up

- **Committed `ios/` and `android/` folders** turn off prebuild on EAS. From then on, editing
  `app.json` (icons, permissions, plugins, version) does nothing for native builds unless you also edit
  the native projects or run `npx expo prebuild --clean`. This is the most common "my change isn't in
  the build" cause.
- **EAS environment variables** come from the environment named in the build profile's `environment`
  key (`development`, `preview`, `production`; if unset, EAS uses `production` for store builds,
  `development` for dev clients, `preview` otherwise). Local `.env` files only reach EAS Build if committed —
  and they shouldn't be. Visibility: *plain text* and *sensitive* can be read by the CLI; *secret*
  never leaves EAS (use it for files like `GOOGLE_SERVICES_JSON`). `EXPO_PUBLIC_*` values are inlined
  into the JS bundle and readable by anyone, so they must never hold secrets.
- **Gitignored files** referenced from app config (a `google-services.json`, an icon) don't get
  uploaded, and the build fails with a missing-file error. Use a file environment variable and resolve
  the path in `app.config.js`.
- **Versions**: with `cli.appVersionSource: "remote"` (recommended), EAS owns `buildNumber` /
  `versionCode` and `autoIncrement` bumps them; the user-facing `version` is still yours to bump in app
  config for every store release. `nativeVersion` runtime policy doesn't work with remote versioning.
