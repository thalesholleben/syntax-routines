# Contributing

Thanks for wanting to improve Syntax Routines. The project is small on purpose: three screens,
one SQLite database and a scheduler. Before proposing something big, open an issue describing
the use case.

## Running it

```powershell
npm install
npm run dev                        # API on 4090 + Vite panel on 5190
```

The same two commands work in a terminal on macOS and Linux. E-mail is set up in Settings; `.env`
is optional. Needs Node.js 24.13 or newer on Windows 10/11, macOS 13+ or Linux. Tests never call
the real Claude or Codex.

## Before opening a PR

1. `npm run typecheck`, `npm test` and `npm run build` green.
2. Changed a screen or a user flow: `npm run e2e` (Chrome installed).
3. Changed `service/*.ps1` or `scripts/*.ps1`: `npm run test:ps1` (Windows). Changed `service/*.sh`:
   `npm run test:sh` (macOS or Linux).
4. Changed the CLI (`scripts/routines-cli.ts`) or `skills/`: update `skills/*/references/cli.md`
   in both variants and run `npm run skills:check`.
5. Read [AGENTS.md](AGENTS.md): its invariants (API closed by default, `Host`/`Origin` guards,
   directories through `checkDirectory`, atomic claim, schema migration) apply to humans too. A
   sensitive change comes with the test that fails without it.
6. Interface text lives in the two dictionaries (Brazilian Portuguese and English), without em
   dashes as punctuation.

## Reporting a bug

Use the issue template. Include your system (Windows, macOS or Linux) and Node versions, what the
routine did (agent or script), and the relevant excerpt of `data/app.log` or the run log, without
secrets.

## Security

A flaw that allows running code or reading data without the panel password: follow
[SECURITY.md](SECURITY.md), do not open a public issue.
