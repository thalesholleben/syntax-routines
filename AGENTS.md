# AGENTS.md

Instructions for agents changing Syntax Routines. Read `README.md` first. The panel speaks
Brazilian Portuguese and English; the CLI output and the agent skill are in Portuguese on purpose.

## Official commands

| Command | When |
| --- | --- |
| `npm run typecheck` | every code change |
| `npm test` | every code change (vitest; uses only temporary folders) |
| `npm run build` | before delivering and before the e2e |
| `npm run e2e` | screen or user-flow change (installed Chrome, fake agent, real script) |
| `npm run test:ps1` | change in `service/` or `scripts/*.ps1` (real processes, no admin) |
| `npm run skills:check` | change in the CLI (`scripts/routines-cli.ts`) or in `skills/` |

None of these commands touches `data/`, calls the real Claude or Codex, or sends e-mail.

## Invariants (do not break)

1. **Independence from Syntax Ops (command-center).** No shared import, package, API or database.
   Reusing from there is by copying the file.
2. **API closed by default.** Public routes are only `GET /api/auth/state`, `POST /api/auth/setup`
   and `POST /api/auth/login`. In `server/src/app.ts`, `requireAuth` is mounted before the protected
   router; a new route goes into `createProtectedRouter` (`server/src/routes.ts`), never the public one.
3. **Host and Origin guards** on every `/api` request (`server/src/auth.ts`). Do not relax them and do
   not add CORS.
4. **Directories always through `checkDirectory`** (`server/src/directories.ts`): real path +
   `path.relative`, when saving and again at dispatch. Never `startsWith`.
5. **Atomic claim.** `claimRun` (`server/src/scheduler.ts`) carries both queue rules inside the
   `UPDATE` itself: one `RUNNING` run per routine and the `max_parallel` cap.
6. **One run per scheduled occurrence:** the `runs_schedule_once` index (`server/src/db.ts`) +
   `INSERT OR IGNORE`.
7. **Single instance:** `startServer` (`server/src/server.ts`) listens on the port before
   `recoverOnBoot` and before the scheduler.
8. **Execution identical to the Syntax Ops worker:** `buildArgs` in `server/src/runner.ts` (permission
   bypass, prompt over stdin) and `buildChildEnv` clearing `CLAUDECODE*`. Script (`runScript`) uses the
   same `execute`: stdin closed, `windowsHide`, timeout with `taskkill /t`, no retry and no `LimitTracker`.
9. **Names:** database in snake_case with `AS "field"` aliases on reads; JSON and TypeScript in
   camelCase; booleans with `is`/`has`.
10. **Every interface string lives in the two dictionaries**, `client/src/i18n.tsx` (panel) and
    `server/src/i18n.ts` (API messages, run notes, e-mail), in Portuguese and English; `en` is typed
    against `pt`, so a missing translation does not compile. No hard-coded text in components or
    routes. The API language comes from `Accept-Language` (`req.language`); run notes and e-mail come
    from `settings.language`. Portuguese is the default everywhere, so the CLI and the older tests
    keep reading Portuguese. No em dashes as punctuation in either language.
11. **One validation path for routines:** `routineSchema` + `normalizeRoutine` in
    `server/src/routes.ts`. Import and CLI go through `prepareRoutine` (`scripts/routine-input.ts`),
    which calls both; do not duplicate a rule, and the CLI takes the accepted field list from
    `routineSchema.shape`, never from a hand-written copy.
12. **Schema migration only through a `migrateV1ToV2`-like function in `server/src/db.ts`:**
    `PRAGMA foreign_keys = OFF` **before** `BEGIN` (inside a transaction it is a no-op and the cascade
    deletes `runs`), an empty `foreign_key_check` before `COMMIT`, version in `meta.schema_version`.
    Test in `db.test.ts` with the literal old schema.
13. **The CLI has no business rules.** `scripts/routines-cli.ts` only formats: validation, directory,
    writes and queue come from the server (`prepareRoutine`, `createRoutine`, `updateRoutine`,
    `deleteRoutine`, `enqueueManualRun`). A manual run enters through `enqueueManualRun`
    (`server/src/routines.ts`), the same function behind the panel button; dispatching stays with the
    scheduler. A new CLI command also goes into `skills/*/references/cli.md`, or `npm run skills:check`
    fails.
14. **E-mail is best-effort and never blocks the queue:** the `notifyFailures` pass runs after dispatch,
    only for `FAILED` runs of the last 24 h, retrying n² minutes after the failure (1, 4, 9... up to
    22.8 h, `NOTIFY_MAX_ATTEMPTS`) so an internet outage of hours delays the alert instead of losing
    it. The sending account comes from Settings
    (`PUT /api/settings/mail`, tested with `verify()` before anything is written) or, without one, from
    `.env` (`process.loadEnvFile` in `index.ts`). The SMTP password saved from the panel exists only
    encrypted with DPAPI (`server/src/secret-store.ts`, key `smtp_pass_dpapi`) and never leaves the
    server: `describeMail` in `server/src/mailer.ts` is the only view the API and the CLI expose, and
    `app.test.ts`, `routines-cli.test.ts` and the e2e assert that neither the password nor the blob shows
    up. The e2e clears `SMTP_*` from the test server's environment and configures e-mail through the
    dialog against `e2e/fake-smtp.mjs`.

## Where to change what

| Topic | File |
| --- | --- |
| Occurrence rules, interval and PC-off policy | `server/src/schedule.ts` |
| Queue, retry, fallback, cancel, e-mail alert, retention | `server/src/scheduler.ts` (+ `retention.ts`, `notifier.ts`, `mailer.ts`) |
| Database migration | `server/src/db.ts` |
| Routes and validation (zod) | `server/src/routes.ts` |
| Theme and visual utilities | `client/src/index.css`, registry in `docs/css-namespaces.md` |
| Panel and server text, language selector | `client/src/i18n.tsx`, `server/src/i18n.ts`, `client/src/components/LanguageSwitch.tsx` |
| Routine dialog | `client/src/components/RoutineModal.tsx` |
| E-mail account, badge and DPAPI | `server/src/mailer.ts`, `server/src/secret-store.ts`, `client/src/components/MailSettingsCard.tsx` |
| Windows installation | `service/install.ps1`, `service/uninstall.ps1` |
| Agent CLI and skill packages | `scripts/routines-cli.ts`, `skills/` (gate: `scripts/check-skills.mjs`) |
| README images and Open Graph | `scripts/screenshots.mjs`, `scripts/render-og.mjs`, `docs/assets/` |

## Sensitive changes

Touched authentication, guards, scheduler, claim or directories: write the failing test first and
run the whole suite. The tests in `server/src/scheduler.test.ts` and `server/src/app.test.ts` are the
proof of those rules; do not loosen an assertion to get green.
