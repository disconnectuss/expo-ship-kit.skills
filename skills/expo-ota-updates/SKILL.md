---
name: expo-ota-updates
description: Ship JavaScript fixes to Expo / React Native apps over the air with EAS Update — decide whether a change can go out as an OTA update or needs a new store build, set up runtimeVersion (fingerprint / appVersion) and channels, publish with the right environment, do percentage rollouts, and roll back a bad update. Use this whenever someone wants a hotfix without waiting for App Review, asks "can I push this as an update?", mentions eas update, expo-updates, runtime version, channels/branches, rollout or rollback, or reports that users aren't receiving an update or the app crashes after one — even if they don't say "OTA".
license: MIT
compatibility: Node.js 18+ and git for scripts/ota-or-build.mjs. EAS CLI for the commands.
metadata:
  version: "0.1.0"
  rules-checked-on: "2026-10-28"
  part-of: expo-ship-kit
---

# Expo OTA Updates

EAS Update replaces the JS bundle and assets of an installed app without a store release. That's
powerful and easy to misuse: an update that calls native code missing from the installed binary
crashes, an update published to the wrong channel reaches nobody, and a feature switched on over the
air without review is exactly what Apple's guideline 2.5.19 now punishes.

Script path is relative to this skill's folder (in a Claude Code plugin:
`${CLAUDE_PLUGIN_ROOT}/skills/expo-ota-updates`).

## 1. Can this ship as an update?

```bash
node <skill-dir>/scripts/ota-or-build.mjs                       # last tag → working tree
node <skill-dir>/scripts/ota-or-build.mjs --base v1.4.0 --head main
```

It classifies every change since the base ref (the commit the current store build came from — ask
for it if there are no tags): native folders, config plugins, `app.json` native keys, native
dependencies (checked in `node_modules`), patches, icons/splash → **build**; JS, assets, `extra`,
JS-only packages → **OTA**; dynamic `app.config.*`, lockfile-only changes, unknown packages →
**verify**. Exit codes: 0 OTA, 1 build, 3 unsure, 2 could not run.

No repo to run it on? Reason the same way: a new or upgraded package with native code (most
`react-native-*` and `expo-*` modules, anything with a config plugin), a change to `plugins`, `ios`,
`android`, icons or splash, or an Expo SDK bump → build. Pure TS/JS, JSON content and images → OTA.

When it says "unsure", the authoritative check is the fingerprint: run `eas fingerprint:compare` and
pick the production build that's in users' hands when it prompts (or compare on the build page). With `runtimeVersion: { "policy": "fingerprint" }` a native change
produces a new runtime version automatically, so an update simply won't be offered to incompatible
builds — the risk then becomes "users don't get the fix" rather than "users crash".

Even when the code is OTA-safe, say so if the change is a **new feature or behaviour change** rather
than a fix: Apple expects features to go through review (2.3.1(a), 2.5.19). OTA is for fixes and small
content changes; features belong in a store build or in the next version's review notes.

### Fix and native change on the same branch (the common case)

`eas update` bundles whatever is checked out in the working tree, not a git ref. So when the fix sits
next to a native change, ship the fix from a branch cut at the store build's commit:

```bash
git switch -c hotfix/checkout-crash <store-build-tag>
git cherry-pick <fix-commit>          # only the fix
npm ci                                # node_modules must match this branch, not the feature branch
node <skill-dir>/scripts/ota-or-build.mjs --base <store-build-tag>   # expect OTA
eas update --channel production --environment production --rollout-percentage 10 --message "Fix checkout crash"
```

Merge the fix back into the main line so the next build has it, and keep the hotfix branch until most
users have moved to the new build — fixes for the old runtime must come from there.

## 2. Set-up check (first time, or "users don't get updates")

Walk `references/setup.md`. The usual culprits, in order:

1. Build has no `channel` in its `eas.json` profile, or the update went to a different branch/channel.
2. `runtimeVersion` of the update ≠ the build's (wrong policy, version bumped, native change).
3. Update published without `--environment` (required on SDK 55+), so env vars differ from the build.
4. App only checks on cold start (`checkAutomatically: ON_LOAD`) and the user hasn't restarted twice —
   the default downloads on one launch and applies on the next.
5. Testing in a dev client / Expo Go (`Updates.channel` is null there) instead of a release build.

## 3. Publish

```bash
eas update --channel production --environment production --message "Fix crash on checkout"
eas update --channel production --environment production --platform ios --message "…"   # one platform
eas update --channel production --environment production --rollout-percentage 10 --message "…"
```

- `--environment` loads the EAS environment variables (required on SDK 55+; secret-visibility
  variables are never available to updates). Without matching variables an update can silently point
  the app at the wrong backend.
- Prefer publishing to a staging channel and testing on a preview build first.
- Record what went out: message, git commit, and the update group ID.

## 4. Roll out and roll back

`references/rollouts.md` has the details. Short version:

- **Per-update rollout**: `--rollout-percentage 10`, raise with `eas update:edit`, undo with
  `eas update:revert-update-rollout`. One active rollout per branch + platform + runtime version.
- **Branch rollout**: `eas channel:rollout` moves a percentage of a channel to a new branch.
- **Bad update**: `eas update:rollback` → republish the previous good update, or roll back to the
  update embedded in the build. After a rollback, the next published update goes to everyone.

## 5. Report

When advising on a specific change, answer with: verdict (OTA / build / verify), the reasons, the exact
commands for the chosen path, and the rollback command to keep ready. If it needs a build, hand off to
`expo-release-preflight` and `eas-build-submit`.
