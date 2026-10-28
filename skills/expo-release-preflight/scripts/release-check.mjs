#!/usr/bin/env node
// expo-release-preflight / release-check.mjs
// "Will this release build succeed, and will it ship what I think it ships?"
// Zero dependencies. Node 18+.
//
// Usage:
//   node release-check.mjs [--project <dir>] [--profile production] [--config <resolved.json>]
//                          [--expect-version 1.4.0] [--run-expo-checks] [--json]
//
// --run-expo-checks also runs `npx expo-doctor` and `npx expo install --check` (needs node_modules,
// may need network). Exit codes: 0 = no blockers, 1 = blockers, 2 = could not run.

import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const projectDir = path.resolve(opt("--project") ?? process.cwd());
const profileName = opt("--profile") ?? "production";
const asJson = flag("--json");
const runExpoChecks = flag("--run-expo-checks");
const expectVersion = opt("--expect-version");

const findings = [];
const add = (severity, area, message, fix) => findings.push({ severity, area, message, fix });
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
const exists = (p) => fs.existsSync(p);
const sh = (cmd, timeout = 60_000) => {
  try {
    return execSync(cmd, { cwd: projectDir, stdio: ["ignore", "pipe", "ignore"], timeout }).toString();
  } catch {
    return undefined;
  }
};
function fail(msg) {
  if (asJson) console.log(JSON.stringify({ error: msg }));
  else console.error(`release-check: ${msg}`);
  process.exit(2);
}

// ---------- config ----------
function loadConfig() {
  const explicit = opt("--config");
  if (explicit) {
    const j = readJson(path.resolve(explicit));
    if (!j) fail(`Could not read --config ${explicit}`);
    return { config: j.expo ?? j.exp ?? j, source: explicit };
  }
  if (exists(path.join(projectDir, "node_modules", "expo"))) {
    const out = sh("npx --no-install expo config --json --type public");
    if (out) {
      try {
        const j = JSON.parse(out);
        return { config: j.exp ?? j, source: "npx expo config" };
      } catch {}
    }
  }
  const appJson = readJson(path.join(projectDir, "app.json"));
  if (appJson) return { config: appJson.expo ?? appJson, source: "app.json" };
  if (exists(path.join(projectDir, "app.config.ts")) || exists(path.join(projectDir, "app.config.js")))
    fail("Found app.config.* but could not resolve it. Run `npm install`, or pass --config with `npx expo config --json` output.");
  fail("No app.json / app.config.* found. Run from the Expo project root or pass --project.");
}

const { config, source } = loadConfig();
const pkg = readJson(path.join(projectDir, "package.json")) ?? {};
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
const has = (n) => Object.prototype.hasOwnProperty.call(deps, n);
const eas = readJson(path.join(projectDir, "eas.json"));
const ios = config.ios ?? {};
const android = config.android ?? {};
const plugins = config.plugins ?? [];
const plugin = (name) => {
  for (const p of plugins) {
    if (p === name) return { options: {} };
    if (Array.isArray(p) && p[0] === name) return { options: p[1] ?? {} };
  }
};
const expoMajor = Number(String(deps.expo ?? "").match(/(\d+)/)?.[1]) || undefined;

// ---------- git ----------
const isGit = sh("git rev-parse --is-inside-work-tree")?.trim() === "true";
const gitIgnored = (rel) => {
  if (!isGit) return false;
  const r = spawnSync("git", ["check-ignore", "-q", rel], { cwd: projectDir });
  return r.status === 0;
};
if (!isGit) {
  warn("Git", "Project is not a git repository.", "EAS Build uploads a git-tracked archive by default; initialise git or set EAS_NO_VCS=1 knowingly.");
} else {
  const dirty = sh("git status --porcelain")?.trim();
  if (dirty) {
    const n = dirty.split("\n").length;
    warn("Git", `${n} uncommitted change(s).`, "Commit before a store build so the binary matches a commit you can tag and reproduce.");
  }
  const branch = sh("git rev-parse --abbrev-ref HEAD")?.trim();
  if (branch && !/^(main|master|release.*|prod.*)$/.test(branch))
    info("Git", `Building from branch "${branch}".`, "Fine if intended; store builds usually come from main or a release branch.");
}

// ---------- referenced files exist and aren't gitignored ----------
const fileRefs = [];
const ref = (label, p) => typeof p === "string" && !/^https?:/.test(p) && fileRefs.push([label, p]);
ref("icon", config.icon);
ref("ios.icon", typeof ios.icon === "string" ? ios.icon : undefined);
ref("splash.image", config.splash?.image);
ref("android.adaptiveIcon.foregroundImage", android.adaptiveIcon?.foregroundImage);
ref("android.adaptiveIcon.monochromeImage", android.adaptiveIcon?.monochromeImage);
ref("android.googleServicesFile", android.googleServicesFile);
ref("ios.googleServicesFile", ios.googleServicesFile);
ref("notification.icon", config.notification?.icon);
const splashPlugin = plugin("expo-splash-screen")?.options;
ref("expo-splash-screen image", splashPlugin?.image);
ref("expo-notifications icon", plugin("expo-notifications")?.options?.icon);

for (const [label, rel] of fileRefs) {
  const abs = path.resolve(projectDir, rel);
  if (!exists(abs)) {
    // google services files are often injected from EAS file env vars
    const envish = /googleServicesFile/.test(label);
    const dynamic = source !== "app.json";
    (envish && dynamic ? warn : err)("Files", `${label} points to ${rel}, which doesn't exist${gitIgnored(rel) ? " and is gitignored" : ""}.`,
      envish
        ? dynamic
          ? "If an EAS file environment variable supplies it (e.g. GOOGLE_SERVICES_JSON), make sure app.config resolves process.env.GOOGLE_SERVICES_JSON ?? './google-services.json' and the variable exists in this environment."
          : "app.json can't read env vars, so this build will fail. Create an EAS file variable (`eas env:create --name GOOGLE_SERVICES_JSON --type file --visibility secret`), move to app.config.js, and set googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json'."
        : "Fix the path or add the file.");
  } else if (gitIgnored(rel)) {
    err("Files", `${label} (${rel}) is gitignored, so it won't be uploaded to EAS Build.`,
      "Commit it, or upload it as an EAS file environment variable (secret visibility) and read the path from process.env in app.config.js.");
  }
}

// ---------- package manager / lockfiles ----------
const locks = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock"].filter((f) => exists(path.join(projectDir, f)));
if (locks.length === 0) warn("Dependencies", "No lockfile.", "Commit one so EAS installs the same versions you tested.");
for (const l of locks) {
  const st = fs.statSync(path.join(projectDir, l));
  if (st.size === 0) err("Dependencies", `${l} is empty.`, "Regenerate it with your package manager's install and commit it; a frozen install on EAS will fail.");
  else if (l.endsWith(".json") && !readJson(path.join(projectDir, l))) err("Dependencies", `${l} isn't valid JSON (merge conflict?).`, "Regenerate and commit it.");
}
if (locks.length > 1) warn("Dependencies", `Multiple lockfiles: ${locks.join(", ")}.`, "EAS picks a package manager from the lockfile; keep exactly one.");

// ---------- CNG drift ----------
const nativeDirs = ["ios", "android"].filter((d) => exists(path.join(projectDir, d)));
if (nativeDirs.length) {
  const tracked = nativeDirs.filter((d) => !gitIgnored(d));
  if (tracked.length)
    warn("Native config (CNG)", `${tracked.join(" & ")} folder(s) are committed. EAS won't run prebuild, so changes to app.json (plugins, permissions, icons, versions) won't reach the build.`,
      "Either gitignore ios/ and android/ and let EAS prebuild (Continuous Native Generation), or apply config changes in the native projects too. Run `npx expo prebuild --clean` locally if you mean to regenerate them.");
  else info("Native config (CNG)", `${nativeDirs.join(" & ")} exist locally but are gitignored; EAS will prebuild from app config.`);
}

// ---------- versions ----------
const version = config.version;
if (!version) err("Versions", "`version` is missing from app config.", "Set the user-facing version (e.g. 1.4.0).");
if (expectVersion && version && expectVersion !== version)
  err("Versions", `You're releasing ${expectVersion} but app config says version ${version}.`, `Set "version": "${expectVersion}" (with remote versioning EAS only bumps build numbers, never the user-facing version).`);
const remote = eas?.cli?.appVersionSource === "remote";
if (eas && !eas.cli?.appVersionSource)
  warn("Versions", "eas.json has no cli.appVersionSource.", 'Set it explicitly; "remote" (with autoIncrement on production) is the recommended setup.');
if (isGit && version) {
  const tags = (sh("git tag --list") ?? "").split("\n").map((t) => t.trim());
  const hit = tags.find((t) => t === version || t === `v${version}` || t.endsWith(`@${version}`));
  if (hit)
    warn("Versions", `A git tag "${hit}" already exists for version ${version}.`,
      "If this is a new store release, bump `version` (App Store Connect rejects re-using a version that was already released).");
}
if (!remote) {
  if (!ios.buildNumber) warn("Versions", "No ios.buildNumber and not using remote versioning.", "Every upload needs a higher build number.");
  if (!android.versionCode) warn("Versions", "No android.versionCode and not using remote versioning.", "Every upload needs a higher versionCode.");
}

// ---------- eas.json profile ----------
let profile;
if (!eas) {
  warn("EAS", "No eas.json.", "Run `eas build:configure` (skip if you don't build with EAS).");
} else {
  const builds = eas.build ?? {};
  const resolve = (name, seen = new Set()) => {
    const p = builds[name];
    if (!p) return undefined;
    if (seen.has(name)) {
      err("EAS", `Circular "extends" involving profile "${name}".`);
      return p;
    }
    seen.add(name);
    if (p.extends) {
      if (!builds[p.extends]) {
        err("EAS", `Profile "${name}" extends "${p.extends}", which doesn't exist.`);
        return p;
      }
      const base = resolve(p.extends, seen) ?? {};
      return { ...base, ...p, ios: { ...base.ios, ...p.ios }, android: { ...base.android, ...p.android }, env: { ...base.env, ...p.env } };
    }
    return p;
  };
  for (const name of Object.keys(builds)) if (name !== profileName) {
    const p = builds[name];
    if (p.extends && !builds[p.extends]) err("EAS", `Profile "${name}" extends "${p.extends}", which doesn't exist.`, "Not this build, but every build of that profile will fail.");
  }
  for (const [name, sp] of Object.entries(eas.submit ?? {})) {
    for (const [k, rel] of [["android.serviceAccountKeyPath", sp.android?.serviceAccountKeyPath], ["ios.ascApiKeyPath", sp.ios?.ascApiKeyPath]]) {
      if (rel && !exists(path.resolve(projectDir, rel)))
        warn("EAS Submit", `submit.${name}.${k} points to ${rel}, which doesn't exist.`, "eas submit / --auto-submit will fail. Upload the key with `eas credentials` and remove the path, or provide the file in CI.");
    }
  }
  profile = resolve(profileName);
  if (!profile) err("EAS", `No build profile "${profileName}" in eas.json.`, "Pass --profile, or add the profile.");
  else {
    if (profile.developmentClient) err("EAS", `Profile "${profileName}" has developmentClient: true.`, "Store builds must not be dev clients.");
    if (profileName === "production" && profile.distribution === "internal")
      err("EAS", "Production profile has distribution: internal.", "Store builds need distribution: store (the default).");
    if (profile.android?.buildType === "apk" && profileName === "production")
      err("EAS", "Production profile builds an APK.", "Google Play needs an app bundle; remove android.buildType or set it to app-bundle.");
    if (!profile.environment)
      info("EAS", `Profile "${profileName}" doesn't set "environment"; EAS defaults to ${profile.developmentClient ? "development" : (profile.distribution ?? "store") === "store" ? "production" : "preview"}.`,
        "Set it explicitly so it's obvious which EAS environment variables this build gets.");
    if (remote && !profile.autoIncrement && profileName === "production")
      info("EAS", "Remote versioning without autoIncrement on production.", "Add autoIncrement: true, or bump with `eas build:version:set`.");
    if (profile.ios?.image === "latest" && expoMajor && expoMajor < 58)
      warn("EAS", `ios.image "latest" is Xcode 27; Expo SDK ${expoMajor} apps built with it need scene support to launch on iOS 27.`,
        "Remove ios.image to use the auto image for your SDK.");
  }
}

// ---------- updates / runtime version ----------
if (has("expo-updates")) {
  if (!config.runtimeVersion && !ios.runtimeVersion && !android.runtimeVersion)
    err("EAS Update", "expo-updates is installed but runtimeVersion isn't set.", 'Set runtimeVersion: { "policy": "fingerprint" } (or "appVersion").');
  const policy = config.runtimeVersion?.policy;
  if (policy === "nativeVersion" && remote)
    err("EAS Update", 'runtimeVersion policy "nativeVersion" is not supported with remote app versioning.', 'Use "fingerprint" or "appVersion".');
  if (profile && !profile.channel && !profile.developmentClient)
    warn("EAS Update", `Profile "${profileName}" has no channel.`, `Add "channel": "${profileName}" so builds can receive updates published to that channel.`);
  const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  if (!config.updates?.url) warn("EAS Update", "updates.url is not set.", "Run `eas update:configure`.");
  else if (/u\.expo\.dev/.test(config.updates.url) && !uuidRe.test(config.updates.url))
    err("EAS Update", `updates.url "${config.updates.url}" doesn't contain a project ID.`, "Run `eas update:configure` to set the real URL.");
  if (!config.extra?.eas?.projectId) warn("EAS", "extra.eas.projectId is missing.", "Run `eas init` (or `eas update:configure`) to link the project.");
} else if (profile?.channel) {
  info("EAS Update", `Profile sets channel "${profile.channel}" but expo-updates isn't installed.`, "Harmless; remove the channel or install expo-updates if you want OTA updates.");
}

// ---------- deep links ----------
if ((has("expo-router") || has("expo-linking")) && !config.scheme)
  warn("Linking", "expo-router / expo-linking is installed but no `scheme` is set.", "Set a unique `scheme` (e.g. \"myapp\") or deep links and auth redirects won't open the app.");

// ---------- source scan ----------
function* walk(dir, depth = 0) {
  if (depth > 8) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || ["node_modules", "ios", "android", "dist", "build", "web-build", "coverage"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, depth + 1);
    else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(e.name) && !/\.(test|spec|stories)\./.test(e.name) && !/^(app\.config|metro\.config|babel\.config|jest\.)/.test(e.name)) yield p;
  }
}
const envUsed = new Set();
const localUrls = [];
const leaks = [];
let consoleLogs = 0;
let files = 0;
for (const f of walk(projectDir)) {
  if (++files > 5000) break;
  let src;
  try {
    src = fs.readFileSync(f, "utf8");
  } catch {
    continue;
  }
  const rel = path.relative(projectDir, f);
  for (const m of src.matchAll(/process\.env\.(EXPO_PUBLIC_[A-Z0-9_]+)/g)) envUsed.add(m[1]);
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    if (/https?:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.\d+\.\d+|0\.0\.0\.0)(:\d+)?/.test(line) && !/^\s*(\/\/|\*)/.test(line))
      localUrls.push(`${rel}:${i + 1}`);
    if (/\bsk-(proj-|ant-)?[A-Za-z0-9_-]{20,}|\bsk_live_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16}/.test(line)) leaks.push(`${rel}:${i + 1}`);
  });
  consoleLogs += (src.match(/console\.log\(/g) ?? []).length;
}

if (localUrls.length)
  err("Endpoints", `Local/dev URLs in app code: ${localUrls.slice(0, 5).join(", ")}${localUrls.length > 5 ? ` (+${localUrls.length - 5} more)` : ""}.`,
    "Read the API base URL from an EXPO_PUBLIC_ variable set per EAS environment, or guard dev URLs with __DEV__.");
if (leaks.length)
  err("Secrets", `Hard-coded secret-looking keys: ${leaks.slice(0, 5).join(", ")}.`, "Anything in the bundle is public. Move it server-side and rotate the key.");
for (const v of envUsed) {
  if (/SECRET|PRIVATE|OPENAI|ANTHROPIC|SERVICE_ROLE|STRIPE_SK/.test(v))
    err("Secrets", `${v} is an EXPO_PUBLIC_ variable but looks secret.`, "EXPO_PUBLIC_ values are inlined into the JS bundle. Keep secrets on a server.");
}

// env vars: where are they defined?
if (envUsed.size) {
  const definedLocally = new Set();
  for (const f of [".env", ".env.production", ".env.local", ".env.production.local"]) {
    const p = path.join(projectDir, f);
    if (!exists(p)) continue;
    for (const m of fs.readFileSync(p, "utf8").matchAll(/^\s*([A-Z0-9_]+)\s*=/gm)) definedLocally.add(m[1]);
    if ((f === ".env.local" || f === ".env.production.local") && isGit && !gitIgnored(f))
      warn("Env", `${f} is not gitignored.`, "Keep local .env files out of git; define build values in EAS environment variables.");
  }
  const inProfile = new Set(Object.keys(profile?.env ?? {}));
  const unresolved = [...envUsed].filter((v) => !inProfile.has(v));
  if (unresolved.length)
    info("Env", `App reads ${envUsed.size} EXPO_PUBLIC_ variable(s); not set in the "${profileName}" profile's env: ${unresolved.join(", ")}.`,
      `Make sure each exists in the EAS "${profile?.environment ?? profileName}" environment (\`eas env:list --environment ${profile?.environment ?? profileName}\`). Local .env files are not used by EAS Build unless committed. Missing ones become undefined at runtime.` +
        (unresolved.some((v) => definedLocally.has(v)) ? " Some are only in local .env files." : ""));
}
if (consoleLogs > 50)
  info("Logging", `${consoleLogs} console.log calls in app code.`, "Consider babel-plugin-transform-remove-console for production, or a logger that no-ops outside __DEV__.");

// crash reporting
if (!["@sentry/react-native", "@bugsnag/expo", "@bugsnag/react-native", "@react-native-firebase/crashlytics", "expo-observe", "@datadog/mobile-react-native", "posthog-react-native"].some(has))
  info("Monitoring", "No crash/error reporting SDK found.", "Add one (Sentry, Crashlytics, expo-observe…) before a release so you see crashes from real devices; upload source maps.");

// ---------- optional: expo-doctor & dependency alignment ----------
if (runExpoChecks) {
  const doctor = spawnSync("npx", ["--yes", "expo-doctor@latest"], { cwd: projectDir, encoding: "utf8", timeout: 180_000 });
  const out = `${doctor.stdout ?? ""}${doctor.stderr ?? ""}`.trim();
  if (doctor.status === 0) info("expo-doctor", "expo-doctor passed.");
  else (doctor.status == null ? warn : err)("expo-doctor", doctor.status == null ? "expo-doctor could not run (timeout or no network)." : "expo-doctor reported problems:\n" + out.split("\n").filter((l) => /✖|✗|×|fail|error|mismatch|should/i.test(l)).slice(0, 15).join("\n"), "Fix these before building; most are version mismatches fixable with `npx expo install --fix`.");
  const check = spawnSync("npx", ["--no-install", "expo", "install", "--check"], { cwd: projectDir, encoding: "utf8", timeout: 120_000 });
  if (check.status === 0) info("Dependencies", "All Expo-managed packages match the SDK.");
  else if (check.status != null) err("Dependencies", "Packages don't match the Expo SDK:\n" + `${check.stdout ?? ""}${check.stderr ?? ""}`.trim().split("\n").slice(0, 15).join("\n"), "Run `npx expo install --fix`, then test again.");
} else {
  info("Dependencies", "Skipped expo-doctor / `expo install --check`.", "Re-run with --run-expo-checks, or run `npx expo-doctor` yourself.");
}

// ---------- output ----------
const order = { error: 0, warning: 1, info: 2 };
findings.sort((a, b) => order[a.severity] - order[b.severity]);
const counts = Object.fromEntries(["error", "warning", "info"].map((s) => [s, findings.filter((f) => f.severity === s).length]));
if (asJson) {
  console.log(JSON.stringify({ app: config.name, version, profile: profileName, configSource: source, counts, findings }, null, 2));
} else {
  const icon = { error: "✖", warning: "▲", info: "·" };
  console.log(`\nexpo-release-preflight — ${config.name ?? "app"} ${version ?? ""} (profile: ${profileName}, config: ${source})\n`);
  for (const sev of ["error", "warning", "info"]) {
    const list = findings.filter((f) => f.severity === sev);
    if (!list.length) continue;
    console.log(`${sev.toUpperCase()}S (${list.length})`);
    for (const f of list) {
      console.log(`  ${icon[sev]} ${f.area}: ${f.message.replace(/\n/g, "\n      ")}`);
      if (f.fix) console.log(`      → ${f.fix}`);
    }
    console.log("");
  }
  console.log(`Summary: ${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info.`);
}
process.exit(counts.error ? 1 : 0);
