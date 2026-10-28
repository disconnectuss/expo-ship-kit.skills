# Rollouts and rollbacks

Checked 2026-10-28 against Expo's EAS Update rollouts and rollbacks docs.

## Per-update rollouts

Publish a new update to a percentage of users, then widen it.

| Step | Command |
|---|---|
| Start at 10% | `eas update --channel production --environment production --rollout-percentage 10 --message "…"` |
| Widen | `eas update:edit` → choose the update → new percentage |
| Finish | `eas update:edit` → 100 |
| Revert | `eas update:revert-update-rollout` (republishes the control update) |
| Status | `eas update:list`, `eas update:view <group-id>` |

Rules: one active rollout per branch + platform + runtime version. Publishing to the same combination
while a rollout is active stops with an error unless you pass `--force-end-active-rollout` (EAS CLI
24.9.0+; also accepted by `update:republish`, `update:roll-back-to-embedded` and `update:rollback`).
Finish or revert a rollout before starting another.

## Branch-based rollouts

Move a percentage of a channel's users to a different branch (good for bigger changes you've staged on
their own branch).

- Start / edit: `eas channel:rollout` (interactive: channel, branch, percentage; rerun → Edit).
- End: rerun → End → either *republish and revert* (copy the new branch's latest update to the old
  branch, then point everyone back) or *revert* (discard the new branch's updates).
- One branch rollout per channel at a time. During it, `eas update --channel` is blocked (the CLI can't
  tell which branch you mean) — publish with `eas update --branch <name>`.

## Rollbacks

`eas update:rollback` is interactive:

- **Previous update**: republishes an earlier good update so clients move back to it.
- **Embedded update**: tells clients to run the bundle that shipped inside the build.

After any rollback, the next update you publish goes to all clients on that branch/runtime. Fix
forward with care.

## A sane hotfix sequence

1. Check out a branch from the store build's commit with only the fix (see SKILL.md), then
   `node <skill-dir>/scripts/ota-or-build.mjs --base <store-build tag>` → OTA-safe.
2. Publish to `preview`, verify on a preview build of the same runtime.
3. Publish to `production` with `--rollout-percentage 10`; watch crash reporting for an hour.
4. Widen to 50%, then 100% with `eas update:edit`.
5. If crash rates rise: `eas update:revert-update-rollout` (during a rollout) or `eas update:rollback`.
