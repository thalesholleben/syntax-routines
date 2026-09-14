# Security

## Threat model in three lines

1. The app runs **on the PC of whoever installs it**, listens only on `127.0.0.1` and is protected
   by **one password** (scrypt), with `Host` and `Origin` guards on the whole API and an
   `HttpOnly` + `SameSite=Strict` cookie.
2. Whoever has the panel password launches **Claude Code and Codex with full access**
   (`--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`) and
   **arbitrary commands** on the PC, limited to the root folder set in Settings. The panel is an
   execution surface by design: treat the password like your Windows password and do not expose
   the port on the network. The CLI (`routines.cmd`) and the import write straight to
   `data/app.db`, with no password: whoever can read and write the app folder has the same power
   the password gives.
3. The app's only secret (the SMTP for e-mail alerts) lives in `.env`, outside git and outside the
   database; the recipient lives in the database. Run logs live in `data/logs/` and may contain
   whatever the agents and scripts print.

Out of scope: multiple users, remote access, isolation between routines (they all run as the
Windows user) and protection against whoever already has access to the Windows account.

## Supported versions

There is no release line yet. Security fixes target the latest `main`.

## Reporting a vulnerability

Write to **contato@syntaxlab.com.br** with the subject "Syntax Routines: security", describing
the problem, how to reproduce it and the impact. Reply within 5 business days. Please do not open
a public issue for flaws that allow running code or reading data without the panel password.

In scope: bypassing authentication or the `Host`/`Origin` guards, running outside the root
folder, leaking `.env` or the password through the API or the logs, and anything that makes the
app accept a request from another origin or another machine.
