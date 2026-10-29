# EAS Workflows (CI/CD)

Workflows live in `.eas/workflows/*.yml` and run on EAS. Pre-packaged job types include `build`,
`submit`, `update`, `fingerprint`, `get-build`, plus jobs for Maestro tests, Slack messages and EAS
Hosting deploys; anything else is a custom job with `steps`. Run any workflow manually with
`eas workflow:run <file>`.

Job keys below match Expo's docs as of 2026-10-29; the schema evolves, so check the workflow syntax
reference if a key is rejected.

## Release on push to main

```yaml
name: Release
on:
  push:
    branches: ['main']
jobs:
  build_ios:
    type: build
    params:
      platform: ios
      profile: production
  build_android:
    type: build
    params:
      platform: android
      profile: production
  submit_ios:
    type: submit
    needs: [build_ios]
    params:
      build_id: ${{ needs.build_ios.outputs.build_id }}
  submit_android:
    type: submit
    needs: [build_android]
    params:
      build_id: ${{ needs.build_android.outputs.build_id }}
```

Non-interactive submission needs stored credentials: `ascAppId` + an ASC API key for iOS, a service
account key for Android, both set up once with `eas credentials`.

## Update if possible, build only when native code changed

From Expo's EAS Workflows example "Deploy to production" (`.eas/workflows/deploy-to-production.yml`, verified 2026-10-29). The `fingerprint` job
hashes the native runtime; `get-build` looks for an existing build with that hash. If one exists, only
JS changed and an OTA update is enough; otherwise build and submit.

```yaml
name: Deploy to production
on:
  push:
    branches: ['release/*']
jobs:
  fingerprint:
    name: Fingerprint
    type: fingerprint
    environment: production
  get_android_build:
    needs: [fingerprint]
    type: get-build
    params:
      fingerprint_hash: ${{ needs.fingerprint.outputs.android_fingerprint_hash }}
      profile: production
  get_ios_build:
    needs: [fingerprint]
    type: get-build
    params:
      fingerprint_hash: ${{ needs.fingerprint.outputs.ios_fingerprint_hash }}
      profile: production
  build_android:
    needs: [get_android_build]
    if: ${{ !needs.get_android_build.outputs.build_id }}
    type: build
    params:
      platform: android
      profile: production
  build_ios:
    needs: [get_ios_build]
    if: ${{ !needs.get_ios_build.outputs.build_id }}
    type: build
    params:
      platform: ios
      profile: production
  update_android:
    needs: [get_android_build]
    if: ${{ needs.get_android_build.outputs.build_id }}
    type: update
    params:
      branch: production
      platform: android
  update_ios:
    needs: [get_ios_build]
    if: ${{ needs.get_ios_build.outputs.build_id }}
    type: update
    params:
      branch: production
      platform: ios
  submit_android:
    needs: [build_android]
    type: submit
    params:
      build_id: ${{ needs.build_android.outputs.build_id }}
  submit_ios:
    needs: [build_ios]
    type: submit
    params:
      build_id: ${{ needs.build_ios.outputs.build_id }}
```

Submit jobs are skipped when only an update runs, because no build was created.

This pattern pairs with `runtimeVersion: { "policy": "fingerprint" }` — see `expo-ota-updates`.

## GitHub Actions alternative

If the team prefers GitHub Actions: `expo/expo-github-action` sets up EAS CLI with an `EXPO_TOKEN`
(robot user access token) secret, then run `eas build --non-interactive --no-wait` /
`eas update --auto --environment production --non-interactive`.
