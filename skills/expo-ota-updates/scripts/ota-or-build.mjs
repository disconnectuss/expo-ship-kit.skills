#!/usr/bin/env node
// expo-ota-updates / ota-or-build.mjs
// Decide whether the changes between two git refs can ship as an EAS Update (OTA) or need a new
// store build. Heuristic and explainable; confirm with `eas fingerprint:compare` when in doubt.
// Zero dependencies. Node 18+, git.
//
// Usage:
//   node ota-or-build.mjs [--base <ref>] [--head <ref>] [--project <dir>] [--json]
//   --base defaults to the latest tag reachable from HEAD; with no tags, pass it explicitly.
//   --head defaults to the working tree (uncommitted changes included).
// Exit codes: 0 = OTA is fine, 1 = needs a build, 3 = unsure (verify with fingerprint), 2 = could not run.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const projectDir = path.resolve(opt("--project") ?? process.cwd());
const asJson = args.includes("--json");

const git = (...a) => {
  const r = spawnSync("git", a, { cwd: projectDir, encoding: "utf8" });
  return r.status === 0 ? r.stdout : undefined;
};
const fail = (m) => {
  if (asJson) console.log(JSON.stringify({ error: m }));
  else console.error(`ota-or-build: ${m}`);
  process.exit(2);
};
if (git("rev-parse", "--is-inside-work-tree")?.trim() !== "true") fail("Not a git repository.");

const head = opt("--head");
let base = opt("--base");
// Guessing origin/main or HEAD~1 could hide a native change that is already merged but not in the store build.
base ??= git("describe", "--tags", "--abbrev=0")?.trim() || fail("No git tag found. Pass --base <commit or tag the current store build was made from>.");
if (!git("rev-parse", "--verify", base)) fail(`Unknown base ref "${base}".`);

// Paths are relative to the git root; map project-relative names.
const gitRoot = git("rev-parse", "--show-toplevel").trim();
const prefix = path.relative(gitRoot, projectDir);
const P = (rel) => (prefix ? `${prefix}/${rel}` : rel).replace(/\\/g, "/");
const strip = (p) => (prefix && p.startsWith(prefix + "/") ? p.slice(prefix.length + 1) : p);

const diffArgs = head ? ["diff", "--name-only", base, head] : ["diff", "--name-only", base];
const changed = (git(...diffArgs) ?? "").split("\n").filter(Boolean).map(strip);
if (!head) {
  const untracked = (git("ls-files", "--others", "--exclude-standard") ?? "").split("\n").filter(Boolean).map(strip);
  changed.push(...untracked);
}

const show = (ref, rel) => git("show", `${ref}:${P(rel)}`);
const readAt = (ref, rel) => (ref ? show(ref, rel) : fs.existsSync(path.join(projectDir, rel)) ? fs.readFileSync(path.join(projectDir, rel), "utf8") : undefined);
const json = (s) => {
  try {
    return s ? JSON.parse(s) : undefined;
  } catch {
    return undefined;
  }
};

const native = []; // reasons a build is required
const unsure = []; // reasons we can't be sure
const ota = []; // things that are fine OTA

// ---------- native folders & native-ish files ----------
for (const f of changed) {
  if (/^(ios|android)\//.test(f)) native.push(`Native project file changed: ${f}`);
  else if (/(^|\/)(Podfile|Podfile\.lock|.*\.podspec|build\.gradle|settings\.gradle|gradle\.properties|.*\.xcconfig|AndroidManifest\.xml|Info\.plist)$/.test(f))
    native.push(`Native build file changed: ${f}`);
  else if (/^modules\/[^/]+\/(ios|android)\//.test(f) || /^modules\/[^/]+\/expo-module\.config\.json$/.test(f))
    native.push(`Local Expo module native code changed: ${f}`);
  else if (/^patches\/.+\.patch$/.test(f)) unsure.push(`patch-package patch changed: ${f} (native if it patches ios/ or android/ files)`);
  else if (/^plugins\/|app\.plugin\.js$|withPlugin|config-plugin/i.test(f)) native.push(`Config plugin changed: ${f}`);
  else if (/^\.fingerprintignore$|^fingerprint\.config\.js$/.test(f)) unsure.push(`Fingerprint configuration changed: ${f}`);
}
// patches: inspect content when possible
for (const f of changed.filter((c) => /^patches\/.+\.patch$/.test(c))) {
  const body = readAt(head, f) ?? "";
  if (/^\+\+\+ .*\/(ios|android)\//m.test(body) || /\.(m|mm|swift|java|kt|h|cpp|gradle|podspec)\b/.test(body)) {
    native.push(`Patch touches native code: ${f}`);
    const i = unsure.findIndex((u) => u.includes(f));
    if (i >= 0) unsure.splice(i, 1);
  }
}

// ---------- dependencies ----------
const pkgBase = json(show(base, "package.json")) ?? {};
const pkgHead = json(readAt(head, "package.json")) ?? {};
const depsOf = (p) => ({ ...(p.dependencies ?? {}) });
const db = depsOf(pkgBase);
const dh = depsOf(pkgHead);
const depChanges = [];
for (const name of new Set([...Object.keys(db), ...Object.keys(dh)])) {
  if (db[name] !== dh[name]) depChanges.push({ name, from: db[name], to: dh[name] });
}
const isNativePkg = (name) => {
  const dir = path.join(projectDir, "node_modules", name);
  if (!fs.existsSync(dir)) return undefined;
  const has = (f) => fs.existsSync(path.join(dir, f));
  if (has("ios") || has("android") || has("expo-module.config.json") || has("app.plugin.js")) return true;
  try {
    if (fs.readdirSync(dir).some((f) => f.endsWith(".podspec"))) return true;
    const pj = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    if (pj.codegenConfig || pj["react-native"]?.includes?.("android")) return true;
  } catch {}
  return false;
};
const KNOWN_NATIVE = /^(expo-|@expo\/(?!vector-icons)|react-native(?!-web)|@react-native|@react-native-|@shopify\/react-native-skia|@sentry\/react-native|@stripe\/stripe-react-native|lottie-react-native)/;
const KNOWN_JS = /^(@expo\/vector-icons|zustand|jotai|redux|@reduxjs|@tanstack|axios|date-fns|dayjs|lodash|zod|i18next|react-i18next|@supabase\/supabase-js|firebase$|nativewind|tailwindcss|clsx|immer|swr|graphql|@apollo\/client|uuid|nanoid)/;
for (const c of depChanges) {
  const verdict = isNativePkg(c.name);
  const label = `${c.name} ${c.from ?? "(new)"} → ${c.to ?? "(removed)"}`;
  if (c.name === "expo" || c.name === "react-native") native.push(`${label} — SDK / React Native change`);
  else if (verdict === true) native.push(`${label} — package contains native code`);
  else if (verdict === false) ota.push(`${label} — JS-only package (no native code in node_modules)`);
  else if (KNOWN_JS.test(c.name)) ota.push(`${label} — JS-only package`);
  else if (KNOWN_NATIVE.test(c.name)) native.push(`${label} — likely native (not installed locally to confirm)`);
  else unsure.push(`${label} — install dependencies to check whether it has native code`);
}
if (changed.some((f) => /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/.test(f)) && !depChanges.length)
  unsure.push("Lockfile changed without package.json changes — transitive native dependencies may have moved; verify with fingerprint.");

// ---------- app config ----------
const NATIVE_KEYS = ["name", "scheme", "plugins", "ios", "android", "icon", "splash", "orientation", "userInterfaceStyle", "notification",
  "runtimeVersion", "updates", "newArchEnabled", "jsEngine", "primaryColor", "backgroundColor", "locales", "experiments"];
const appBase = json(show(base, "app.json"));
const appHead = json(readAt(head, "app.json"));
let runtimePolicy;
if (appBase || appHead) {
  const a = appBase?.expo ?? appBase ?? {};
  const b = appHead?.expo ?? appHead ?? {};
  runtimePolicy = b.runtimeVersion?.policy ?? (typeof b.runtimeVersion === "string" ? `custom "${b.runtimeVersion}"` : undefined);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    if (k === "version") {
      if (runtimePolicy === "appVersion") native.push(`app.json version ${a.version} → ${b.version}: with the appVersion policy this is a new runtime, so existing builds won't receive the update`);
      else ota.push(`app.json version ${a.version} → ${b.version} (doesn't affect a ${runtimePolicy ?? "fingerprint"} runtime)`);
    } else if (NATIVE_KEYS.includes(k)) native.push(`app.json "${k}" changed — native configuration`);
    else if (k === "extra") ota.push('app.json "extra" changed (delivered with the update manifest)');
    else unsure.push(`app.json "${k}" changed`);
  }
}
if (changed.some((f) => /^app\.config\.(js|ts|mjs|cjs)$/.test(f)))
  unsure.push("app.config.* changed — dynamic config can affect native settings; verify with fingerprint.");

// assets referenced by native config
const nativeAssetRefs = new Set();
const cfg = appHead?.expo ?? appHead ?? {};
for (const v of [cfg.icon, cfg.ios?.icon, cfg.splash?.image, cfg.android?.adaptiveIcon?.foregroundImage, cfg.android?.adaptiveIcon?.monochromeImage, cfg.notification?.icon])
  if (typeof v === "string") nativeAssetRefs.add(path.normalize(v));
for (const p of cfg.plugins ?? []) if (Array.isArray(p) && p[1]?.image) nativeAssetRefs.add(path.normalize(p[1].image));
for (const f of changed) if (nativeAssetRefs.has(path.normalize(f)) || nativeAssetRefs.has(path.normalize("./" + f))) native.push(`Native asset changed: ${f} (icon/splash are baked into the binary)`);

// JS / assets
const jsFiles = changed.filter((f) => /\.(tsx?|jsx?|json|css)$/.test(f) && !/^(package|app|eas|tsconfig)\.json$/.test(f) && !/^(ios|android)\//.test(f));
const assetFiles = changed.filter((f) => /\.(png|jpe?g|webp|gif|svg|ttf|otf|mp3|mp4|lottie)$/.test(f) && !nativeAssetRefs.has(path.normalize(f)));
if (jsFiles.length) ota.push(`${jsFiles.length} JS/TS file(s) changed`);
if (assetFiles.length) ota.push(`${assetFiles.length} asset file(s) changed (shipped with the update)`);
if (changed.includes("eas.json")) unsure.push("eas.json changed — doesn't affect the runtime, but channel/environment changes only apply to new builds");

// ---------- verdict ----------
const verdict = native.length ? "build" : unsure.length ? "unsure" : changed.length ? "ota" : "nothing";
const result = { base, head: head ?? "working tree", changedFiles: changed.length, runtimePolicy: runtimePolicy ?? "not set", verdict, native, unsure, ota };

if (asJson) console.log(JSON.stringify(result, null, 2));
else {
  const title = {
    build: "NEEDS A NEW BUILD — an OTA update would not match the native code in existing builds.",
    unsure: "PROBABLY OTA, BUT VERIFY — some changes might affect native code.",
    ota: "OTA UPDATE IS FINE — only JavaScript/assets changed.",
    nothing: "No changes between the refs.",
  }[verdict];
  console.log(`\nota-or-build: ${base} → ${result.head} (${changed.length} files, runtimeVersion: ${result.runtimePolicy})\n`);
  console.log(title + "\n");
  if (native.length) console.log("Requires a build:\n" + native.map((r) => "  ✖ " + r).join("\n") + "\n");
  if (unsure.length) console.log("Check:\n" + unsure.map((r) => "  ? " + r).join("\n") + "\n");
  if (ota.length) console.log("OTA-safe:\n" + ota.map((r) => "  ✓ " + r).join("\n") + "\n");
  if (!runtimePolicy) console.log('Note: no runtimeVersion in app.json (or it\'s set in app.config.*). Without one, updates can reach incompatible builds. Use { "policy": "fingerprint" }.\n');
  if (verdict !== "ota" && verdict !== "nothing") console.log("Confirm: `eas fingerprint:compare` (compares your project with a build's fingerprint).");
}
process.exit({ ota: 0, nothing: 0, build: 1, unsure: 3 }[verdict]);
