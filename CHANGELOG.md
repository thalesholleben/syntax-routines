# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Dates are those of the
commit on `main`.

## Unreleased

### Added

- **Panel in English and Portuguese**, with a discreet selector on the sign-in screen, at the bottom
  of the sidebar and in Settings. The choice is kept in the browser and in Settings; the API answers
  in the panel's language (`Accept-Language`), and run notes and alert e-mails follow Settings.
  Dictionaries are typed against each other (`client/src/i18n.tsx`, `server/src/i18n.ts`).
- Landing page for `routines.syntaxlab.com.br` under `site/` (Portuguese and English).
- Banner, screenshots with demo data (`scripts/screenshots.mjs`, `--lang en`), Open Graph images in
  Portuguese and English (`scripts/render-og.mjs`), `SUPPORT.md` and this changelog, preparing the
  repository to go public. README in English with a Brazilian Portuguese version.

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
