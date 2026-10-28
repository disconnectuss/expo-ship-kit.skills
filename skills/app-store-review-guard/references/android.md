# Google Play — checklist for Expo apps

Checked against Google Play Console Help and the Android Developers target-API page (October 2026).

## 1. Target API level

| Who | Must target | Since |
|---|---|---|
| New apps and app updates (phone/tablet) | **Android 16 (API 36)** or higher | 31 Aug 2026 |
| Wear OS and Android Automotive OS | Android 15 (API 35) | 31 Aug 2026 |
| Android TV and Android XR | Android 14 (API 34) | 31 Aug 2026 |
| Existing apps, to stay visible to new users on newer Android versions | Android 15 (API 35) | 31 Aug 2026 |

Google has offered extensions to 1 November 2026 for apps that requested one in Play Console. After
that, updates below API 36 are refused at upload.

Expo angle: the target SDK comes from the Expo SDK's defaults or `expo-build-properties`
(`android.targetSdkVersion`). A manual override below 36 is a blocker. To confirm the real value, run
`npx expo prebuild --platform android` locally and read `android/build.gradle`, or check the uploaded
bundle in Play Console. Expect Google to require API 37 around August 2027.

## 2. Closed testing for new personal accounts

- Personal developer accounts created **after 13 November 2023** must run a **closed test with at
  least 12 testers opted in for 14 continuous days** before applying for production access.
- Applies per app, until that account has production access for the app. Internal testing doesn't
  count. Organization accounts (D-U-N-S) are exempt.
- Google has started rejecting production-access requests for low tester engagement. Testers should
  actually open and use the app, and you'll be asked what you learned and changed.
- Budget about three weeks for a first launch on a new personal account.

## 2b. First upload

- Create the app in Play Console first. Try `eas submit -p android` with `track: internal` and
  `releaseStatus: draft`; if Google refuses that first upload, upload the `.aab` by hand to Internal
  testing and automate from then on (Expo's docs differ on whether the very first automated upload works). The app stays a draft until the store
  listing, content rating, Data safety and App access sections are complete. Details: `eas-build-submit`.
- Submit an `.aab`, not an `.apk`.
- `android.package` can never change after that first upload.

## 3. Data safety form

- Required for every app, including apps that collect nothing.
- Must match the app **and every SDK** in it (analytics, crash reporting, ads, auth). Mismatches between
  the declaration and what the binary does are a common rejection. Check each SDK vendor's Data safety
  guidance.
- Declare encryption in transit and the data deletion answers truthfully.

## 4. Account deletion (User Data policy)

If users can create an account from inside the app:

1. Provide an **in-app path** to delete the account and its associated data.
2. Provide a **web link** where users can request the same deletion without the app installed. It must
   load without errors, make the deletion path easy to find, and name the app or developer as they
   appear on the store listing. An email address or a form is acceptable.
3. Enter that URL in the **Data safety form** (App content page).

This is the main difference from Apple: an iOS-only in-app flow is not enough for Play.

## 5. Sensitive permissions

These need either a Play Console declaration form or a strong core-use justification, and are frequent
rejection causes. Remove them via `android.blockedPermissions` if a library adds them and you don't use
them.

- `ACCESS_BACKGROUND_LOCATION` — declaration + video showing the feature; prominent in-app disclosure
  before the runtime prompt.
- `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` — Photo and Video Permissions policy: only for apps whose
  core purpose needs broad access. Others must use the system photo picker.
- `READ_SMS`, `SEND_SMS`, `READ_CALL_LOG`, `PROCESS_OUTGOING_CALLS` — SMS/Call Log policy; default
  handler apps only, in practice.
- `QUERY_ALL_PACKAGES` — package visibility declaration.
- `MANAGE_EXTERNAL_STORAGE` — All files access declaration.
- `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` — only calendar/alarm-clock core use.
- Foreground service types (Android 14+) — each declared type needs a justification in Play Console.

## 6. Other common Play rejections

- **Login-gated app without test credentials** in App access (Policy → App content → App access).
- **Privacy policy URL** missing, broken, or a generic template that doesn't name the app.
- **Metadata policy**: keyword stuffing, ranking claims ("#1", "best"), emoji in the title.
- **Play Billing** for digital goods sold in-app (same idea as Apple IAP; physical goods and real-world
  services are exempt). Keep the Play Billing Library current — Google deprecates old major versions on
  a yearly cycle, so check the minimum version in Play Console warnings before release.
- **Target audience and content**: if children are in the target audience, Families policy applies
  (no non-certified ad SDKs, stricter data rules).
- **Health apps** need the Health apps declaration; **financial/loan apps** have country-specific
  requirements.
