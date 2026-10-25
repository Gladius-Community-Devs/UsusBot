# tools/verify

Replays UsusBot commands against a snapshot of the real game data and reports what
a user would actually receive. It does not talk to Discord; it fakes the interaction,
captures every payload, and validates it against Discord's limits.

The findings from the first full run are in [report.md](report.md).

## Layout

| File | Purpose |
|---|---|
| `lib.js` | fake slash/component interactions, payload capture, Discord-limit validation, command discovery |
| `data.js` | independent reader for `skills.tok`, `classdefs.tok`, `items.tok`, `prizes.tok`, lookuptext, leagues, gladiators, statsets |
| `probes/contracts.js` | declared command surface vs the code that runs it |
| `probes/conformance.js` | bot parser vs the independent reader, per mod |
| `probes/commands.js` | command matrix (happy / unknown / wrong mod / permissions) |
| `probes/components.js` | every button/select fed back through `events.js` |
| `probes/sweep.js` | every entity pushed through the command that exposes it |
| `run.js` | run one command, component or autocomplete and print the payload |
| `probe.js` | run one probe and print JSON |
| `sync.ps1` | refresh `.verify/` from the web server |

## Quick start

The repo has no `node_modules` on purpose. Locally the harness borrows a sibling
install; on the server it uses the repo's own.

```powershell
$env:NODE_PATH = 'E:\ModBot\node_modules'
$env:GLADIUS_DATA_ROOT = 'E:\UsusBot\.verify'
$env:ALLOWED_MODDERS_FILE = 'E:\UsusBot\.verify\modders.json'

pwsh tools/verify/sync.ps1            # once, or after mod data changes
node tools/verify/probe.js commands
node tools/verify/run.js --command skill --opt mod_name=Vanilla --opt skill_name=Chomp
```

`.verify/` holds game content and is git-ignored. Never commit it.

`NODE_PATH` is a local-development convenience only; the server run needs no
environment beyond the bot's own `.env`.
