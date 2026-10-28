# EAS Update set-up and troubleshooting

Checked 2026-10-28 against Expo docs (expo-updates reference, runtime versions, environment
variables, rollouts, rollbacks) and Expo SDK 58.

## Minimal set-up

1. `npx expo install expo-updates` then `eas update:configure` (sets `updates.url`, adds channels to
   `eas.json` build profiles).
2. Runtime version in app config:
   ```json
   { "expo": { "runtimeVersion": { "policy": "fingerprint" } } }
   ```
3. A `channel` on each build profile that should receive updates:
   ```json
   { "build": { "preview": { "channel": "preview" }, "production": { "channel": "production" } } }
   ```
4. Rebuild. Builds made before this don't have the channel or runtime baked in.

## Runtime version policies

| Policy | Runtime changes when | Good for | Watch out |
|---|---|---|---|
| `fingerprint` | Anything that may affect the native runtime (deps with native code, native config, plugins, SDK) — computed by `@expo/fingerprint` | Most apps; works with and without custom native code | Different per platform; a dependency bump can create a new runtime. Inspect with `eas fingerprint:compare`. |
| `appVersion` | `version` in app config changes | Simple mental model: one runtime per store version | You must bump `version` on every native change — forget and updates crash old builds. |
| `nativeVersion` | `version` + `buildNumber`/`versionCode` change | Rare | Not supported with remote app versioning. |
| custom string | You change it | Full control | Entirely manual. |

Fingerprint presets (`fingerprint.config.js` → `preset`): `balanced` is the default (SDK 58 made it the
default so a version bump or `node_modules` noise no longer changes the fingerprint); `strict` was the
historical behaviour; `relaxed` also ignores app identity (icons, bundle IDs) for multi-variant
projects. Exclude files with `.fingerprintignore`.

## Channels and branches

- A **build** has a channel (from its `eas.json` profile). A **channel** points at a **branch**.
  `eas update --channel X` publishes to the branch linked to channel X (by default a branch with the
  same name).
- `eas channel:list`, `eas channel:view production`, `eas branch:list`, `eas update:list`.
- Point a channel at another branch: `eas channel:edit production --branch hotfix-1-4`.
- `Updates.channel` and `Updates.runtimeVersion` in the app tell you what a build will accept; both
  are `null` in Expo Go and development builds.

## Client behaviour (expo-updates)

- `updates.checkAutomatically`: `ON_LOAD` (default), `ON_ERROR_RECOVERY`, `WIFI_ONLY`, `NEVER`.
- `updates.fallbackToCacheTimeout`: default `0` → launch immediately with what's cached; a new update
  downloads in the background and applies on the **next** cold start.
- To apply sooner, check in JS and reload at a safe moment:
  ```ts
  import * as Updates from "expo-updates";
  const { isAvailable } = await Updates.checkForUpdateAsync();
  if (isAvailable) { await Updates.fetchUpdateAsync(); await Updates.reloadAsync(); }
  ```
  or use the `useUpdates()` hook (`isUpdateAvailable`, `isUpdatePending`, `checkError`…).
- Error recovery: if a new update crashes on launch, expo-updates can fall back to the previous update
  or the embedded one (`Updates.isEmergencyLaunch`, `emergencyLaunchReason`). It isn't a substitute for
  runtime-version discipline.
- `updates.maxUpdatesToKeep` defaults to 2.

## Environment variables

- SDK 55+: `eas update` requires `--environment <name>`; only that EAS environment's variables are used
  and local `.env` files are ignored. On SDK 54 and earlier, without the flag it falls back to local
  `.env` files.
- Secret-visibility variables are never available to updates (they can't leave EAS servers).
- `EXPO_PUBLIC_*` values are inlined into the bundle, so an update built with different values changes
  app behaviour — keep the update's environment the same as the build's.

## "Users aren't getting the update" checklist

1. `eas update:list` / `eas update:view <group>` — right branch, platform, runtime version?
2. Build's channel (`eas build:view` or `Updates.channel` in-app) → `eas channel:view <channel>` points
   to the branch you published to?
3. Runtime version of the build vs the update — with `fingerprint`, did a native change sneak in?
4. Is a rollout limiting it to a percentage?
5. Has the user cold-started the app twice (download, then apply)?
6. `updates.enabled` not `false`, and `updates.url` set in the build (rebuild after configuring).
7. Release build, not a dev client.
