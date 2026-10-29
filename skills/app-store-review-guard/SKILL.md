---
name: app-store-review-guard
description: Pre-submission review audit for Expo / React Native apps going to the Apple App Store and Google Play. Runs a static check of app.json/app.config, package.json and eas.json, then walks the store-rejection checklist (privacy manifest, permission strings, account deletion, login services, in-app purchase, ATT, third-party AI disclosure, hidden features, target API level, closed testing, Data safety). Use this whenever someone is about to submit or update an Expo/RN app, asks "will this get rejected?", is preparing App Review notes, got a rejection email from App Review or Google Play, or mentions EAS Submit, TestFlight external review, or Play Console production access — even if they don't say "review".
license: MIT
compatibility: Node.js 18+ for scripts/preflight.mjs. Works best inside the Expo project root.
metadata:
  version: "0.1.0"
  rules-checked-on: "2026-10-29"
  part-of: expo-ship-kit
---

# App Store Review Guard

Most store rejections for Expo apps are not about code quality. They come from a short list of
predictable gaps: a vague permission string, a missing account-deletion path, Google Sign-In without
an equivalent private login option, a subscription screen that hides the price, a reviewer who could
not log in. This skill finds those gaps **before** submission, and turns a rejection email into a
concrete fix when one has already happened.

Sibling skills in expo-ship-kit: `expo-release-preflight` (is the build itself correct?),
`eas-build-submit` (building, submitting, fixing failed builds), `expo-ota-updates` (fixes without a
store build). Hand off when the question is really theirs.

Store rules move every few months. The rules in `references/` were checked on the date in the
frontmatter. If the user's submission is more than ~3 months later, say so and suggest re-checking
Apple's "Upcoming Requirements" page and Google's target API page before trusting dates.

## Modes

Pick the mode from what the user is doing:

- **Pre-submission audit** (default): the app is about to be submitted or updated.
- **Rejection triage**: the user pastes or describes a rejection. Go to `references/rejection-playbook.md`
  first, find the matching guideline, then audit only the related areas. Answer with: the cause in one
  or two sentences, the fix options (recommended first), Expo implementation steps, whether it needs a
  new native build or can go out as a reply/OTA, the next rejection this fix is likely to trigger, and a
  short draft reply to App Review.
- **Review notes**: the user wants the "Notes for Review" / "App access" text. Fill the template at the
  end of this file, then briefly check the claims the notes make (permission strings, background
  modes, login options, region locks) and list any gaps under the notes. Leave `[[...]]` placeholders
  for facts you don't have rather than inventing them.

## Pre-submission audit

### 1. Run the static preflight

From the Expo project root:

```bash
node <skill-dir>/scripts/preflight.mjs            # human-readable report (in a Claude Code plugin, <skill-dir> = ${CLAUDE_PLUGIN_ROOT}/skills/app-store-review-guard)
node <skill-dir>/scripts/preflight.mjs --json     # machine-readable
node <skill-dir>/scripts/preflight.mjs --config path/to/resolved-config.json
```

The script resolves the config with `npx expo config --json` when it can (this handles
`app.config.ts`), and falls back to `app.json`. It reads `package.json`, `eas.json`, the app icon, and
does a light scan of source files. It exits with code 1 when it finds blocking errors, so it can run
in CI before `eas submit`.

Treat the script as a first pass, not a verdict. It catches config-level problems; it cannot see what
a reviewer sees on the device. Read every finding, and don't repeat ones that clearly don't apply
(for example, a Stripe warning for an app that only sells physical goods).

If you can't run scripts in this environment, read `app.json`/`app.config.*`, `package.json` and
`eas.json` yourself and apply the same checks listed in `references/ios.md` and `references/android.md`.

### 2. Walk the manual checklist

The script can't judge behaviour, so ask about (or inspect code for) the items it can't see. Read the
reference for each platform the user ships to:

- `references/ios.md` — App Review Guidelines items that most often reject Expo apps, plus Apple's
  upload-time requirements (SDK/Xcode minimums, privacy manifest).
- `references/android.md` — Google Play target API level, Data safety, account deletion web link,
  closed testing for new personal accounts, sensitive permissions.

Only raise checklist items that plausibly apply to this app. A calculator app with no accounts doesn't
need an account-deletion lecture. When something depends on facts you don't have (does the app have
user-generated content? does it sell digital content?), don't stop the audit to ask: report the item
conditionally ("if Stripe unlocks digital features, …") and collect those questions in the report's
"Questions that change the verdict" section.

### 3. Report

Use this structure so the user can act on it line by line:

```markdown
# Review readiness: <app name> (<platforms>)

**Verdict:** Ready / Fix before submitting / Blocked
**Rules checked against:** <date from frontmatter> (+ anything you re-verified today)

## Blockers (will be rejected or the upload will fail)
- [Guideline / policy] What's wrong → exact fix (file + key, or screen + behaviour)

## Likely rejections (reviewer-dependent)
- ...

## Before you press submit
- [ ] Demo account / review notes ready
- [ ] ...

## Questions that change the verdict
1. <only questions whose answer moves an item between sections>

## Draft review notes
<filled template, if relevant>
```

How to sort items:

- **Blockers** and **Likely rejections** only hold problems you can see in the project files or the
  user's description. Anything that depends on a fact you don't have ("if your privacy label says no
  data is collected…") goes under "Questions that change the verdict" or "Before you press submit".
- **Verdict**: *Blocked* when an upload or review will certainly fail, *Fix before submitting* when
  there is a blocker or likely rejection you can fix, *Ready* otherwise. Manual checks that every
  release needs (privacy labels, Data safety, screenshots, a TestFlight smoke test) don't lower the
  verdict. A clean project should be called Ready.

Keep fixes concrete: name the `app.json` key, the plugin option, or the screen. "Improve your privacy"
is not a fix; `ios.infoPlist.NSCameraUsageDescription: "Scan the QR code on your charging station to
start a session"` is.

## Why the common items matter (so you can judge edge cases)

- **Permission strings** (Apple 5.1.1(ii)): reviewers reject strings that don't say *what the app does
  with the data*. Expo plugins ship generic defaults like "Allow $(PRODUCT_NAME) to access your camera",
  which are a frequent rejection. Every string should name the feature and the benefit.
- **Account deletion** (Apple 5.1.1(v), Google User Data policy): if users can create an account in the
  app, they must be able to start deleting it in the app. Google additionally requires a web link that
  works without the app installed, entered in the Data safety form.
- **Login services** (Apple 4.8): a third-party/social login for the primary account requires an
  equivalent option that limits data to name + email, lets users hide their email, and doesn't track
  for ads without consent. Sign in with Apple satisfies this; it's not the only way, but it's the
  easiest. Email/password-only apps are exempt.
- **Hidden features** (Apple 2.5.19, new Oct 2026; 2.3.1(a)): anything gated behind a remote flag, a
  region check, or an OTA update must be described in review notes and reachable by the reviewer.
  Apple now treats undisclosed dormant features as grounds for account termination, so this matters
  more for Expo apps using EAS Update and feature flags than it used to.
- **Third-party AI** (Apple 5.1.2(i)): sending personal data to an external AI provider needs clear
  disclosure and explicit permission before the data is sent. Apps calling an LLM with user content
  need a consent step, and the privacy policy must name it.
- **Reviewer access** (Apple 2.1(a)): a login-gated app without working demo credentials, or with the
  backend down, is rejected immediately. This is the single cheapest rejection to avoid.

## Review notes template

Fill in only what applies. Be specific: Apple rejects generic notes under 2.3.1(a).
Where it goes: App Store Connect → App Review Information → Notes (credentials in the sign-in fields);
Google Play → Policy → App content → App access.

Region-locked content deserves the most care: the reviewer is almost certainly not in your market, and
content they can't reach looks like a hidden feature under 2.5.19. Tell them exactly how to see it
(type an in-market address, a demo location, a preset route), and make sure that path actually works
from abroad.

```text
DEMO ACCOUNT
Email: <demo@yourapp.com>   Password: <...>
(Account is pre-loaded with sample data. 2FA is disabled for this account.)

WITHOUT AN ACCOUNT (if login is optional)
<What works signed out, and which features ask for sign-in.>

HOW TO REACH THE CORE FEATURE
1. <step>  2. <step>  3. <step>

NEW IN THIS VERSION
- <feature>: where it is and how to trigger it.

FEATURES THAT DEPEND ON LOCATION, HARDWARE OR SERVER STATE
- <e.g. "Stations are only listed in Turkey. From abroad the map near you is empty; enter
  Istanbul → Izmir as the route to see them.">

LINKS AND SHARING (if any)
- <What a shared/deep link opens with and without the app installed.>

PERMISSIONS
- Camera: <when it's requested and why; what happens if declined>
- Location: <when-in-use or background, and why>

ACCOUNT DELETION
Settings → Account → Delete account (deletes all data within <N> days).
(Google Play also needs a public web deletion URL in the Data safety form.)

PURCHASES (if any)
<What each in-app purchase unlocks; sandbox notes.>

THIRD-PARTY AI (if any)
User <text/photos> are sent to <provider> only after the user accepts the consent screen shown at <where>.
```
