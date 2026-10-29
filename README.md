# expo-ship-kit

Four [Agent Skills](https://agentskills.io) that take an Expo / React Native app from "it works on my
phone" to "it's live in both stores" — and keep it there.

| Skill | Ask it… | What it brings |
|---|---|---|
| **expo-release-preflight** | "Cutting the production build tonight — anything that'll bite me?" | `release-check.mjs`: gitignored assets that won't upload, committed `ios/`/`android/` that silently ignore app.json, localhost URLs and leaked keys, EAS environment vs `EXPO_PUBLIC_` usage, versions, channels, runtimeVersion, optional expo-doctor. Release smoke-test checklist. |
| **eas-build-submit** | "My EAS build failed in Run fastlane" · "Set up CI for this app" | `diagnose-build-log.mjs`: matches ~30 known build/submit failures (pods, signing, Gradle, JS bundling, OOM, ITMS errors, Play draft app, versionCode reuse…) earliest-first. `check-eas-config.mjs`: validates eas.json, submit profiles, committed credentials, rollouts, workflows. Annotated eas.json, submit guides, EAS Workflows examples. |
| **expo-ota-updates** | "Can I ship this fix as an update tonight?" | `ota-or-build.mjs`: diffs two git refs and says OTA / needs a build / verify, with reasons (native deps checked in node_modules, native app.json keys, plugins, patches, icons). Runtime version policies, channels, `--environment`, rollouts and rollbacks. |
| **app-store-review-guard** | "Will Apple reject this?" · "Rejected under 4.8, what now?" · "Write my review notes" | `preflight.mjs`: permission strings, privacy manifest, ATT, account deletion, Sign in with Apple, IAP vs Stripe, third-party AI consent, hidden features (2.5.19), target API 36, sensitive Android permissions, icon alpha. Rejection playbook and review-notes template. |

Every script is zero-dependency Node (18+), prints a human report or `--json`, and exits non-zero on
blockers — so they work in CI as well as inside an agent.

## Install

**Claude Code (plugin):**

```text
/plugin marketplace add disconnectuss/expo-ship-kit.skills
/plugin install expo-ship-kit@expo-ship-kit
```

Skills are then available as `/expo-ship-kit:expo-release-preflight` etc., and trigger automatically
when relevant.

**Any agent that reads SKILL.md** (Codex CLI, Cursor, Gemini CLI, Claude Code without plugins…):

```bash
npx skills add disconnectuss/expo-ship-kit.skills
```

or copy a folder from `skills/` into your agent's skills directory (e.g. `~/.claude/skills/`).

**Claude.ai:** zip one skill folder and upload it as a custom skill.

## Run the scripts directly

```bash
node skills/expo-release-preflight/scripts/release-check.mjs --run-expo-checks
node skills/eas-build-submit/scripts/check-eas-config.mjs
node skills/eas-build-submit/scripts/diagnose-build-log.mjs build.log
node skills/expo-ota-updates/scripts/ota-or-build.mjs --base v1.4.0
node skills/app-store-review-guard/scripts/preflight.mjs
```

Run them from your Expo project root (or pass `--project <dir>`).

## Freshness

Store rules and EAS behaviour change several times a year. Everything here was checked on
**29 Oct 2026** against Apple's App Review Guidelines (16 Oct 2026) and upcoming requirements, Google
Play Console Help, Expo SDK 58 and the EAS docs. Each `SKILL.md` carries `metadata.rules-checked-on`.
PRs that update a rule should cite the official source and bump that date.

## Tests

`evals/` holds one or more test cases per skill in the format `claude plugin eval` reads:

```bash
claude plugin eval . --allow-tools Bash,Write,Edit --scaffold
```

## License

MIT © Fatma Aktas
# expo-ship-kit.skills
