# eas.json — annotated template and key reference

Checked 2026-10-29 against Expo's eas.json reference and app-versions guide.

## Template (adapt, don't paste blindly)

```jsonc
{
  "cli": {
    "version": ">= 24.9.0",            // minimum EAS CLI for the team / CI (env:set, --force-end-active-rollout)
    "appVersionSource": "remote"        // EAS owns buildNumber/versionCode (recommended)
  },
  "build": {
    "base": {
      "node": "22.x",                   // match what you develop with
      "env": { "APP_VARIANT": "production" }  // non-secret build-time values only
    },
    "development": {
      "extends": "base",
      "developmentClient": true,
      "distribution": "internal",
      "environment": "development",
      "env": { "APP_VARIANT": "development" }
    },
    "preview": {
      "extends": "base",
      "distribution": "internal",       // ad hoc / APK-style installs for testers
      "environment": "preview",
      "channel": "preview",             // EAS Update channel for these builds
      "android": { "buildType": "apk" },// installable APK for testers; never for Play
      "env": { "APP_VARIANT": "preview" }
    },
    "production": {
      "extends": "base",
      "environment": "production",
      "channel": "production",
      "autoIncrement": true             // bumps buildNumber / versionCode remotely
      // "resourceClass": "large"       // only if you hit OOM / timeouts
    }
  },
  "submit": {
    "production": {
      "ios": {
        "ascAppId": "1234567890"        // App Store Connect → App Information → Apple ID
        // ASC API key: upload once with `eas credentials -p ios` instead of paths here
      },
      "android": {
        "track": "internal",            // internal → closed (alpha/beta) → production
        "releaseStatus": "draft"        // required until the app's first release is live
      }
    }
  }
}
```

`eas.json` is committed, so nothing secret goes in it. Secrets live in EAS environment variables
(`eas env:set --environment production --visibility secret`) and EAS-managed credentials.

## Build profile keys

| Key | Values / notes |
|---|---|
| `extends` | Inherit another profile (not per-platform). |
| `distribution` | `store` (default) or `internal`. |
| `channel` | EAS Update channel baked into the build; ignored for dev clients. |
| `environment` | `development`, `preview`, `production` (custom ones on higher plans). Picks which EAS environment variables load. If unset: `development` for dev clients, `production` for store distribution, otherwise `preview`. |
| `developmentClient` | `true` for dev-client builds. |
| `autoIncrement` | `true`; iOS also `"buildNumber"`/`"version"`, Android `"versionCode"`/`"version"`. With remote versioning only build numbers are managed. |
| `env` | Plain-text build-time variables. Not for secrets. |
| `resourceClass` | `default`, `medium`, `large` (large not on free plan). Android large = 8 vCPU / 32 GB; iOS large = 10 cores / 40 GiB. |
| `node`, `pnpm`, `yarn`, `bun`, `corepack` | Tool versions on the worker. |
| `cache` | `{ disabled, key, paths }`. |
| `credentialsSource` | `remote` (default) or `local` (`credentials.json`). |
| `withoutCredentials` | Build without signing (rare). |
| `buildArtifactPaths` | Extra artifacts to keep. |
| `ios.image` / `android.image` | Leave unset → `auto` image for your SDK. Aliases `sdk-54`…`sdk-58`, `latest`. |
| `ios.simulator` | `true` for a simulator build (internal only). |
| `ios.buildConfiguration`, `ios.scheme` | `Release` default; scheme required if several exist. |
| `android.buildType` | `app-bundle` (default, `.aab`) or `apk`. |
| `android.gradleCommand` | Custom Gradle task (overrides buildType). |

## Submit profile keys

**iOS**: `ascAppId`, `appleId`, `appleTeamId`, `ascApiKeyPath` + `ascApiKeyId` + `ascApiKeyIssuerId`,
`sku`, `language` (default `en-US`), `companyName` (first submission only), `appName`, `bundleIdentifier`,
`metadataPath` (store metadata file for `eas metadata`).

**Android**: `serviceAccountKeyPath` (or upload it with `eas credentials`), `track` (`production`,
`beta`, `alpha`, `internal`, or a custom closed track name), `releaseStatus` (`completed`, `draft`,
`halted`, `inProgress`), `rollout` (0–1, only with `inProgress`), `changesNotSentForReview`,
`applicationId`.

## Versioning in one paragraph

With `appVersionSource: "remote"`, EAS stores `ios.buildNumber` and `android.versionCode`; values in
app config are ignored. `autoIncrement` bumps them on each production build. Moving an existing app to
remote: `eas build:version:set` with the last number you submitted. `eas build:version:sync` writes the
remote numbers into local native projects. The user-facing `version` stays in app config and you bump it
per store release. The `nativeVersion` runtime policy isn't supported with remote versioning.
