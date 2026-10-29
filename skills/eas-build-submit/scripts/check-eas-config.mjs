#!/usr/bin/env node
// eas-build-submit / check-eas-config.mjs
// Validate eas.json build + submit profiles and the files they point to.
// Zero dependencies. Node 18+.
//
// Usage: node check-eas-config.mjs [--project <dir>] [--json]
// Exit codes: 0 = ok, 1 = errors, 2 = could not run.

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

const findings = [];
const add = (severity, where, message, fix) => findings.push({ severity, where, message, fix });
const err = (...a) => add("error", ...a);
const warn = (...a) => add("warning", ...a);
const info = (...a) => add("info", ...a);

const easPath = path.join(projectDir, "eas.json");
let eas;
try {
  eas = JSON.parse(fs.readFileSync(easPath, "utf8"));
} catch (e) {
  const msg = fs.existsSync(easPath) ? `eas.json is not valid JSON: ${e.message}` : "No eas.json. Run `eas build:configure`.";
  if (asJson) console.log(JSON.stringify({ error: msg }));
  else console.error(msg);
  process.exit(2);
}

const isGit = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: projectDir }).status === 0;
const tracked = (rel) => isGit && spawnSync("git", ["ls-files", "--error-unmatch", rel], { cwd: projectDir }).status === 0;
const ignored = (rel) => isGit && spawnSync("git", ["check-ignore", "-q", rel], { cwd: projectDir }).status === 0;

const KNOWN_BUILD_KEYS = new Set(["extends", "distribution", "channel", "environment", "developmentClient", "autoIncrement", "env", "resourceClass",
  "withoutCredentials", "buildArtifactPaths", "node", "pnpm", "yarn", "bun", "corepack", "cache", "credentialsSource", "ios", "android",
  "releaseChannel", "prebuildCommand", "config", "image", "autoSubmit", "permissions"]);
const builds = eas.build ?? {};
const submits = eas.submit ?? {};

// ---------- cli ----------
if (!eas.cli?.version) info("cli", "No cli.version constraint.", 'Pin a minimum, e.g. "cli": { "version": ">= 24.9.0" }, so teammates and CI use an EAS CLI that has the commands this kit suggests.');
if (!eas.cli?.appVersionSource) warn("cli", "No cli.appVersionSource.", 'Set "remote" (recommended) and use autoIncrement on production.');

// ---------- build profiles ----------
if (!Object.keys(builds).length) err("build", "No build profiles.", "Add at least development, preview and production.");
for (const [name, p] of Object.entries(builds)) {
  const where = `build.${name}`;
  for (const k of Object.keys(p)) if (!KNOWN_BUILD_KEYS.has(k)) warn(where, `Unknown key "${k}".`, "Check spelling against the eas.json reference; unknown keys are rejected or ignored.");
  if (p.extends && !builds[p.extends]) err(where, `extends "${p.extends}", which doesn't exist.`);
  if (p.releaseChannel) err(where, "Uses releaseChannel (classic updates, removed).", 'Use "channel" with EAS Update.');
  if (p.distribution && !["store", "internal"].includes(p.distribution)) err(where, `distribution "${p.distribution}" is invalid.`, 'Use "store" or "internal".');
  if (p.resourceClass && !["default", "medium", "large"].includes(p.resourceClass) && !/^m-/.test(p.resourceClass))
    warn(where, `resourceClass "${p.resourceClass}" isn't one of default/medium/large.`);
  if (p.environment && !["development", "preview", "production"].includes(p.environment))
    info(where, `Custom environment "${p.environment}".`, "Custom environments need a plan that supports them and at least one variable linked to it.");
  if (p.env) {
    const secretish = Object.keys(p.env).filter((k) => /SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY/i.test(k));
    if (secretish.length)
      err(where, `env contains secret-looking keys (${secretish.join(", ")}). eas.json is committed and env values here are plain text.`,
        "Move them to EAS environment variables: `eas env:set --environment production --visibility secret`.");
  }
  if (p.ios?.simulator && p.distribution !== "internal" && name === "production") err(where, "Production builds a simulator binary.", "Remove ios.simulator from production.");
  if (/prod/i.test(name) && p.android?.buildType === "apk") err(where, "Production profile builds an APK.", "Google Play needs an .aab (default buildType app-bundle).");
  if (/prod/i.test(name) && p.developmentClient) err(where, "Production profile is a development client.");
  if (/prod/i.test(name) && !p.environment && p.distribution === "internal")
    warn(where, 'No "environment" set and distribution is internal, so EAS loads the "preview" environment.', 'Add "environment": "production" if this build should use production variables.');
  const img = p.ios?.image;
  if (img && (/xcode-1\d\b|xcode-1\d\./.test(img) || /^sdk-(4\d|5[0-3])$/.test(img)))
    err(where, `ios.image "${img}" builds with Xcode < 26, which App Store Connect rejects since 2026-04-28.`, "Remove ios.image to use the auto image for your Expo SDK.");
}
if (builds.production && builds.production.autoIncrement === undefined && eas.cli?.appVersionSource === "remote")
  info("build.production", "Remote versioning without autoIncrement.", 'Add "autoIncrement": true.');

// ---------- submit profiles ----------
const fileCheck = (where, key, rel) => {
  if (!rel) return;
  const abs = path.resolve(projectDir, rel);
  if (!fs.existsSync(abs)) {
    warn(where, `${key} points to ${rel}, which doesn't exist here.`, "Fine if CI writes it at runtime; otherwise upload the key with `eas credentials` and remove the path.");
    return;
  }
  if (tracked(rel)) err(where, `${rel} (${key}) is committed to git. It's a private credential.`, "Remove it from git history, rotate the key, and store it with `eas credentials` (or a secret file env var in CI).");
  else if (!ignored(rel)) warn(where, `${rel} isn't gitignored.`, "Add it to .gitignore so it never gets committed.");
};

if (!Object.keys(submits).length) {
  info("submit", "No submit profiles.", "`eas submit` will prompt interactively. Add a production submit profile for CI / --auto-submit / EAS Workflows.");
}
for (const [name, p] of Object.entries(submits)) {
  const where = `submit.${name}`;
  if (p.extends && !submits[p.extends]) err(where, `extends "${p.extends}", which doesn't exist.`);
  const i = p.ios;
  if (i) {
    if (!i.ascAppId) warn(`${where}.ios`, "No ascAppId.", "Set the App Store Connect app ID (App Information → Apple ID) so non-interactive submits don't need to look up or create the app.");
    if (i.appleId && !i.ascApiKeyPath && !i.ascApiKeyId)
      info(`${where}.ios`, "Uses an Apple ID login.", "For CI, use an App Store Connect API key (App Manager role) — no 2FA prompts.");
    if ((i.ascApiKeyPath || i.ascApiKeyId) && !(i.ascApiKeyPath && i.ascApiKeyId && i.ascApiKeyIssuerId))
      err(`${where}.ios`, "Incomplete ASC API key: ascApiKeyPath, ascApiKeyId and ascApiKeyIssuerId must all be set.", "Or upload the key once with `eas credentials -p ios` and drop these fields.");
    fileCheck(`${where}.ios`, "ascApiKeyPath", i.ascApiKeyPath);
  }
  const a = p.android;
  if (a) {
    const tracks = ["production", "beta", "alpha", "internal"];
    if (a.track && !tracks.includes(a.track)) info(`${where}.android`, `Custom track "${a.track}".`, "Must match a closed-testing track name in Play Console exactly.");
    const statuses = ["completed", "draft", "halted", "inProgress"];
    if (a.releaseStatus && !statuses.includes(a.releaseStatus)) err(`${where}.android`, `releaseStatus "${a.releaseStatus}" is invalid.`, `Use one of ${statuses.join(", ")}.`);
    if (a.rollout !== undefined) {
      if (a.releaseStatus !== "inProgress") err(`${where}.android`, "rollout is set but releaseStatus isn't inProgress.", 'Set "releaseStatus": "inProgress" for a staged rollout.');
      if (!(a.rollout > 0 && a.rollout <= 1)) err(`${where}.android`, `rollout ${a.rollout} must be a fraction between 0 and 1 (e.g. 0.1 = 10%).`);
    }
    if (a.track === "production" && a.releaseStatus === "completed")
      info(`${where}.android`, "Submits straight to 100% of production.", 'Consider "releaseStatus": "inProgress" with "rollout": 0.1 for a staged rollout, or "draft" to release manually.');
    fileCheck(`${where}.android`, "serviceAccountKeyPath", a.serviceAccountKeyPath);
  }
}
for (const name of Object.keys(builds)) {
  if (/prod/i.test(name) && !submits[name] && Object.keys(submits).length)
    info(`build.${name}`, `No submit profile named "${name}".`, `--auto-submit uses the submit profile with the same name; add submit.${name} or use --auto-submit-with-profile.`);
}

// ---------- workflows ----------
const wfDir = path.join(projectDir, ".eas", "workflows");
if (fs.existsSync(wfDir)) {
  const files = fs.readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f));
  for (const f of files) {
    const y = fs.readFileSync(path.join(wfDir, f), "utf8");
    const types = [...y.matchAll(/^\s*type:\s*([\w-]+)/gm)].map((m) => m[1]);
    info(".eas/workflows", `${f}: jobs of type ${[...new Set(types)].join(", ") || "custom"}.`);
    const profiles = [...y.matchAll(/^\s*profile:\s*['"]?([\w-]+)/gm)].map((m) => m[1]);
    for (const pr of profiles) if (!builds[pr] && !submits[pr]) err(".eas/workflows", `${f} references profile "${pr}", which isn't in eas.json.`);
    if (types.includes("submit") && !Object.keys(submits).length)
      warn(".eas/workflows", `${f} submits but eas.json has no submit profiles.`, "Non-interactive submits need ascAppId (iOS) and stored credentials.");
  }
}

// ---------- output ----------
const order = { error: 0, warning: 1, info: 2 };
findings.sort((a, b) => order[a.severity] - order[b.severity]);
const counts = Object.fromEntries(["error", "warning", "info"].map((s) => [s, findings.filter((f) => f.severity === s).length]));
if (asJson) console.log(JSON.stringify({ counts, findings }, null, 2));
else {
  const icon = { error: "✖", warning: "▲", info: "·" };
  console.log("\neas-build-submit — eas.json check\n");
  for (const f of findings) {
    console.log(`  ${icon[f.severity]} ${f.where}: ${f.message}`);
    if (f.fix) console.log(`      → ${f.fix}`);
  }
  console.log(`\nSummary: ${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info.`);
}
process.exit(counts.error ? 1 : 0);
