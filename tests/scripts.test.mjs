// Deterministic checks for the skill scripts, run against the eval fixtures.
// Run: node --test tests/scripts.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = {
  reviewGuard: "skills/app-store-review-guard/scripts/preflight.mjs",
  releaseCheck: "skills/expo-release-preflight/scripts/release-check.mjs",
  easConfig: "skills/eas-build-submit/scripts/check-eas-config.mjs",
  buildLog: "skills/eas-build-submit/scripts/diagnose-build-log.mjs",
  otaOrBuild: "skills/expo-ota-updates/scripts/ota-or-build.mjs",
};
const FIXTURES = {
  risky: "evals/audit-flags-risky-expo-project/files",
  configTraps: "evals/release-preflight-finds-config-traps/files",
  clean: "evals/audit-clean-expo-project/files",
};

const run = (script, args, { cwd, input } = {}) => {
  const r = spawnSync(process.execPath, [path.join(repoRoot, SCRIPTS[script]), ...args], { cwd, input, encoding: "utf8" });
  let json;
  try {
    json = JSON.parse(r.stdout);
  } catch {}
  return { status: r.status, stdout: r.stdout, json };
};

const git = (cwd, ...args) => {
  const r = spawnSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", ...args], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
};

// A temp copy in its own git repo, so results don't depend on this repo's tags or dirty state.
const gitCopy = (fixture) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "expo-ship-kit-"));
  if (fixture) fs.cpSync(path.join(repoRoot, FIXTURES[fixture]), dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "--allow-empty", "-m", "base");
  return dir;
};

const rulesOf = (json, severity) => json.findings.filter((f) => f.severity === severity).map((f) => f.rule ?? f.area);
const messagesOf = (json, severity) => json.findings.filter((f) => f.severity === severity).map((f) => f.message).join("\n");

test("review guard flags the risky project's blockers", () => {
  const { status, json } = run("reviewGuard", ["--json"], { cwd: path.join(repoRoot, FIXTURES.risky) });
  assert.equal(status, 1);
  const errors = rulesOf(json, "error");
  for (const rule of ["5.1.1(v) / Play User Data", "5.1.2(i) ATT", "Target API level", "Upload: ITMS-90717", "2.1 / Play quality", "1.6 Data security", "5.6.1 / 3.2.2(x) Ratings"])
    assert.ok(errors.includes(rule), `missing error ${rule}`);
  assert.ok(rulesOf(json, "warning").includes("4.8 Login Services"));
});

test("review guard finds no blockers in the clean project", () => {
  const { status, json } = run("reviewGuard", ["--json"], { cwd: path.join(repoRoot, FIXTURES.clean) });
  assert.equal(status, 0);
  assert.equal(json.counts.error, 0, messagesOf(json, "error"));
  assert.equal(json.counts.warning, 0, messagesOf(json, "warning"));
});

test("release check catches the config traps, once each", () => {
  const { status, json } = run("releaseCheck", ["--json", "--expect-version", "1.1.0"], { cwd: gitCopy("configTraps") });
  assert.equal(status, 1);
  const errors = messagesOf(json, "error");
  assert.match(errors, /google-services\.json.*gitignored/);
  assert.match(errors, /Local\/dev URLs in app code: src\/api\.ts:1/);
  assert.match(errors, /releasing 1\.1\.0 but app config says version 1\.0\.0/);
  assert.match(messagesOf(json, "warning"), /Profile "production" has no channel/);
  assert.equal(json.findings.filter((f) => /extends "prod"/.test(f.message)).length, 1);
});

test("release check finds no blockers in the clean project", () => {
  const { status, json } = run("releaseCheck", ["--json", "--expect-version", "1.2.0"], { cwd: gitCopy("clean") });
  assert.equal(status, 0, messagesOf(json, "error"));
  assert.equal(json.counts.warning, 0, messagesOf(json, "warning"));
});

test("release check skips expo checks when dependencies aren't installed", () => {
  const { json } = run("releaseCheck", ["--json", "--run-expo-checks"], { cwd: gitCopy("clean") });
  assert.match(messagesOf(json, "warning"), /dependencies aren't installed/);
  assert.doesNotMatch(json.findings.map((f) => f.area).join(), /expo-doctor/);
});

test("eas config check", () => {
  const risky = run("easConfig", ["--json"], { cwd: path.join(repoRoot, FIXTURES.risky) });
  assert.equal(risky.status, 1);
  assert.match(messagesOf(risky.json, "error"), /development client/);
  assert.match(messagesOf(risky.json, "error"), /Xcode < 26/);
  const clean = run("easConfig", ["--json"], { cwd: path.join(repoRoot, FIXTURES.clean) });
  assert.equal(clean.status, 0);
  assert.equal(clean.json.findings.length, 0);
});

test("build log diagnosis", () => {
  const draft = run("buildLog", ["-", "--json"], { input: "Google Api Error: Invalid request - Only releases with status draft may be created on draft app.\n" });
  assert.equal(draft.status, 0);
  assert.equal(draft.json.matches[0].id, "play-draft-app");
  assert.equal(run("buildLog", ["-"], { input: "all good\n" }).status, 3);
  assert.equal(run("buildLog", ["does-not-exist.log"]).status, 2);
});

test("ota-or-build verdicts", () => {
  const dir = gitCopy();
  fs.writeFileSync(path.join(dir, "app.json"), JSON.stringify({ expo: { name: "a", slug: "a", runtimeVersion: { policy: "fingerprint" } } }));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: { expo: "~58.0.0" } }));
  fs.writeFileSync(path.join(dir, "screen.ts"), "export const a = 1;\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "store build");

  assert.equal(run("otaOrBuild", ["--json"], { cwd: dir }).status, 2, "no tag and no --base must not guess a base");

  git(dir, "tag", "v1.0.0");
  fs.writeFileSync(path.join(dir, "screen.ts"), "export const a = 2;\n");
  const jsOnly = run("otaOrBuild", ["--json"], { cwd: dir });
  assert.equal(jsOnly.status, 0);
  assert.equal(jsOnly.json.verdict, "ota");

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: { expo: "~58.0.0", "react-native-maps": "1.20.0" } }));
  const nativeDep = run("otaOrBuild", ["--json"], { cwd: dir });
  assert.equal(nativeDep.status, 1);
  assert.match(nativeDep.json.native.join(), /react-native-maps/);
});

// One real-looking log line per pattern; a new pattern without a sample fails the coverage check.
const LOG_SAMPLES = {
  "lockfile-out-of-date": "npm ERR! `npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync. Please update your lock file with `npm install` before continuing.",
  "peer-deps": "npm ERR! code ERESOLVE",
  "missing-file": "Unable to resolve module ./src/theme from /home/expo/workingdir/build/App.tsx",
  "js-bundle": "> Task :app:createBundleReleaseJsAndAssets FAILED",
  "js-oom": "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory",
  "pods-incompatible": '[!] CocoaPods could not find compatible versions for pod "hermes-engine":',
  "podfile-invalid": "[!] Invalid `Podfile` file: undefined method `use_expo_modules!'.",
  "ios-capability": 'Provisioning profile "*[expo] com.x.app AppStore" doesn\'t include the Push Notifications capability.',
  "ios-signing": "error: No profiles for 'com.x.app' were found",
  "ios-phase-script": "Command PhaseScriptExecution failed with a nonzero exit code",
  "sentry-auth": "error: Auth token is required for this request. Please run `sentry-cli login`",
  "android-duplicate-class": "Duplicate class com.google.common.util.concurrent.ListenableFuture found in modules guava-31.jar and listenablefuture-1.0.jar",
  "android-minsdk": "uses-sdk:minSdkVersion 23 cannot be smaller than version 24 declared in library [:react-native-foo]",
  "android-kotlin": "Module was compiled with an incompatible version of Kotlin. The binary version of its metadata is 2.1.0, expected version is 1.9.0.",
  "google-services": "File google-services.json is missing. The Google Services Plugin cannot function without it.",
  "android-sdk-license": "Failed to install the following Android SDK packages as some licences have not been accepted.",
  "cmake-ndk": "CMake Error at CMakeLists.txt:12 (add_library):",
  "timeout": "Your build exceeded the maximum build time of 2 hours.",
  "unknown-error": "Unknown error. See logs of the Run gradlew build phase for more information.",
  "ios-build-number-used": "ERROR ITMS-90189: Redundant Binary Upload. You've already uploaded a build with build number '12'.",
  "ios-version-closed": "ERROR ITMS-90062: This bundle is invalid. The value for key CFBundleShortVersionString [1.0.0] must contain a higher version.",
  "ios-icon-alpha": "ERROR ITMS-90717: Invalid App Store Icon.",
  "ios-privacy-manifest": "ITMS-91053: Missing API declaration - Your app's code references NSUserDefaults.",
  "ios-sdk-too-old": "ERROR ITMS-90725: SDK version issue.",
  "asc-auth": "Authentication with Apple Developer Portal failed!",
  "play-draft-app": "Google Api Error: Invalid request - Only releases with status draft may be created on draft app.",
  "play-version-code": "Google Api Error: Invalid request - Version code 12 has already been used.",
  "play-permission": "Google Api Error: The caller does not have permission",
  "play-package-not-found": "Google Api Error: Package not found: com.x.app.",
  "play-target-sdk": "Your app currently targets API level 34 and must target at least API level 36.",
  "play-apk": "APKs are not allowed for this application. Upload an Android App Bundle.",
};

test("every build log pattern has a sample, and each sample matches its pattern", () => {
  const source = fs.readFileSync(path.join(repoRoot, SCRIPTS.buildLog), "utf8");
  const ids = [...source.matchAll(/\bid: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(Object.keys(LOG_SAMPLES).sort(), [...ids].sort());
  for (const [id, line] of Object.entries(LOG_SAMPLES)) {
    const { json } = run("buildLog", ["-", "--json"], { input: line + "\n" });
    assert.ok(json.matches.some((m) => m.id === id), `${id} didn't match: ${line}`);
  }
});

test("build log diagnosis puts the earliest failure first", () => {
  const log = [LOG_SAMPLES["js-bundle"], "...", LOG_SAMPLES["ios-phase-script"]].join("\n");
  assert.deepEqual(run("buildLog", ["-", "--json"], { input: log }).json.matches.map((m) => m.id), ["js-bundle", "ios-phase-script"]);
});

test("review guard: permissions, privacy manifest and build image rules", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "expo-ship-kit-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: { expo: "~56.0.0", "expo-camera": "~56.0.0" } }));
  fs.writeFileSync(path.join(dir, "eas.json"), JSON.stringify({ build: { production: { ios: { image: "latest" } } } }));
  const config = {
    name: "t", version: "1.0.0", plugins: [["expo-camera", { cameraPermission: "Allow $(PRODUCT_NAME) to access your camera" }]],
    ios: { bundleIdentifier: "t.t", buildNumber: "1", privacyManifests: { NSPrivacyAccessedAPITypes: [{ NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp" }] } },
    android: { package: "t.t", versionCode: 1, permissions: ["READ_SMS", "ACCESS_BACKGROUND_LOCATION"], blockedPermissions: ["android.permission.ACCESS_BACKGROUND_LOCATION"] },
  };
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(config));
  const { json } = run("reviewGuard", ["--json", "--config", "config.json", "--no-source-scan"], { cwd: dir });
  const all = json.findings.map((f) => `${f.severity} ${f.rule}: ${f.message} ${f.fix ?? ""}`).join("\n");
  assert.match(all, /error Privacy manifest: NSPrivacyAccessedAPICategoryFileTimestamp has no reasons/);
  assert.match(all, /warning Privacy manifest: Missing API categories React Native core uses: NSPrivacyAccessedAPICategoryUserDefaults, NSPrivacyAccessedAPICategorySystemBootTime/);
  assert.match(all, /warning 5\.1\.1\(ii\): expo-camera → cameraPermission looks generic/);
  assert.match(all, /warning Sensitive permission: READ_SMS/);
  assert.doesNotMatch(all, /Sensitive permission: ACCESS_BACKGROUND_LOCATION/, "blocked permissions must not be flagged");
  assert.match(all, /iOS 27 launch: .*SDK 56.*upgrade to Expo SDK 58/s);
  assert.doesNotMatch(all, /enableSceneSupport/, "scene support only exists on SDK 57");
});

test("rules-checked-on dates agree and are recent", () => {
  const skillDates = fs.readdirSync(path.join(repoRoot, "skills")).map((skill) => {
    const md = fs.readFileSync(path.join(repoRoot, "skills", skill, "SKILL.md"), "utf8");
    return md.match(/rules-checked-on: "(\d{4}-\d{2}-\d{2})"/)?.[1];
  });
  const scriptDate = fs.readFileSync(path.join(repoRoot, SCRIPTS.reviewGuard), "utf8").match(/RULES_CHECKED_ON = "([\d-]+)"/)[1];
  assert.deepEqual(new Set([...skillDates, scriptDate]), new Set([scriptDate]), "bump every rules-checked-on date together");
  const MAX_RULE_AGE_DAYS = 120; // store rules change several times a year
  const ageDays = (Date.now() - Date.parse(scriptDate)) / 86_400_000;
  assert.ok(ageDays <= MAX_RULE_AGE_DAYS, `Rules were last checked ${Math.floor(ageDays)} days ago: re-verify them against the official sources and bump the dates.`);
});

test("ota-or-build: icon change in a monorepo app needs a build", () => {
  const repo = gitCopy();
  const app = path.join(repo, "apps", "mobile");
  fs.mkdirSync(path.join(app, "assets"), { recursive: true });
  fs.writeFileSync(path.join(app, "app.json"), JSON.stringify({ expo: { name: "a", slug: "a", icon: "./assets/icon.png", runtimeVersion: { policy: "fingerprint" } } }));
  fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ dependencies: { expo: "~58.0.0" } }));
  fs.writeFileSync(path.join(app, "assets", "icon.png"), "v1");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "store build");
  git(repo, "tag", "v1.0.0");
  fs.writeFileSync(path.join(app, "assets", "icon.png"), "v2");
  const { status, json } = run("otaOrBuild", ["--json", "--project", app], { cwd: repo });
  assert.equal(status, 1);
  assert.match(json.native.join(), /Native asset changed: assets\/icon\.png/);
});
