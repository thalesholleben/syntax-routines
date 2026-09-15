# Security

## Threat model in three lines

1. The app runs **on the PC of whoever installs it**, listens only on `127.0.0.1` and is protected
   by **one password** (scrypt), with `Host` and `Origin` guards on the whole API and an
   `HttpOnly` + `SameSite=Strict` cookie.
2. Whoever has the panel password launches **Claude Code and Codex with full access**
   (`--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`) and
   **arbitrary commands** on the PC, limited to the root folder set in Settings. The panel is an
   execution surface by design: treat the password like the password of your computer account and
   do not expose the port on the network. The CLI (`routines.cmd`, `routines.sh`) and the import write straight to
   `data/app.db`, with no password: whoever can read and write the app folder has the same power
   the password gives.
3. The app's only secret is the SMTP password for e-mail alerts. Saved from Settings, it goes to
   the vault of the system before it reaches `data/app.db`: Windows DPAPI (the database keeps the
   encrypted text itself), the macOS Keychain or the Linux Secret Service (the database keeps only a
   reference). A copy of the database on another machine or under another user does not reveal it;
   whoever already runs code as your user can open it, the same boundary as `.env`. The secret always
   travels over stdin between the app and the vault, never in a command line. The API, the CLI and
   the logs never return it, not even encrypted. It can also live in `.env`, outside git. The
   recipient lives in the database. Run logs live in `data/logs/` and may contain whatever the
   agents and scripts print.

Out of scope: multiple users, remote access, isolation between routines (they all run as the
logged-in user) and protection against whoever already has access to that account.

## Supported versions

There is no release line yet. Security fixes target the latest `main`.

## Reporting a vulnerability

Write to **contato@syntaxlab.com.br** with the subject "Syntax Routines: security", describing
the problem, how to reproduce it and the impact. Reply within 5 business days. Please do not open
a public issue for flaws that allow running code or reading data without the panel password.

In scope: bypassing authentication or the `Host`/`Origin` guards, running outside the root
folder, leaking `.env`, the panel password or the SMTP password through the API, the CLI or the
logs, and anything that makes the
app accept a request from another origin or another machine.
