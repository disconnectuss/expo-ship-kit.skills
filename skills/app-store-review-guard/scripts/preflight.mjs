#!/usr/bin/env node
// app-store-review-guard / preflight.mjs
// Static pre-submission checks for Expo / React Native apps.
// Zero dependencies. Node 18+.
//
// Usage:
//   node preflight.mjs [--project <dir>] [--config <resolved-config.json>] [--json] [--no-source-scan]
//
// Exit codes: 0 = no blockers, 1 = at least one error, 2 = could not run.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const RULES_CHECKED_ON = "2026-10-29";
const MIN_ANDROID_TARGET_SDK = 36; // Google Play, new apps + updates, since 2026-08-31

// ---------- args ----------
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const projectDir = path.resolve(opt("--project") ?? process.cwd());
const asJson = flag("--json");
const scanSource = !flag("--no-source-scan");

// ---------- helpers ----------
const findings = [];
const add = (severity, platform, rule, message, fix) =>
  findings.push({ severity, platform, rule, message, fix });
const err = (...a) => add("error", ...a);
const warn = (...a) => add("warning", ...a);
const info = (...a) => add("info", ...a);

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return undefined;
  }
};
const exists = (p) => {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
};

function loadConfig() {
  const explicit = opt("--config");
  if (explicit) {
    const j = readJson(path.resolve(explicit));
    if (!j) fail(`Could not read --config ${explicit}`);
    return { config: j.expo ?? j.exp ?? j, source: explicit };
  }
  // Prefer the resolved config (handles app.config.js/ts). Not --type public: it strips ios.config / android.config.
  if (exists(path.join(projectDir, "node_modules", "expo"))) {
    try {
      const out = execSync("npx --no-install expo config --json", {
        cwd: projectDir,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 60_000,
      }).toString();
      const j = JSON.parse(out);
      return { config: j.exp ?? j, source: "npx expo config" };
    } catch {
      /* fall through */
    }
  }
  const appJson = readJson(path.join(projectDir, "app.json"));
  if (appJson) return { config: appJson.expo ?? appJson, source: "app.json" };
  if (exists(path.join(projectDir, "app.config.ts")) || exists(path.join(projectDir, "app.config.js"))) {
    fail(
      "Found app.config.* but could not resolve it. Run `npm install` first, or pass " +
        "--config with the output of `npx expo config --json`."
    );
  }
  fail("No app.json / app.config.* found. Run from the Expo project root or pass --project.");
}

function fail(msg) {
  if (asJson) console.log(JSON.stringify({ error: msg }));
  else console.error(`preflight: ${msg}`);
  process.exit(2);
}

const majorOf = (range) => {
  const m = String(range ?? "").match(/(\d+)/);
  return m ? Number(m[1]) : undefined;
};

// Find a plugin entry in config.plugins: "name" or ["name", options]
function plugin(config, name) {
  for (const p of config.plugins ?? []) {
    if (p === name) return { options: {} };
    if (Array.isArray(p) && p[0] === name) return { options: p[1] ?? {} };
  }
  return undefined;
}

// Reads PNG IHDR: width, height, color type (4/6 = has alpha).
function pngInfo(file) {
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(33);
    fs.readSync(fd, buf, 0, 33, 0);
    fs.closeSync(fd);
    const sig = buf.subarray(0, 8).toString("hex");
    if (sig !== "89504e470d0a1a0a") return { png: false };
    return {
      png: true,
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
      colorType: buf.readUInt8(25),
    };
  } catch {
    return undefined;
  }
}

function* walk(dir, depth = 0) {
  if (depth > 8) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || ["node_modules", "ios", "android", "dist", "build", "web-build"].includes(e.name))
      continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, depth + 1);
    else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) yield p;
  }
}

// Read the source tree once; several checks search it.
let sourceFiles;
function sourceContains(regex) {
  if (!scanSource) return undefined;
  if (!sourceFiles) {
    sourceFiles = [];
    for (const f of walk(projectDir)) {
      if (sourceFiles.length >= 4000) break;
      try {
        sourceFiles.push({ rel: path.relative(projectDir, f).split(path.sep).join("/"), text: fs.readFileSync(f, "utf8") });
      } catch {
        /* ignore */
      }
    }
  }
  return sourceFiles.find((f) => regex.test(f.text))?.rel ?? null;
}

// ---------- load ----------
const { config, source } = loadConfig();
const pkg = readJson(path.join(projectDir, "package.json")) ?? {};
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
const has = (name) => Object.prototype.hasOwnProperty.call(deps, name);
const hasAny = (names) => names.filter(has);
const eas = readJson(path.join(projectDir, "eas.json"));

const ios = config.ios ?? {};
const android = config.android ?? {};
const infoPlist = ios.infoPlist ?? {};
const platforms = config.platforms ?? ["ios", "android"];
const shipsIos = platforms.includes("ios");
const shipsAndroid = platforms.includes("android");

// ---------- identity & versions ----------
const expoMajor = majorOf(deps.expo);
if (expoMajor) info("both", "Expo SDK", `Expo SDK ${expoMajor} detected.`);
else warn("both", "Expo SDK", "No `expo` dependency found in package.json.", "Run from the Expo project root.");

if (shipsIos && !ios.bundleIdentifier)
  err("ios", "App Store Connect", "`ios.bundleIdentifier` is missing.", "Set it in app.json; it must match App Store Connect.");
if (shipsAndroid && !android.package)
  err("android", "Play Console", "`android.package` is missing.", "Set it in app.json; it can never change after the first upload.");

if (!config.version) warn("both", "Versioning", "`version` is missing.", "Set the user-facing version (e.g. 1.2.0).");

const remoteVersions = eas?.cli?.appVersionSource === "remote";
if (!remoteVersions) {
  if (shipsIos && !ios.buildNumber)
    warn("ios", "Versioning", "No `ios.buildNumber` and eas.json doesn't use `appVersionSource: remote`.",
      'Use `"cli": { "appVersionSource": "remote" }` + `autoIncrement` in the production profile, or bump buildNumber every upload.');
  if (shipsAndroid && !android.versionCode)
    warn("android", "Versioning", "No `android.versionCode` and eas.json doesn't use `appVersionSource: remote`.",
      "Use remote versioning with autoIncrement, or bump versionCode every upload.");
}

// ---------- eas.json ----------
if (!eas) {
  info("both", "EAS", "No eas.json found.", "Skip if you build outside EAS.");
} else {
  const prod = eas.build?.production;
  if (!prod) warn("both", "EAS", "No `build.production` profile in eas.json.", "Add one for store builds.");
  else {
    if (prod.developmentClient) err("both", "2.1 / Play quality", "Production profile has `developmentClient: true`.", "Never submit a dev-client build.");
    if (prod.distribution === "internal") err("both", "EAS", "Production profile uses `distribution: internal`.", "Store builds need `distribution: store` (default).");
    const img = prod.ios?.image;
    // EAS image aliases: sdk-53 and older map to Xcode 16 or earlier; `latest` is Xcode 27 (Oct 2026).
    const xc = String(img ?? "").match(/xcode-(\d+)/i);
    const sdkAlias = String(img ?? "").match(/^sdk-(\d+)$/);
    const tooOld = xc ? Number(xc[1]) < 26 : sdkAlias ? Number(sdkAlias[1]) < 54 : false;
    if (shipsIos && img && tooOld)
      err("ios", "Upload: SDK minimum", `Pinned iOS build image "${img}" uses Xcode older than 26.`,
        "Since 2026-04-28 uploads must be built with Xcode 26+ / iOS 26 SDK. Remove `ios.image` (EAS picks `auto` for your SDK) or upgrade the Expo SDK.");
    if (shipsIos && img === "latest" && expoMajor && expoMajor < 58) {
      const scene = plugin(config, "expo-build-properties")?.options?.ios?.enableSceneSupport;
      if (!scene)
        warn("ios", "iOS 27 launch", `ios.image "latest" is Xcode 27, but Expo SDK ${expoMajor} needs scene support for apps built with the iOS 27 SDK.`,
          "Use the default `auto` image (remove ios.image) or `sdk-" + expoMajor + "`" +
            (expoMajor === 57 ? ", or on expo@57.0.23+ enable expo-build-properties ios.enableSceneSupport." : ", or upgrade to Expo SDK 58."));
    }
  }
}

// ---------- icon ----------
const iconPath = ios.icon ?? config.icon;
if (shipsIos && typeof iconPath === "string") {
  const abs = path.resolve(projectDir, iconPath);
  const png = pngInfo(abs);
  if (!png) warn("ios", "Icon", `Icon not found at ${iconPath}.`, "Check the path in app.json.");
  else if (!png.png) info("ios", "Icon", `Icon ${iconPath} is not a PNG; can't inspect it.`);
  else {
    if (png.width !== 1024 || png.height !== 1024)
      warn("ios", "Icon", `Icon is ${png.width}×${png.height}; App Store icon should be 1024×1024.`, "Export a 1024×1024 PNG.");
    if (png.colorType === 4 || png.colorType === 6)
      err("ios", "Upload: ITMS-90717", "Icon PNG has an alpha channel; App Store Connect rejects transparent icons.",
        "Re-export without transparency (flatten onto a solid background).");
  }
} else if (shipsIos && iconPath && typeof iconPath === "object") {
  info("ios", "Icon", "Icon uses the object/Icon Composer form; check it manually.");
}

// ---------- permission strings (Apple 5.1.1(ii)) ----------
const GENERIC = /(needs?|requires?|wants?) (access|permission)|allow \$\(PRODUCT_NAME\)|\$\(PRODUCT_NAME\) (needs|would like)|^this app (uses|needs|requires)|^(camera|location|photo|microphone) (access|permission)|lorem|todo|placeholder/i;

const EXAMPLES = {
  Camera: "Scan the QR code on a charging station to start your session.",
  PhotoLibrary: "Choose a photo of your receipt so we can add the expense for you.",
  Location: "Show charging stations near you and start your route from where you are.",
  Microphone: "Record voice notes that are attached to your trip log.",
  Contacts: "Find friends who already use the app so you can share routes with them.",
  Calendar: "Add your booked charging slots to your calendar.",
  FaceID: "Unlock your saved cards with Face ID instead of your password.",
  UserTracking: "We use this to measure which ads brought you to the app. We never sell your data.",
};
const exampleFor = (key) => {
  const k = Object.keys(EXAMPLES).find((e) => key.includes(e) || key.toLowerCase().includes(e.toLowerCase()));
  return EXAMPLES[k ?? "Camera"];
};

function checkString(key, value, where) {
  if (value === false) return; // explicitly disabled
  if (typeof value !== "string" || !value.trim()) {
    err("ios", "5.1.1(ii)", `${key} is empty (${where}).`, "Write a purpose string that names the feature and the benefit.");
    return;
  }
  if (value.trim().length < 25 || GENERIC.test(value))
    warn("ios", "5.1.1(ii)", `${key} looks generic: "${value}" (${where}).`,
      `Say what the app does with it and why it helps the user, e.g. "${exampleFor(key)}"`);
}

for (const [k, v] of Object.entries(infoPlist)) {
  if (/^NS.*UsageDescription$/.test(k)) checkString(k, v, "ios.infoPlist");
}

// Libraries that inject permission strings, with the plugin option that overrides each string.
const PERMISSION_LIBS = [
  { lib: "expo-camera", plist: "NSCameraUsageDescription", opts: ["cameraPermission"] },
  { lib: "expo-camera", plist: "NSMicrophoneUsageDescription", opts: ["microphonePermission"], optional: true },
  { lib: "expo-image-picker", plist: "NSPhotoLibraryUsageDescription", opts: ["photosPermission"] },
  { lib: "expo-image-picker", plist: "NSCameraUsageDescription", opts: ["cameraPermission"] },
  { lib: "expo-location", plist: "NSLocationWhenInUseUsageDescription", opts: ["locationWhenInUsePermission", "locationAlwaysAndWhenInUsePermission"] },
  { lib: "expo-media-library", plist: "NSPhotoLibraryUsageDescription", opts: ["photosPermission"] },
  { lib: "expo-contacts", plist: "NSContactsUsageDescription", opts: ["contactsPermission"] },
  { lib: "expo-calendar", plist: "NSCalendarsUsageDescription", opts: ["calendarPermission"] },
  { lib: "expo-audio", plist: "NSMicrophoneUsageDescription", opts: ["microphonePermission"] },
  { lib: "expo-av", plist: "NSMicrophoneUsageDescription", opts: ["microphonePermission"] },
  { lib: "expo-local-authentication", plist: "NSFaceIDUsageDescription", opts: ["faceIDPermission"] },
  { lib: "expo-tracking-transparency", plist: "NSUserTrackingUsageDescription", opts: ["userTrackingPermission"] },
];

if (shipsIos) {
  for (const { lib, plist, opts, optional } of PERMISSION_LIBS) {
    if (!has(lib)) continue;
    const pl = plugin(config, lib);
    const optVal = opts.map((o) => pl?.options?.[o]).find((v) => v !== undefined);
    if (optVal !== undefined) checkString(`${lib} → ${opts.find((o) => pl?.options?.[o] !== undefined)}`, optVal, "plugin option");
    else if (infoPlist[plist] === undefined && !optional)
      warn("ios", "5.1.1(ii)", `${lib} is installed but ${plist} is not customised; Expo's generic default will be used.`,
        `Add ["${lib}", { "${opts[0]}": "<specific reason>" }] to plugins, or set ios.infoPlist.${plist}.`);
  }
}

// ---------- privacy manifest ----------
// What React Native core itself declares (react-native-community/template PrivacyInfo.xcprivacy).
const RN_CORE_PRIVACY_REASONS = {
  NSPrivacyAccessedAPICategoryFileTimestamp: "C617.1",
  NSPrivacyAccessedAPICategoryUserDefaults: "CA92.1",
  NSPrivacyAccessedAPICategorySystemBootTime: "35F9.1",
};
if (shipsIos) {
  const pm = ios.privacyManifests;
  if (!pm)
    warn("ios", "Privacy manifest", "No `ios.privacyManifests` in config.",
      "React Native links libraries statically, so declare required-reason APIs (e.g. NSPrivacyAccessedAPICategoryUserDefaults / CA92.1) here. Apple emails ITMS-91053 after upload if any are missing.");
  else {
    for (const t of pm.NSPrivacyAccessedAPITypes ?? []) {
      if (!t.NSPrivacyAccessedAPITypeReasons?.length)
        err("ios", "Privacy manifest", `${t.NSPrivacyAccessedAPIType} has no reasons.`, "Add at least one approved reason code.");
    }
    const declared = new Set((pm.NSPrivacyAccessedAPITypes ?? []).map((t) => t.NSPrivacyAccessedAPIType));
    const missing = Object.entries(RN_CORE_PRIVACY_REASONS).filter(([type]) => !declared.has(type));
    if (missing.length)
      warn("ios", "Privacy manifest", `Missing API categories React Native core uses: ${missing.map(([type]) => type).join(", ")}.`,
        `Add them with React Native's own reasons (${missing.map(([type, reason]) => `${type.replace("NSPrivacyAccessedAPICategory", "")} ${reason}`).join(", ")}), plus any your other libraries declare.`);
    if (pm.NSPrivacyTracking === true && !(pm.NSPrivacyTrackingDomains?.length))
      warn("ios", "Privacy manifest", "NSPrivacyTracking is true but NSPrivacyTrackingDomains is empty.", "List the tracking domains your SDKs contact.");
  }
}

// ---------- encryption export compliance ----------
if (shipsIos && ios.config?.usesNonExemptEncryption === undefined && infoPlist.ITSAppUsesNonExemptEncryption === undefined)
  info("ios", "Export compliance", "ITSAppUsesNonExemptEncryption not set; you'll answer the encryption question on every upload.",
    "If you only use standard HTTPS/TLS, set ios.config.usesNonExemptEncryption: false.");

// ---------- tracking / ATT (5.1.2(i)) ----------
const trackingSdks = hasAny([
  "react-native-google-mobile-ads", "react-native-fbsdk-next", "react-native-appsflyer", "react-native-adjust",
  "@react-native-firebase/admob", "react-native-branch", "react-native-applovin-max",
]);
if (shipsIos && trackingSdks.length) {
  const attOk = has("expo-tracking-transparency") || infoPlist.NSUserTrackingUsageDescription;
  if (!attOk)
    err("ios", "5.1.2(i) ATT", `Ad/attribution SDKs present (${trackingSdks.join(", ")}) but no App Tracking Transparency setup.`,
      "Add expo-tracking-transparency with a specific userTrackingPermission string, and request before any tracking.");
  else info("ios", "5.1.2(i) ATT", `Tracking SDKs: ${trackingSdks.join(", ")}.`, "Make sure the ATT prompt fires before they initialise, and the privacy label says 'used to track'.");
}

// ---------- login services (4.8) & account deletion (5.1.1(v)) ----------
const socialLogin = hasAny([
  "@react-native-google-signin/google-signin", "react-native-fbsdk-next", "@react-native-seoul/kakao-login",
  "react-native-linkedin", "@clerk/clerk-expo", "expo-auth-session",
]);
const hasApple = has("expo-apple-authentication") || has("@invertase/react-native-apple-authentication");
if (shipsIos && socialLogin.length && !hasApple) {
  const sev = socialLogin.some((l) => l !== "expo-auth-session" && l !== "@clerk/clerk-expo") ? warn : info;
  sev("ios", "4.8 Login Services",
    `Third-party login libraries found (${socialLogin.join(", ")}) and no Sign in with Apple.`,
    "If a social login creates the user's primary account, also offer an equivalent private login (Sign in with Apple via expo-apple-authentication is the usual fix).");
}

const authLibs = hasAny([
  "@react-native-firebase/auth", "firebase", "@supabase/supabase-js", "@clerk/clerk-expo", "aws-amplify",
  "@aws-amplify/auth", "expo-auth-session", "@react-native-google-signin/google-signin", "expo-apple-authentication",
  "better-auth", "@better-auth/expo", "appwrite", "react-native-appwrite",
]);
if (authLibs.length) {
  const hit = sourceContains(/delete[\s_-]?(my[\s_-]?)?account|deleteAccount|deleteUser|account[\s_-]?deletion|hesab[ıi]m[ıi]? sil|konto l[öo]schen|elimina(re)? (l'?)?account/i);
  if (hit === null)
    err("both", "5.1.1(v) / Play User Data", `Account libraries found (${authLibs.join(", ")}) but no account-deletion code was found in source.`,
      "Add an in-app 'Delete account' flow. Google Play also needs a public web link for deletion in the Data safety form.");
  else if (hit)
    info("both", "5.1.1(v) / Play User Data", `Account deletion code found (${hit}).`,
      "Confirm it deletes data (not just signs out), and that a public web deletion URL exists for Google Play.");
}

// ---------- payments (3.1.1 / 3.1.3(e)) ----------
const webPayments = hasAny(["@stripe/stripe-react-native", "react-native-paypal", "@paypal/react-native-paypal", "react-native-razorpay", "@adyen/react-native"]);
const iap = hasAny(["expo-iap", "react-native-iap", "react-native-purchases", "@revenuecat/purchases-react-native", "expo-in-app-purchases"]);
if (webPayments.length && !iap.length)
  warn("both", "3.1.1 IAP / Play Billing", `Payment SDK (${webPayments.join(", ")}) without an in-app purchase library.`,
    "Fine for physical goods and real-world services. If it unlocks digital content, features, credits or subscriptions, it must use IAP / Play Billing.");
if (iap.length)
  info("both", "3.1.2 Subscriptions", `IAP library: ${iap.join(", ")}.`,
    "Paywall must show price, period, auto-renew, Restore Purchases, and Terms + Privacy links; IAP products attached to this version.");

// ---------- third-party AI (5.1.2(i)) ----------
const aiSdks = hasAny([
  "openai", "@anthropic-ai/sdk", "@google/generative-ai", "@google/genai", "ai", "@ai-sdk/openai",
  "@ai-sdk/anthropic", "@ai-sdk/google", "@mistralai/mistralai", "groq-sdk", "replicate", "@fal-ai/client",
]);
if (aiSdks.length)
  warn("both", "5.1.2(i) Third-party AI", `AI SDKs in the app bundle (${aiSdks.join(", ")}).`,
    "Show a consent screen naming the provider before sending any personal data, and list it in the privacy policy. Also: don't ship API keys in the client.");
if (aiSdks.length && /image|fal|replicate/i.test(aiSdks.join()))
  info("ios", "1.2 UGC / AI content", "Generative image SDK detected.",
    "1.2 now covers AI content-creation apps: content filtering, reporting, blocking, contact info, and safeguards against nonconsensual intimate imagery.");

// ---------- hidden features / OTA (2.5.19, 2.3.1(a), 2.5.2) ----------
const flags = hasAny([
  "@react-native-firebase/remote-config", "launchdarkly-react-native-client-sdk", "@launchdarkly/react-native-client-sdk",
  "posthog-react-native", "statsig-react-native", "@statsig/expo-bindings", "configcat-js", "@growthbook/growthbook-react",
]);
if (flags.length)
  warn("ios", "2.5.19 Hidden features", `Feature-flag / remote-config SDK (${flags.join(", ")}).`,
    "Any feature switched on remotely must be described in Review Notes and reachable by the reviewer. Undocumented dormant features can now terminate the developer account.");
if (has("expo-updates")) {
  if (!config.runtimeVersion)
    warn("both", "EAS Update", "expo-updates is installed but `runtimeVersion` isn't set.", 'Set runtimeVersion (e.g. { "policy": "fingerprint" }) so OTA updates can\'t reach incompatible binaries.');
  info("ios", "2.5.2 / 2.5.19 OTA", "expo-updates is installed.", "OTA is fine for JS fixes; new features or behaviour changes belong in a reviewed build.");
}

// ---------- AdMob app IDs (crash on launch → 2.1) ----------
if (has("react-native-google-mobile-ads")) {
  const top = config["react-native-google-mobile-ads"] ?? {};
  const po = plugin(config, "react-native-google-mobile-ads")?.options ?? {};
  const iosId = top.ios_app_id ?? po.iosAppId;
  const andId = top.android_app_id ?? po.androidAppId;
  if ((shipsIos && !iosId) || (shipsAndroid && !andId))
    err("both", "2.1 Crash on launch", "react-native-google-mobile-ads is installed but the AdMob app ID is missing for a platform you ship.",
      'Set the plugin options { "iosAppId": "...", "androidAppId": "..." }; without them the native SDK crashes on start.');
}

// ---------- secrets in the client bundle ----------
{
  const leak = sourceContains(/EXPO_PUBLIC_[A-Z0-9_]*(OPENAI|ANTHROPIC|GEMINI|GROQ|MISTRAL|REPLICATE|STRIPE_SECRET|SECRET)[A-Z0-9_]*|\bsk-(proj-|ant-)?[A-Za-z0-9_-]{20,}|\bsk_live_[A-Za-z0-9]{10,}/);
  if (leak)
    err("both", "1.6 Data security", `Looks like a secret API key ships in the app (${leak}).`,
      "EXPO_PUBLIC_* values and literals are readable by anyone with the binary. Move the call behind your backend and rotate the key.");
}

// ---------- ratings (5.6.1) ----------
if (scanSource) {
  // Asking for a specific rating is a violation even when the system review API is used.
  const stars = sourceContains(/\b5[- ]?stars?\b|five stars|5 y[ıi]ld[ıi]z/i);
  if (stars) err("both", "5.6.1 / 3.2.2(x) Ratings", `Text asks for a specific star rating (${stars}).`, "Never ask for a particular rating. Use expo-store-review's requestReview() with neutral wording.");
  const usesReviewApi = has("expo-store-review") || has("react-native-rate") || has("react-native-in-app-review");
  const hit = stars || usesReviewApi ? undefined : sourceContains(/rate (us|this app)|leave (us )?a review/i);
  if (hit) warn("both", "5.6.1 Ratings", `Custom rating prompt text found (${hit}).`, "Use expo-store-review (system API). Don't gate or reward ratings.");
}

// ---------- iPad ----------
if (shipsIos && ios.supportsTablet)
  info("ios", "2.4.1 / 2.1 iPad", "`ios.supportsTablet` is true; reviewers may test on iPad.", "Run the app on an iPad simulator; add iPad screenshots in App Store Connect.");

// ---------- background modes ----------
const bg = infoPlist.UIBackgroundModes ?? [];
if (shipsIos && bg.length)
  info("ios", "2.5.4 Background modes", `UIBackgroundModes: ${bg.join(", ")}.`, "Each mode must be used for its intended purpose; explain background location in Review Notes.");

// ---------- Android ----------
if (shipsAndroid) {
  const bp = plugin(config, "expo-build-properties");
  const target = bp?.options?.android?.targetSdkVersion;
  if (target !== undefined && Number(target) < MIN_ANDROID_TARGET_SDK)
    err("android", "Target API level", `targetSdkVersion is ${target}; Google Play requires ${MIN_ANDROID_TARGET_SDK}+ for new apps and updates (since 2026-08-31).`,
      "Remove the override or raise it, and upgrade the Expo SDK if needed.");
  else if (target === undefined)
    info("android", "Target API level", `targetSdkVersion comes from Expo SDK ${expoMajor ?? "?"} defaults.`,
      `Confirm it's ≥ ${MIN_ANDROID_TARGET_SDK}: Expo SDK 56–58 default to 36; otherwise check android/gradle.properties after \`npx expo prebuild -p android\`, or the bundle in Play Console.`);

  const SENSITIVE = {
    "ACCESS_BACKGROUND_LOCATION": "needs a Play Console declaration + video and a prominent disclosure",
    "READ_MEDIA_IMAGES": "Photo & Video Permissions policy: use the system photo picker unless broad access is core",
    "READ_MEDIA_VIDEO": "Photo & Video Permissions policy: use the system photo picker unless broad access is core",
    "READ_EXTERNAL_STORAGE": "legacy; prefer the photo picker",
    "MANAGE_EXTERNAL_STORAGE": "All files access declaration required",
    "READ_SMS": "SMS/Call Log policy — default handlers only",
    "SEND_SMS": "SMS/Call Log policy — default handlers only",
    "RECEIVE_SMS": "SMS/Call Log policy — default handlers only",
    "READ_CALL_LOG": "SMS/Call Log policy — default handlers only",
    "QUERY_ALL_PACKAGES": "package visibility declaration required",
    "SCHEDULE_EXACT_ALARM": "only for alarm/calendar core use",
    "USE_EXACT_ALARM": "only for alarm/calendar core use",
    "SYSTEM_ALERT_WINDOW": "rarely justified",
    "REQUEST_INSTALL_PACKAGES": "restricted; needs core-use justification",
  };
  const blocked = new Set((android.blockedPermissions ?? []).map((p) => p.replace(/^android\.permission\./, "")));
  for (const raw of android.permissions ?? []) {
    const p = String(raw).replace(/^android\.permission\./, "");
    if (SENSITIVE[p] && !blocked.has(p))
      warn("android", "Sensitive permission", `${p} requested — ${SENSITIVE[p]}.`, "Remove it, add it to android.blockedPermissions if a library adds it, or file the declaration.");
  }
  if (has("expo-location") && !(android.permissions ?? []).length)
    info("android", "Permissions", "No explicit android.permissions; libraries will add their defaults.",
      "Check the merged manifest of a release build for ACCESS_BACKGROUND_LOCATION or media permissions you don't use, and block them.");

  info("android", "Data safety + deletion URL", "Can't be checked statically.",
    "Data safety form must match every SDK; if accounts exist, add a public web deletion URL there.");
}

// ---------- always-manual items ----------
info("both", "2.1(a) Reviewer access", "Can't be checked statically.",
  "Demo account without 2FA, production backend live, review notes describing each new feature.");
if (sourceContains(/privacy[\s_-]?policy|gizlilik|datenschutz|informativa sulla privacy|privacyPolicy/i) === null)
  warn("both", "5.1.1(i) Privacy policy", "No privacy policy reference found in source.", "Link it inside the app (Settings/About) as well as in the store listing.");

// ---------- output ----------
const order = { error: 0, warning: 1, info: 2 };
findings.sort((a, b) => order[a.severity] - order[b.severity]);
const counts = {
  error: findings.filter((f) => f.severity === "error").length,
  warning: findings.filter((f) => f.severity === "warning").length,
  info: findings.filter((f) => f.severity === "info").length,
};

if (asJson) {
  console.log(JSON.stringify({ rulesCheckedOn: RULES_CHECKED_ON, configSource: source, app: config.name, counts, findings }, null, 2));
} else {
  const icon = { error: "✖", warning: "▲", info: "·" };
  console.log(`\napp-store-review-guard preflight — ${config.name ?? "app"} (config: ${source})`);
  console.log(`Rules checked on ${RULES_CHECKED_ON}. Static checks only; walk the manual checklist too.\n`);
  for (const sev of ["error", "warning", "info"]) {
    const list = findings.filter((f) => f.severity === sev);
    if (!list.length) continue;
    console.log(`${sev.toUpperCase()}S (${list.length})`);
    for (const f of list) {
      console.log(`  ${icon[sev]} [${f.platform}] ${f.rule}: ${f.message}`);
      if (f.fix) console.log(`      → ${f.fix}`);
    }
    console.log("");
  }
  console.log(`Summary: ${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info.`);
}
process.exit(counts.error ? 1 : 0);
