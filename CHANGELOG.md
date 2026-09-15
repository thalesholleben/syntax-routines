# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Dates are those of the
commit on `main`.

## Unreleased

### Added

- **Operations dashboard.** A third screen with a clickable 24-hour schedule by executor,
  next occurrence, live queue and capacity, 24-hour/7-day/30-day history, error rate,
  average duration, activity chart and failure ranking with direct access to run logs.
  Read-only aggregates include the whole period and keep skipped/canceled runs separate.

- **E-mail setup from Settings.** A dialog for Gmail (app password) or any SMTP server, the sending
  address and the recipient; saving tests the connection before writing anything. A badge shows
  Connected, Failed with the reason (wrong password, server not found, TLS, connection) or Not
  tested, and real alerts update it. The password is encrypted with Windows DPAPI and never comes
  back through the API or the CLI. `.env` keeps working, and the panel account takes precedence.
- **Panel in English and Portuguese**, with a discreet selector on the sign-in screen, at the bottom
  of the sidebar and in Settings. The choice is kept in the browser and in Settings; the API answers
  in the panel's language (`Accept-Language`), and run notes and alert e-mails follow Settings.
  Dictionaries are typed against each other (`client/src/i18n.tsx`, `server/src/i18n.ts`).
- **Search and type filter on the Routines header**: by name (accent and case insensitive) and by
  Claude Code, Codex or Script, and by working folder (shown relative to the root folder, only when
  routines use more than one), with the shown/total count and a Clear filter button.
- Landing page at [routines.syntaxlab.com.br](https://routines.syntaxlab.com.br) (Portuguese, with
  English at `/en/`); source under `site/`.
- Banner, screenshots with demo data (`scripts/screenshots.mjs`, `--lang en`), Open Graph images in
  Portuguese and English (`scripts/render-og.mjs`), `SUPPORT.md` and this changelog, preparing the
  repository to go public. README in English with a Brazilian Portuguese version.

### Changed

- Index `runs_ended` on the run end time, so the dashboard refresh reads a slice of `runs` instead
  of scanning the table (100 k runs: 53 ms to 18 ms per snapshot).
- Failure alerts that could not be sent are retried n² minutes after the failure (1, 4, 9... up to
  22.8 h) instead of three times in five minutes: an internet outage of a few hours delays the
  alert instead of losing it. The "server not found" reason now also says to check the internet.

## 0.1.0 · 2026-09-14

First version in daily use.

### Added

- Panel with password login, routine list, history and settings, in the Syntax Ops theme.
- Claude Code and Codex routines (prompt over stdin, permission bypass, model and effort),
  schedule by weekday and time, PC-off policy (skip or run at boot), retry with agent switch on
  usage limit.
- **Script** routines: one command line through `cmd.exe`, exit code decides.
- **Interval** schedule (5 min to 12 h) aligned to midnight.
- **E-mail alert** on failure, SMTP in `.env` and recipient in Settings; test button.
- 30-day retention of runs, keeping the last one of each routine.
- Installation as a logon scheduled task, without elevation, with an app-mode shortcut.
- Routine import from a JSON file (`npm run import`) and `scripts/check-backup.ps1`.
- Schema migration v1 to v2 through SQLite's official procedure.
- **CLI for agents** (`routines.cmd`): `list`, `show`, `settings`, `runs`, `log`, `add`, `edit`,
  `enable`, `disable`, `run-now` and `rm`, through the same validation path as the routes.
- **Skill** for Claude Code and Codex versioned under `skills/`, installable as a plugin or with
  `scripts/install-skill.mjs`, with the `npm run skills:check` gate in CI.
