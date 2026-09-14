# GitHub Copilot instructions

Read `AGENTS.md` (rules and invariants) and `README.md` (how it runs) before suggesting changes.

- Run: `npm install`, `npm run dev`. Validate: `npm run typecheck`, `npm test`, `npm run build`; screen or flow: `npm run e2e`; PowerShell: `npm run test:ps1`; CLI or skill: `npm run skills:check`.
- Server in `server/src/` (Express 5, `node:sqlite`, scheduler in `scheduler.ts`); panel in `client/src/` (React 19, Tailwind 4, Syntax Ops theme); agent CLI in `scripts/routines-cli.ts`; skill packages in `skills/`.
- A new route goes into `createProtectedRouter` (`server/src/routes.ts`), never the public router. Routine validation only in `routineSchema` + `normalizeRoutine`.
- Directories always through `checkDirectory`; run claims only through the `UPDATE` in `claimRun`; schema migration only in `db.ts`, with `PRAGMA foreign_keys = OFF` before `BEGIN`.
- Database in snake_case with `AS "field"` aliases; JSON and TypeScript in camelCase; booleans with `is`/`has`.
- Interface text in both dictionaries (`client/src/i18n.tsx`, `server/src/i18n.ts`), Portuguese and English, without em dashes as punctuation.
- The SMTP password never leaves the server: see invariant 14 in `AGENTS.md`.
