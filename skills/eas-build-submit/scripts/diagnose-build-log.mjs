#!/usr/bin/env node
// eas-build-submit / diagnose-build-log.mjs
// Match an EAS Build / EAS Submit log against known failure patterns and print likely causes + fixes.
// Zero dependencies. Node 18+.
//
// Usage:
//   node diagnose-build-log.mjs build.log
//   pbpaste | node diagnose-build-log.mjs -
//   node diagnose-build-log.mjs build.log --json
//
// Exit codes: 0 = at least one known pattern matched, 3 = nothing matched, 2 = could not read the log.
//
// Get a log: download it from the build page on expo.dev, or copy the failed phase's output.
// The earliest failing phase is usually the real cause; later phases often just echo it.

import fs from "node:fs";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: node diagnose-build-log.mjs <log-file | -> [--json]");
  process.exit(2);
}
let log;
try {
  log = fs.readFileSync(file === "-" ? 0 : file, "utf8");
} catch (e) {
  console.error(`diagnose-build-log: can't read ${file}: ${e.message}`);
  process.exit(2);
}

// Each pattern: id, regex, title, where, cause, fixes. Ordered roughly by how specific the match is.
const PATTERNS = [
  // ---------- install / prepare ----------
  { id: "lockfile-out-of-date", re: /frozen[- ]lockfile|lockfile (is )?(out of date|needs to be updated)|ERR_PNPM_OUTDATED_LOCKFILE|npm ci can only install packages when your package\.json and package-lock\.json/i,
    title: "Lockfile doesn't match package.json", where: "Install dependencies",
    cause: "EAS installs with a frozen lockfile; package.json changed without updating the lockfile (or a different package manager wrote it).",
    fixes: ["Run your package manager's install locally and commit the updated lockfile.", "Keep exactly one lockfile (EAS picks the package manager from it)."] },
  { id: "peer-deps", re: /ERESOLVE|unable to resolve dependency tree|conflicting peer dependency/i,
    title: "npm peer dependency conflict", where: "Install dependencies",
    cause: "npm 7+ refuses conflicting peer dependencies.",
    fixes: ["Align versions: `npx expo install --fix`.", "If a library's peer range is just stale, add `legacy-peer-deps=true` to a committed .npmrc (last resort)."] },
  { id: "missing-file", re: /None of these files exist|ENOENT: no such file or directory, open '([^']+)'|Unable to resolve module ["']?([^\s"']+)/i,
    title: "File missing in the uploaded project", where: "Bundle JavaScript / Prebuild",
    cause: "The file exists locally but isn't in the archive EAS uploads — usually gitignored (a .env-generated file, google-services.json, a local config) — or the import path's case differs (macOS is case-insensitive, EAS Linux workers are not).",
    fixes: ["`git check-ignore -v <path>` to see if it's ignored.", "For secrets/files: create an EAS file environment variable and read its path from process.env in app.config.js.", "Fix import casing to match the file name exactly."] },

  // ---------- JS bundle ----------
  { id: "js-bundle", re: /bundleReleaseJsAndAssets FAILED|Metro encountered an error|SyntaxError: .*\.(t|j)sx?|createBundleReleaseJsAndAssets FAILED/i,
    title: "JavaScript bundling failed", where: "Run gradlew / Run fastlane (bundle step)",
    cause: "Metro couldn't build the production JS bundle (bad import, syntax error, Babel/Metro config, missing env-dependent file).",
    fixes: ["Reproduce in seconds locally: `npx expo export --platform android` (or ios).", "Scroll up in the log to the first Metro error; the Gradle/Xcode error below it is just the echo."] },
  { id: "js-oom", re: /JavaScript heap out of memory|Reached heap limit|Gradle build daemon disappeared unexpectedly/i,
    title: "Out of memory while bundling/building", where: "Bundle JavaScript / Run gradlew",
    cause: "Node or Gradle ran out of memory — big bundle, large assets, or many native modules.",
    fixes: ['Use `"resourceClass": "large"` on the profile (paid plans).', "Find what bloats the bundle with Expo Atlas (`EXPO_ATLAS=1 npx expo export`).", "Android: raise Gradle heap via expo-build-properties or gradle.properties `org.gradle.jvmargs=-Xmx4g`."] },

  // ---------- iOS: pods ----------
  { id: "pods-incompatible", re: /CocoaPods could not find compatible versions for pod|Unable to find a specification for|required a higher minimum deployment target/i,
    title: "CocoaPods dependency conflict", where: "Install pods",
    cause: "Two libraries need incompatible versions of a pod, a pod needs a higher iOS deployment target, or a library isn't compatible with this Expo SDK.",
    fixes: ["`npx expo install --fix` and `npx expo-doctor`.", 'Raise the target with expo-build-properties: `["expo-build-properties", { "ios": { "deploymentTarget": "16.4" } }]` (only if the library really needs it).', "Check the failing library's release notes for SDK compatibility."] },
  { id: "podfile-invalid", re: /Invalid `Podfile` file|\[!\] .*Podfile/i,
    title: "Podfile error", where: "Install pods",
    cause: "A config plugin wrote invalid Podfile content, or a committed ios/ folder is out of date.",
    fixes: ["`npx expo prebuild --clean -p ios` locally and read the Podfile error.", "If ios/ is committed, regenerate it or fix it by hand."] },

  // ---------- iOS: signing ----------
  { id: "ios-capability", re: /doesn't (support|include) the .* capability|Provisioning profile .* doesn't include the .* entitlement|requires a provisioning profile with the/i,
    title: "Provisioning profile is missing a capability", where: "Run fastlane",
    cause: "A new entitlement (push notifications, Sign in with Apple, associated domains, App Groups…) was added but the provisioning profile predates it.",
    fixes: ["Run `eas credentials -p ios` and regenerate the provisioning profile (or let `eas build` sync capabilities when it asks).", "Make sure the capability is enabled for the bundle ID in the Apple Developer portal."] },
  { id: "ios-signing", re: /No profiles for '[^']+' were found|Signing for "[^"]+" requires a development team|Code signing is required|no signing certificate|certificate .* (revoked|expired)/i,
    title: "iOS code signing failed", where: "Run fastlane",
    cause: "Credentials missing, expired or revoked, or local credentials (credentialsSource: local) don't match the bundle ID.",
    fixes: ["`eas credentials -p ios` to inspect and regenerate.", "Check the bundle identifier matches the App ID the profile was made for.", "If you use local credentials, verify credentials.json paths and passwords."] },
  { id: "ios-phase-script", re: /PhaseScriptExecution .* failed|Command PhaseScriptExecution failed with a nonzero exit code/i,
    title: "An Xcode build script failed", where: "Run fastlane",
    cause: "Generic wrapper error. The real cause is above it: usually the JS bundle step, a Sentry/Crashlytics upload script (missing auth token), or a Hermes compile error.",
    fixes: ["Search upward for the first `error:` line in the Xcode log (download the full Xcode logs from the build page).", "Sentry: set SENTRY_AUTH_TOKEN (secret) in the EAS environment, or SENTRY_DISABLE_AUTO_UPLOAD=true to unblock."] },
  { id: "sentry-auth", re: /SENTRY_AUTH_TOKEN|An organization (ID|slug) is required|sentry-cli.*(error|failed)|error: Auth token is required/i,
    title: "Sentry source map upload failed", where: "Run gradlew / Run fastlane",
    cause: "The Sentry build plugin can't authenticate during the build.",
    fixes: ["Add SENTRY_AUTH_TOKEN as a secret EAS environment variable for this environment.", "Check organization/project in the @sentry/react-native config plugin options."] },

  // ---------- Android ----------
  { id: "android-duplicate-class", re: /Duplicate class .* found in modules|checkReleaseDuplicateClasses/i,
    title: "Duplicate Android classes", where: "Run gradlew",
    cause: "Two dependencies ship the same Java/Kotlin classes (often an old support library vs AndroidX, or two versions of a library).",
    fixes: ["Find which packages pull them in (`./gradlew app:dependencies` after prebuild).", "Upgrade or remove the outdated library; `npx expo install --fix`."] },
  { id: "android-minsdk", re: /minSdkVersion \d+ cannot be smaller than version \d+/i,
    title: "Library needs a higher minSdkVersion", where: "Run gradlew",
    cause: "A dependency requires a higher Android minimum SDK than the project sets.",
    fixes: ['Raise it with expo-build-properties: `["expo-build-properties", { "android": { "minSdkVersion": 24 } }]` (use the number from the error).'] },
  { id: "android-kotlin", re: /compiled with an incompatible version of Kotlin|Kotlin .* version .* (incompatible|not supported)/i,
    title: "Kotlin version mismatch", where: "Run gradlew",
    cause: "A library was compiled with a newer Kotlin than the project uses (or vice versa).",
    fixes: ["Upgrade the library to a version that matches your Expo SDK.", "As a stopgap, set `android.kotlinVersion` in expo-build-properties."] },
  { id: "google-services", re: /File google-services\.json is missing|google-services\.json.*(not found|missing)|GoogleService-Info\.plist.*(not found|missing)/i,
    title: "Firebase config file missing", where: "Prebuild / Run gradlew",
    cause: "googleServicesFile points to a file that isn't in the upload (usually gitignored).",
    fixes: ["Upload it as an EAS file variable (secret) and set `android.googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json'` in app.config.js."] },
  { id: "android-sdk-license", re: /licences? for the following SDK packages have not been accepted|Failed to install the following Android SDK packages/i,
    title: "Android SDK component not available", where: "Run gradlew",
    cause: "The build needs an SDK/NDK/build-tools version not on the image — often a library pinning an unusual compileSdk or NDK.",
    fixes: ["Use the image that matches your Expo SDK (leave android.image unset).", "Align compileSdk/NDK via expo-build-properties."] },
  { id: "cmake-ndk", re: /CMake Error|ninja: build stopped|NDK (is not installed|at .* did not have a source\.properties)/i,
    title: "Native C++ build failed", where: "Run gradlew",
    cause: "A library with C++ code failed to compile — NDK mismatch or library not compatible with this React Native version.",
    fixes: ["Upgrade the library; check it supports the New Architecture and your RN version.", "Leave android.image unset so the NDK matches the SDK."] },

  // ---------- infra ----------
  { id: "timeout", re: /exceeded the maximum build time|build timed out|Build timed out/i,
    title: "Build timed out", where: "Any",
    cause: "Build exceeded the plan's time limit.",
    fixes: ['Use `"resourceClass": "large"`.', "Enable caching (`cache.paths`) for heavy steps; check for a hanging postinstall script."] },
  { id: "unknown-error", re: /Unknown error\. See logs of the (.+?) build phase/i,
    title: "EAS reported an unknown error", where: "See named phase",
    cause: "EAS couldn't classify the failure; the named phase has the details.",
    fixes: ["Open that phase in the build page and look for the first error line.", "Compare with the last successful build (Compare button on the build page)."] },

  // ---------- submit: iOS ----------
  { id: "ios-build-number-used", re: /bundle version must be higher than the previously uploaded version|CFBundleVersion.*(already|higher)|ITMS-90189|ITMS-4238/i,
    title: "iOS build number already used", where: "EAS Submit (iOS)",
    cause: "App Store Connect already has a build with this buildNumber for this version.",
    fixes: ['Use remote versioning with autoIncrement: `"cli": { "appVersionSource": "remote" }` + `"autoIncrement": true`, then rebuild.', "Or bump ios.buildNumber and rebuild. A build can't be re-uploaded."] },
  { id: "ios-version-closed", re: /train version .* is closed|ITMS-90062|This bundle is invalid\. The value for key CFBundleShortVersionString/i,
    title: "Version already released", where: "EAS Submit (iOS)",
    cause: "The user-facing version (CFBundleShortVersionString) was already approved/released; new builds need a higher version.",
    fixes: ["Bump `version` in app config and rebuild."] },
  { id: "ios-icon-alpha", re: /ITMS-90717|Invalid App Store Icon/i,
    title: "App icon has transparency", where: "EAS Submit (iOS) / App Store Connect processing",
    cause: "The 1024×1024 icon has an alpha channel.",
    fixes: ["Export the icon without transparency and rebuild."] },
  { id: "ios-privacy-manifest", re: /ITMS-91053|Missing API declaration/i,
    title: "Privacy manifest reason missing", where: "App Store Connect processing (email)",
    cause: "The binary calls a required-reason API that isn't declared.",
    fixes: ["Add the API category + reason to expo.ios.privacyManifests.NSPrivacyAccessedAPITypes and rebuild (see app-store-review-guard)."] },
  { id: "ios-sdk-too-old", re: /ITMS-90725|built with an SDK|SDK version issue|must be built with (Xcode|the iOS) \d+/i,
    title: "Built with an SDK Apple no longer accepts", where: "EAS Submit (iOS)",
    cause: "Since 28 Apr 2026 uploads must use Xcode 26+ / iOS 26 SDK.",
    fixes: ["Remove a pinned ios.image (EAS picks the auto image for your SDK), or upgrade the Expo SDK (54+ builds with Xcode 26+)."] },
  { id: "asc-auth", re: /Authentication with Apple Developer Portal failed|App Store Connect API key .* (invalid|revoked)|401 Unauthorized.*appstoreconnect|NOT_AUTHORIZED/i,
    title: "App Store Connect authentication failed", where: "EAS Submit (iOS)",
    cause: "Apple ID session or ASC API key invalid, revoked, or lacking the App Manager role.",
    fixes: ["Create an App Store Connect API key (App Manager or Admin) and set it with `eas credentials -p ios` or ascApiKeyPath/ascApiKeyIssuerId/ascApiKeyId in the submit profile.", "Set ascAppId in the submit profile so EAS doesn't try to look up or create the app."] },

  // ---------- submit: Android ----------
  { id: "play-draft-app", re: /Only releases with status draft may be created on draft app/i,
    title: "Play app is still a draft", where: "EAS Submit (Android)",
    cause: "The app has never been published, so Google only accepts draft releases.",
    fixes: ['Set `"releaseStatus": "draft"` in the Android submit profile, then complete the release in Play Console. Switch back to "completed" after the first release goes live.',
      'First release: use `"track": "internal"`. New personal accounts (created after 13 Nov 2023) can\'t publish to production until a 12-tester / 14-day closed test is done.',
      "Finish store listing, content rating, target audience, Data safety and App access in Play Console. See references/submit.md."] },
  { id: "play-version-code", re: /Version code \d+ has already been used|APK specifies a version code that has already been used/i,
    title: "Android versionCode already used", where: "EAS Submit (Android)",
    cause: "Play Console already has a build with this versionCode.",
    fixes: ["Use remote versioning with autoIncrement, or bump android.versionCode and rebuild."] },
  { id: "play-permission", re: /The caller does not have permission|Google Api Error: Invalid request - Insufficient permissions|403.*androidpublisher/i,
    title: "Service account lacks Play Console permissions", where: "EAS Submit (Android)",
    cause: "The Google service account isn't invited to the Play Console account, or lacks release permissions for this app.",
    fixes: ["Play Console → Users and permissions → invite the service account email with release permissions for the app.", "Make sure the Google Play Android Developer API is enabled in the service account's Google Cloud project. Permissions can take a while to apply."] },
  { id: "play-package-not-found", re: /Package not found: |applicationNotFound|No application was found for the given package name/i,
    title: "App not found in Play Console", where: "EAS Submit (Android)",
    cause: "The package name doesn't match an app in this Play Console account, or the app hasn't been created yet.",
    fixes: ["Create the app in Play Console with exactly the same android.package.", "Check you're using the right developer account's service account key."] },
  { id: "play-target-sdk", re: /target (API|SDK) level|targetSdkVersion.*(at least|must be)|Your app currently targets API level \d+/i,
    title: "Target API level too low", where: "Play Console / EAS Submit (Android)",
    cause: "Since 31 Aug 2026 new apps and updates must target API 36+.",
    fixes: ["Remove a low targetSdkVersion override in expo-build-properties; upgrade the Expo SDK if its default is below 36."] },
  { id: "play-apk", re: /APKs are not (allowed|accepted)|must be uploaded as an Android App Bundle/i,
    title: "Uploaded an APK", where: "EAS Submit (Android)",
    cause: "Google Play requires app bundles for new apps.",
    fixes: ["Remove android.buildType: apk from the production profile and rebuild (.aab is the default)."] },
];

// What the next attempt needs, derived from where the failure happens.
const nextStep = (where) =>
  /Submit|Play Console|App Store Connect/.test(where)
    ? "Resubmit the same build after fixing (no rebuild) — unless the fix changes the binary (version, icon, SDK, target API, privacy manifest)."
    : "Rebuild after fixing.";

// ---------- match ----------
const lines = log.split(/\r?\n/);
const matches = [];
for (const p of PATTERNS) {
  const idx = lines.findIndex((l) => p.re.test(l));
  if (idx >= 0) matches.push({ ...p, line: idx + 1, excerpt: lines.slice(Math.max(0, idx - 2), idx + 3).join("\n") });
}
// Earliest match first: the first failure in the log is usually the root cause.
matches.sort((a, b) => a.line - b.line);

const firstErrors = [];
for (let i = 0; i < lines.length && firstErrors.length < 8; i++) {
  if (/(^|\s)(error|ERROR|FAILED|Error:|\[!\]|✖|fatal)/.test(lines[i]) && !/warning/i.test(lines[i])) firstErrors.push(`${i + 1}: ${lines[i].trim().slice(0, 220)}`);
}

if (asJson) {
  console.log(JSON.stringify({ matches: matches.map(({ re, ...m }) => ({ ...m, next: nextStep(m.where) })), firstErrors }, null, 2));
} else {
  if (!matches.length) {
    console.log("No known pattern matched.\n");
  } else {
    console.log(`\n${matches.length} known pattern(s) matched (earliest first — fix the first one):\n`);
    for (const m of matches) {
      console.log(`● ${m.title}  [${m.where}]  (log line ${m.line})`);
      console.log(`  Why: ${m.cause}`);
      for (const f of m.fixes) console.log(`  → ${f}`);
      console.log(`  Next: ${nextStep(m.where)}`);
      console.log(`  Log:\n${m.excerpt.split("\n").map((l) => "    | " + l.slice(0, 200)).join("\n")}\n`);
    }
  }
  if (firstErrors.length) {
    console.log("First error-looking lines in the log:");
    for (const l of firstErrors) console.log("  " + l);
  }
  if (!matches.length)
    console.log("\nNext: find the earliest failing phase on the build page, reproduce locally (`npx expo export`, `npx expo run:<platform>` with a release configuration, or `eas build --local`), and compare with the last green build.");
}
process.exit(matches.length ? 0 : 3);
