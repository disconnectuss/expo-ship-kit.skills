# Submitting with EAS Submit

Checked 2026-10-29 against Expo's EAS Submit docs.

## iOS → App Store Connect / TestFlight

**Prerequisites**: paid Apple Developer account, bundle identifier in app config, an app record in App
Store Connect (EAS can create it on first interactive submit; set `ascAppId` afterwards).

**Auth for CI**: create an App Store Connect API key (Users and Access → Integrations → keys) with the
App Manager role, then `eas credentials -p ios` → "App Store Connect: Manage your API Key". Apple-ID
password logins need 2FA and break in CI.

**Flow**: `eas submit -p ios --latest` (or `--auto-submit` on the build). The build appears in
TestFlight after Apple's processing (minutes to an hour); missing privacy-manifest reasons and invalid
icons arrive as emails (ITMS-91053, ITMS-90717) during processing, not in the EAS log.

**After upload**: answer export compliance (or set `ios.config.usesNonExemptEncryption: false`), add
the build to a version, fill review information (demo account, notes — see `app-store-review-guard`),
choose manual vs automatic release and optional **phased release** (7-day automatic rollout you can
pause).

**Common upload errors**

| Error | Fix |
|---|---|
| Bundle version must be higher | Build number already used → remote versioning + autoIncrement, rebuild. |
| Train/version closed | `version` already released → bump `version`, rebuild. |
| SDK too old (ITMS-90725) | Built with Xcode < 26 → unset `ios.image`, upgrade Expo SDK if ≤ 53. |
| Auth failed | Expired session or bad API key → regenerate the ASC API key, set `ascAppId`. |

## Android → Google Play

**Prerequisites**: Play Console developer account; the app **created in Play Console** with exactly the
same `android.package`; a Google Cloud service account with the Google Play Android Developer API
enabled, invited in Play Console → Users and permissions with release permissions for the app. Upload
its JSON key with `eas credentials -p android` (or `serviceAccountKeyPath`, never committed).

**First submission**: `eas submit -p android` can create the first release itself (on the internal
testing track); uploading the first `.aab` by hand is no longer required. Create the app in Play
Console and finish its set-up first. Set `"releaseStatus": "draft"` to upload without rolling out.

The app stays a **draft** until the store listing, content rating, target audience, Data safety and
App access sections are done, and Google only accepts **draft releases on a draft app** — set
`"releaseStatus": "draft"` until the first release is live.

**New personal developer accounts** (created after 13 Nov 2023): production access requires a closed
test with 12+ testers opted in for 14 continuous days. Plan the `track` progression: internal →
closed (`alpha`/`beta` or a named track) → production.

**Staged rollout**: `"track": "production", "releaseStatus": "inProgress", "rollout": 0.1` releases to
10%; raise it in Play Console. `halted` pauses it.

**Common submit errors**

| Error | Fix |
|---|---|
| Only releases with status draft may be created on draft app | `releaseStatus: "draft"` until first release is live. |
| Version code already used | Remote versioning + autoIncrement (or bump `versionCode`), rebuild. |
| The caller does not have permission | Invite the service account in Play Console with release rights; enable the Android Publisher API; wait for permissions to propagate. |
| Package not found | App not created in Play Console, or wrong account / package name. |
| Target API level | Must target API 36+ since 31 Aug 2026 → remove low `targetSdkVersion` override / upgrade SDK. |
| APK not accepted | Production profile must build `.aab`. |
