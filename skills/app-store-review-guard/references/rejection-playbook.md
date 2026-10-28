# Rejection playbook

Match the guideline number or phrase in the rejection message, then apply the fix. When replying in
App Store Connect, be short and factual: what changed, where the reviewer can see it, and (if needed)
new demo credentials. Resubmitting the same build with only a reply is fine when the reviewer
misunderstood; otherwise upload a new build.

## Apple

| Rejection | Usual cause in Expo apps | Fix |
|---|---|---|
| **2.1(a) App Completeness** — crash, bug, couldn't sign in | Demo account broken / 2FA on / backend on staging / crash on iPad | Fresh demo account, disable OTP for it, point production build at prod API, test on an iPad simulator if `supportsTablet` is true. Reply with steps. |
| **2.1(b)** IAP not found | Products not "Ready to Submit", or paywall hidden behind onboarding | Attach IAPs to the version, explain where the paywall appears. |
| **2.3.1(a)** notes too generic / feature not accessible | Review notes say "bug fixes"; new feature gated by a flag | Describe each new feature and how to reach it. Turn the flag on for the demo account. |
| **2.3.3** screenshots | Login/splash screens, or device frames from another platform | Screenshots of the app in use, on the right device sizes. |
| **2.5.19 / 2.3.1** hidden or undocumented features | Remote config switches features after approval; region-locked screens; debug menu | Remove from the binary or document + make reachable. Don't ship features via OTA that the reviewer never saw. |
| **4.2 Minimum Functionality** | WebView wrapper | Add native features, or ship as a web app. |
| **4.3(a)/(b) Spam** | Template app, crowded category, duplicate bundle IDs | Merge variants into one app; explain what's meaningfully different. |
| **4.8 Login Services** | Google/Facebook login without an equivalent private option | Add Sign in with Apple (`expo-apple-authentication`) or another login meeting 4.8's three conditions, with equal prominence. New native build required. Full Expo steps: `ios.md` → "Sign in with Apple in Expo". |
| **5.1.1(i) Privacy policy** | Link missing in-app, or policy doesn't mention a third-party SDK | Add a link in Settings/About; update the policy to name SDKs, retention, deletion. |
| **5.1.1(ii) Purpose string** | Expo default strings, or vague strings | Rewrite each `NS…UsageDescription` with the feature and benefit; pass plugin options. |
| **5.1.1(iv)** forcing permission | App blocks when location/notifications denied, or custom pre-prompt with only "Allow" | Offer a fallback (manual entry); pre-prompt screens must not push the user toward a choice. |
| **5.1.1(v) Account deletion** | Only "contact support" or deactivation | In-app "Delete account" that deletes (or starts deletion of) the account and data. |
| **5.1.1(v) Login required** | Login wall in front of features that don't need an account | Let users browse first; ask for login only for account features. |
| **5.1.2(i) Tracking / ATT** | Ad or attribution SDK reading IDFA without prompt; label says "no tracking" | Add `expo-tracking-transparency`, request before any tracking, fix the privacy label. |
| **5.1.2(i) Third-party AI** | User content sent to an LLM API without consent | Consent screen before first send, naming the provider; update privacy policy. |
| **3.1.1 In-App Purchase** | Stripe / web checkout for premium features or credits | Move digital goods to IAP. Keep Stripe only for physical goods/services. |
| **3.1.2(c) Subscriptions** | Price/period not visible on paywall, or "free trial" without the charge after | Show price, period, auto-renew, Terms + Privacy links on the paywall. |
| **5.6.1 / 3.2.2(x)** ratings | Custom "rate us" popup, or reward for rating | Use `expo-store-review`; remove incentives. |
| **ITMS-91053** (email after upload) | Missing privacy-manifest reason for a required-reason API | Add the listed API category + reason to `expo.ios.privacyManifests.NSPrivacyAccessedAPITypes`, rebuild. |
| **ITMS-90717** invalid icon | Icon has an alpha channel | Export the 1024×1024 PNG without transparency. |
| Upload refused: SDK too old | Old Xcode image pinned in `eas.json` | Remove `ios.image` so EAS picks the `auto` image for your SDK (SDK 54+ builds with Xcode 26+); upgrade the Expo SDK if it's 53 or older. |

## Google Play

| Rejection | Usual cause | Fix |
|---|---|---|
| Target API level too low | `targetSdkVersion` < 36 via `expo-build-properties`, or old Expo SDK | Raise to 36+ (upgrade Expo SDK), rebuild, test Android 16 behaviour changes. |
| Data safety mismatch | SDK collects data not declared (crash logs, device IDs, location) | Audit every SDK, update the form. |
| Account deletion | No in-app path, or no web link in the Data safety form | Add both; web link must work without the app and name the app. |
| App access / login | No test credentials in App access | Add credentials and instructions in Play Console → App content → App access. |
| Permissions declaration | Background location / photos / SMS without a declaration or core use | Remove via `android.blockedPermissions`, switch to the photo picker, or file the declaration with a video. |
| Production access denied (new personal account) | <12 engaged testers for 14 days | Recruit real testers, keep them active, answer the production-access questionnaire specifically. |
| Metadata | "Best", "#1", emoji or keyword lists in title/description | Rewrite listing plainly. |
