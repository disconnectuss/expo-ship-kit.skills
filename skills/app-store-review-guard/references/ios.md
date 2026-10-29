# Apple App Store — checklist for Expo apps

Checked against the App Review Guidelines page stamped "Last Updated: October 16, 2026" and Apple's
Upcoming Requirements page. Guideline numbers are Apple's; the wording below is a paraphrase.

## Contents
1. Upload-time requirements (fail before review)
2. Reviewer access and completeness
3. Privacy and data
4. Accounts and login
5. Payments
6. Content, design and metadata
7. Expo-specific traps

---

## 1. Upload-time requirements

| Requirement | Since | Expo angle |
|---|---|---|
| Built with **Xcode 26+ and the iOS 26 SDK** or later | 28 Apr 2026 | Applies to TestFlight uploads too. Leave `ios.image` unset (EAS picks `auto` for your SDK; SDK 54+ gets Xcode 26+). A pinned `sdk-53`-or-older or `xcode-15/16` image fails the upload. `latest` is Xcode 27, which needs Expo SDK 58 or scene support enabled on SDK 57 (`expo@57.0.23+`, expo-build-properties `ios.enableSceneSupport`). Expo SDK 58 (Oct 2026) targets the iOS 27 SDK; Apple usually raises the floor each spring, so plan for an iOS 27 SDK requirement around April 2027 and confirm on the Upcoming Requirements page. |
| **Privacy manifest** reasons for "required reason" APIs (UserDefaults, file timestamps, system boot time, disk space, active keyboard) | 2024, ongoing | React Native links libraries statically, so Apple may not pick up per-library manifests. Declare them in `expo.ios.privacyManifests`. Apple emails missing reasons within minutes of an upload, so a TestFlight upload is the real test. |
| Apps must target **iOS 13 or later** | 9 Sep 2026 | Can't block an Expo app: Expo's minimum deployment target is 16.4+. |
| App icon: 1024×1024, no transparency | long-standing | `preflight.mjs` checks the PNG header. |

## 2. Reviewer access and completeness — 2.1(a), 2.1(b), 2.3.1(a), 2.3.12, 2.5.19

- Working **demo account** (or an Apple-approved demo mode) for anything behind a login. Turn off 2FA /
  SMS OTP for that account, or explain how to get the code.
- **Backend live** during review. Staging-only URLs, expired tokens, or IP allow-lists cause instant
  2.1 rejections.
- No placeholder text, "coming soon" tabs, lorem ipsum, or dead links.
- In-app purchases must be visible and functional for the reviewer, or the notes must say why one
  can't be found.
- **Notes for Review must describe new features specifically**; generic notes get rejected (2.3.1(a)).
- **What's New** text must list significant changes (2.3.12).
- **No hidden, dormant or undocumented features** (2.5.19, added 16 Oct 2026). Region locks,
  server-side flags, debug menus, and features that only appear after an OTA update all count if the
  reviewer can't see them. Obfuscating them is grounds for account termination. Fix: either remove them
  from the binary or document them and give the reviewer a way in.

## 3. Privacy and data — 5.1.1, 5.1.2

- **Privacy policy link** both in App Store Connect and inside the app, easy to find (5.1.1(i)). It
  must cover what's collected, how it's used, third parties, retention/deletion, and how to revoke
  consent.
- **Purpose strings** must explain the specific use (5.1.1(ii)). Bad: "This app needs camera access."
  Good: "Take a photo of your receipt so we can add the expense automatically."
- **Data minimisation** (5.1.1(iii)): prefer the system photo picker over full library access.
- **Don't force consent** (5.1.1(iv)): if location is declined, offer manual address entry; don't
  block the app.
- **Optional basic info** (5.1.1(x)): name/email requests must be optional unless core to the feature.
- **Third-party AI** (5.1.2(i)): if personal data goes to an external AI service, disclose it clearly
  and get explicit permission first. A one-time consent sheet before the first AI call, plus a
  privacy-policy section naming the provider, is the usual fix.
- **Tracking** (5.1.2(i)): cross-app tracking (most ad SDKs, Meta SDK, attribution SDKs) needs the App
  Tracking Transparency prompt. In Expo: `expo-tracking-transparency` + `NSUserTrackingUsageDescription`.
- **Don't require** push, location, or tracking to use the app or get a reward (5.1.2(i)).
- App Store Connect **privacy "nutrition label"** must match what the app and its SDKs actually do
  (2.3 accurate metadata).

## 4. Accounts and login — 5.1.1(v), 4.8

- If the app has no meaningful account features, **let people use it without logging in**.
- If users can create an account in the app, **account deletion must start in the app**. It may finish
  on a web page if you link directly to it. Deactivation alone isn't deletion.
- **4.8 Login Services**: if a third-party/social login (Google, Facebook, X, LinkedIn, Amazon, WeChat)
  is used for the primary account, also offer an equivalent login that collects only name + email,
  allows a private email, and doesn't track for ads without consent. Sign in with Apple
  (`expo-apple-authentication`) meets this. Not required if the app only uses its own account system,
  is an enterprise/education app using existing org accounts, uses a government eID, or is a client for
  that specific third-party service.
- Social-login apps must let users **revoke** the social connection from inside the app (5.1.1(v)).

### Sign in with Apple in Expo (the usual 4.8 fix)

- Firebase/Supabase email + password does **not** satisfy 4.8 on its own when Google is also offered,
  because users can't keep their email private. Either add Sign in with Apple, or remove the social
  login on iOS (an app with only its own accounts is exempt).
- Offer it as an **equivalent** option: same screens as Google, similar size and prominence. Use the
  system button (`AppleAuthentication.AppleAuthenticationButton`) and show it only when
  `isAvailableAsync()` is true.
- Config: `ios.usesAppleSignIn: true` and the `expo-apple-authentication` plugin. This adds a native
  entitlement, so it needs a **new EAS build** — it can't ship over EAS Update.
- Firebase: pass a SHA-256-hashed nonce to Apple and the raw nonce to
  `OAuthProvider('apple.com').credential(...)` (`expo-crypto` for hashing). Supabase:
  `signInWithIdToken({ provider: 'apple', token, nonce })`.
- Apple sends the user's **name only on the first sign-in**; store it then.
- "Hide My Email" users get `@privaterelay.appleid.com` addresses. Accept them, and register your
  outgoing mail domain with Apple's private email relay or your emails won't arrive.
- On **account deletion**, revoke the user's Apple tokens via Apple's REST API (Apple's account-deletion
  guidance expects this for Sign in with Apple accounts).
- Decide how to handle a user who signs in with Apple using the same email as an existing Google account
  (link or keep separate) before release.

## 5. Payments — 3.1.1, 3.1.2, 3.1.3

- **Digital content or features → In-App Purchase.** Unlocking premium features, subscriptions, credits
  and digital gift cards must use IAP (`expo-iap`, `react-native-iap`, or RevenueCat
  `react-native-purchases`). Stripe/PayPal checkout for digital goods is a rejection outside the
  storefronts and entitlements Apple lists in 3.1.1(a) (the US storefront has its own rules for
  external links — check before relying on it).
- **Physical goods and real-world services** (food delivery, rides, EV charging sessions, tickets)
  must NOT use IAP (3.1.3(e)). Stripe / Apple Pay are correct here.
- **Restore purchases** button for restorable items (3.1.1).
- **Subscriptions** (3.1.2): at least 7 days, work on all the user's devices, and the paywall must
  state what the user gets and the price before they subscribe (3.1.2(c)). Show price, period,
  auto-renew, and links to Terms and Privacy on the paywall itself.
- **Don't force a rating, review, or download** to unlock anything (3.2.2(x)). Rating prompts must use
  the system API (`expo-store-review`) — custom "rate us 5 stars" dialogs are disallowed (5.6.1).

## 6. Content, design and metadata

- **4.2 Minimum functionality**: a WebView wrapper around a website is the classic rejection. Add
  native value (offline, push, device features, native navigation).
- **4.3 Spam**: crowded categories (flashlight, wallpaper, simple timers, dating, fortune telling)
  need a meaningfully different experience. Multiple near-identical bundle IDs are spam.
- **1.2 User-generated content** (now explicitly covers AI content-creation apps): filtering,
  reporting, blocking users, and published contact info are all required. Apps that generate images of
  people need safeguards against nonconsensual intimate imagery.
- **1.5 / 5.6.2**: a working Support URL with real contact details.
- **2.3.3 Screenshots** show the app in use, not just a splash or login screen. **2.3.8** icons and
  screenshots must be suitable for a 4+ audience.
- **2.3.7** App name ≤ 30 characters, no keyword stuffing or competitor names.
- **2.4.1 iPad**: if `ios.supportsTablet` is true, the reviewer may test on iPad. Broken layouts or
  crashes on iPad are a common 2.1 rejection.
- **2.5.5 IPv6-only networks** must work (hard-coded IPv4 addresses break).
- **5.1.1(ix)** Regulated domains (finance, health, gambling, crypto exchanges, air travel) should be
  submitted by the legal entity, not an individual developer account.

## 7. Expo-specific traps

- **EAS Update / OTA** (2.5.2 + 2.5.19): shipping JS bug fixes over the air is normal. Changing what the
  app does, adding features, or switching on features after approval is the bait-and-switch Apple now
  names explicitly. Keep feature launches to store builds, or document them in the next review notes.
- **Default permission strings** from config plugins (`expo-camera`, `expo-location`,
  `expo-image-picker`, `expo-media-library`, `expo-contacts`, `expo-calendar`, `expo-audio`) — always
  pass custom strings through plugin options or `ios.infoPlist`.
- **Unused permissions**: libraries can add usage strings for features you don't use (e.g. microphone
  for video recording). Reviewers ask why. Disable via plugin options (e.g. `microphonePermission: false`)
  where supported.
- **Background modes**: only declare `UIBackgroundModes` you actually use (2.5.4). `location` in the
  background needs a clear user-facing reason.
- **Dev builds**: never submit a build with `expo-dev-client` UI enabled or a dev menu reachable.
- **`ITSAppUsesNonExemptEncryption`**: set `ios.config.usesNonExemptEncryption: false` if you only use
  standard HTTPS, to skip the export-compliance question on every upload.
