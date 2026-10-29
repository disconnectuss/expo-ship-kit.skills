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
