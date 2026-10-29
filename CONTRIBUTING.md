# Contributing

## Updating a store or EAS rule

1. Cite the official source in the PR (Apple App Review Guidelines / Upcoming Requirements, Google
   Play Console Help, docs.expo.dev, the EAS CLI changelog).
2. Change the reference text and any script constant that encodes the rule.
3. Bump `metadata.rules-checked-on` in **every** `SKILL.md` and `RULES_CHECKED_ON` in
   `skills/app-store-review-guard/scripts/preflight.mjs`. The tests require them to match and to
   be less than 120 days old, and CI runs weekly, so a stale kit turns red on its own.
4. Add a line to `CHANGELOG.md`.

## Changing a script

- Keep each skill self-contained (no shared modules, no dependencies): a skill folder must still work
  when copied or zipped on its own.
- Add or update a case in `tests/scripts.test.mjs`. A new build-log pattern needs a real log line in
  `LOG_SAMPLES`; the suite fails without one.
- Run `node --test tests/scripts.test.mjs` (Node 18+). CI runs it on Linux and Windows.

## Agent evals

`evals/` holds `claude plugin eval` cases. If you change how a skill behaves, run the related cases:

```bash
claude plugin eval . --allow-tools Bash,Write,Edit --scaffold --tag <skill-name> --runs 1
```
