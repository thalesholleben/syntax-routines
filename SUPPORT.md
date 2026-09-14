# Support

Syntax Routines is maintained by SyntaxLab in the time left over from client work. There is no
response deadline and no SLA; there is goodwill and an open repository.

## Before asking

- The panel does not open: check `data\app.log` in the app folder and confirm the
  `SyntaxRoutines` task exists (`Get-ScheduledTask SyntaxRoutines`). Reinstalling with
  `.\service\install.ps1` fixes most cases.
- A routine failed: the alert e-mail carries the error, and "Ver saída" in the panel (or
  `routines.cmd log <id>`) shows the full log of that run.
- An agent routine stopped with "limite de uso": that is the Claude Code or Codex quota, not the
  app. Turn on "Trocar de agente automaticamente" in the routine or wait for the reset.
- The app does not run at night: it needs your user signed in to Windows. A locked screen is
  fine; a PC that is off, or nobody signed in, is not.

## Where to ask

- **Bug or usage question:** open an [issue](https://github.com/thalesholleben/syntax-routines/issues)
  with the template. Include the Windows and Node versions, the routine kind and the relevant
  excerpt of the log, without secrets.
- **Feature idea:** an issue too, describing the use case before the solution.
- **Vulnerability:** do not open a public issue. Follow [SECURITY.md](SECURITY.md).

Pull requests are welcome; read [CONTRIBUTING.md](CONTRIBUTING.md) first.
