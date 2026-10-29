# Release checklist (Expo / EAS)

Checked 2026-10-29 against Expo docs (EAS environment variables, app versions, troubleshooting) and
Expo SDK 58. Skip sections that don't apply.

## Contents
1. Code and dependencies
2. Configuration and environment
3. Versions
4. Native config (CNG)
5. Assets
6. Testing on a release build
7. Observability
8. After the build

## 1. Code and dependencies
- `npx expo-doctor` passes; `npx expo install --check` reports no mismatches (`--fix` to align).
- `npx expo export` succeeds locally — this surfaces JS bundling errors in seconds instead of after a
  20-minute EAS build (unresolved imports, files excluded by `.gitignore`).
- New native dependencies since the last store build? Then this release needs a store build, and the
  runtime version (fingerprint policy) will change.
- One lockfile, committed.
- No `console.log` of tokens or personal data; noisy logs stripped or no-op in production.
- Feature flags for unfinished work are off by default and documented for review (see
  `app-store-review-guard`, guideline 2.5.19).

## 2. Configuration and environment
- Build profile sets `"environment": "production"` (or the intended environment).
- Every `EXPO_PUBLIC_*` the app reads exists in that EAS environment:
  `eas env:list --environment production`. Missing ones are `undefined` at runtime, not a build error.
- No secrets in `EXPO_PUBLIC_*` or in source. Server keys stay on a server.
- Non-public variables used by `app.config.js` (e.g. `APP_VARIANT`) are set for the profile.
- File secrets (`GOOGLE_SERVICES_JSON`, `GoogleService-Info.plist`) are EAS file variables with
  *secret* visibility, and `app.config.js` reads their path from `process.env`.
- API base URL, analytics keys, payment keys (live vs test), OAuth client IDs and redirect URIs all
  point at production.
- `scheme` is set and unique if the app uses deep links, expo-router or OAuth redirects.
- `eas env:pull --environment production` reproduces the build's config locally when debugging; keep
  the generated `.env` gitignored.

## 3. Versions
- User-facing `version` bumped for a new store release (Apple won't accept a build for a version that
  is already released).
- Build numbers: `cli.appVersionSource: "remote"` + `autoIncrement: true` on production, or manual
  `ios.buildNumber` / `android.versionCode` bumps. Moving to remote on an existing app:
  `eas build:version:set` with the last submitted number.
- Runtime version policy matches how you ship (`fingerprint` recommended; `appVersion` requires a
  version bump on every native change).
- Changelog / "What's New" text written (Apple 2.3.12 requires significant changes to be listed).

## 4. Native config (CNG)
- If `ios/` and `android/` are gitignored, EAS runs prebuild from app config. Good.
- If they're committed, EAS uses them as-is: app.json changes to icons, splash, permissions, plugins,
  bundle IDs and versions are not applied. Regenerate (`npx expo prebuild --clean`) or edit natively.
- Config plugins added since the last build: run `npx expo prebuild --clean` locally once to make sure
  they apply without errors.

## 5. Assets
- Icon 1024×1024 PNG without transparency (iOS); Android adaptive icon foreground with safe padding,
  plus a monochrome layer for themed icons.
- Splash configured via the `expo-splash-screen` plugin; dark-mode variant if the app supports dark mode.
- Notification icon (Android) is white-on-transparent, or it renders as a grey square.
- Every referenced file exists and isn't gitignored.

## 6. Testing on a release build
Run on a release build, not a dev client — release-only failures are common:
`npx expo run:ios --configuration Release`, `npx expo run:android --variant release`, or an EAS build
with `distribution: internal`.

- Cold start without Metro, on a slow network, and offline.
- Sign up / log in / log out / account deletion.
- Main money or core flow end to end against production (or a production-like) backend.
- Deep links and universal/app links; OAuth redirects.
- Push notifications: permission prompt, receipt in foreground/background/killed, tap routing.
- Upgrade over the current store version with existing local data (storage migrations, cached auth).
- Smallest supported device, iPad if `supportsTablet`, Android back button, dark mode, large text.

## 7. Observability
- Crash/error reporting SDK installed and initialised early; source maps / debug symbols uploaded for
  this build (Sentry's Expo plugin does this during EAS Build).
- A way to tell which build and update a crash came from (`Updates.updateId`, `Updates.runtimeVersion`,
  `Application.nativeBuildVersion`).

## 8. After the build
- Tag the commit: `git tag v<version> && git push --tags`.
- Submit (see `eas-build-submit`) and, for iOS, start TestFlight testing while review runs.
- Plan the first days: watch crash-free rate; know your rollback (OTA rollback for JS issues, phased
  release / staged rollout for native ones).
