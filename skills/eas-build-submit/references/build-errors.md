# Debugging a failed EAS build

`scripts/diagnose-build-log.mjs` encodes the common patterns. This file is the method for everything
else.

## Method

1. **Find the earliest failing phase** on the build page (Install dependencies → Prebuild → Install
   pods → Bundle JavaScript → Run fastlane / Run gradlew → Upload). Fix that one; later failures are
   usually consequences. `[stderr]` lines are not automatically errors.
2. **Compare** with the last successful build (Compare button). What changed: dependencies, app config,
   eas.json, the image, environment variables?
3. **Shrink the loop**:
   - JS only: `npx expo export --platform <ios|android>` (seconds).
   - Dependencies: `npx expo-doctor`, `npx expo install --check`.
   - Native config: `npx expo prebuild --clean` and read any plugin errors.
   - Full release build locally: `npx expo run:android --variant release` /
     `npx expo run:ios --configuration Release`, or `eas build --local` (same steps as the worker).
4. **Match the environment**: Node / package manager versions, environment variables
   (`eas env:pull --environment <env>`), and what's actually uploaded (gitignored files are missing on
   the worker; file name casing matters on Linux).
5. **Fresh clone** on another machine if it builds locally but not on EAS — that reproduces "it's only
   on my disk" problems.

## Patterns not in the script

- **Build passes, app crashes on launch** (release only): missing `EXPO_PUBLIC_*` value, a native module
  not linked because `ios/`/`android/` are committed and stale, Hermes-incompatible code, or iOS 27
  launch failure when built with Xcode 27 on SDK ≤ 57 without scene support. Check device logs
  (Console.app / `adb logcat`) and your crash reporter.
- **Config plugin silently not applied**: native folders committed → EAS skips prebuild.
- **"Works on preview, fails on production"**: different `environment` → different env vars; or
  `buildType`/`developmentClient`/`channel` differences via `extends`.
- **Monorepos**: Yarn workspaces are best supported; others may need extra config. Make sure the app's
  `package.json` is the one EAS resolves and the lockfile is at the workspace root.
- **Postinstall scripts / patch-package**: run on the worker too; failing patches stop the install phase.
- **Large native downloads** (maps SDKs, ML models): cache them (`cache.paths`) or use `large`.

## When to escalate

If the earliest error is inside EAS infrastructure (worker provisioning, upload of artifacts) and a
retry fails the same way, check status.expo.dev and the Expo Discord/forums with the build ID.
