# Security

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on
[disconnectuss/expo-ship-kit.skills](https://github.com/disconnectuss/expo-ship-kit.skills/security/advisories/new).
Don't open a public issue. Expect a first reply within a week.

## What the scripts do on your machine

All scripts are zero-dependency Node and read-only: they never write files or send data anywhere.
They do run a few local commands in the project you point them at:

| Command | Run by | Why |
|---|---|---|
| `git` (read-only subcommands) | all except `diagnose-build-log.mjs` | ignored/tracked files, diffs, tags |
| `npx --no-install expo config --json` | `preflight.mjs`, `release-check.mjs`, when `node_modules/expo` exists | resolve `app.config.*`; this executes the project's own config file |
| `npx --yes expo-doctor@latest`, `npx expo install --check` | `release-check.mjs`, only with `--run-expo-checks` | dependency checks; downloads expo-doctor from npm |

Only run them on projects whose `app.config.*` you trust, as with any Expo CLI command.

## Skill instructions

`SKILL.md` files are instructions an AI agent follows. Install this kit from this repository or a
fork you have reviewed, and review changes to `skills/**/SKILL.md` like code.
