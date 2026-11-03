# discord.js 14.28.0 — research and plan

Prepared 2026-11-03 against server HEAD `bfc1fe1`, approved and applied the same day.
The plan below is what shipped; the outcome is in §10.

---

## 1. Verdict

**Take it — as two small commits, plus one optional one-liner.** But take it for one
concrete reason only: `file_types`, which lets Discord itself enforce that `/updatemod`
receives an `.xdelta` instead of rejecting bad uploads after the fact.

Do **not** add `@discordjs/builders` or `@discordjs/core` to `package.json`. `builders` is
transitive and follows `discord.js` on its own; `core` is a different stack we do not use
(§3). The update is two lock entries wide, nothing else in the tree moves (§4).

---

## 2. What is actually running (server truth)

Both the local checkout and the server are on the same commit, so the usual "local
`package.json` is not the source of truth" caveat is moot this time — I checked anyway:

```
/home/bots/UsusBot/package.json   "discord.js": "^14.25.1"
package-lock.json (server, same as repo)
  node_modules/discord.js          14.27.0
  node_modules/@discordjs/builders 1.14.1      (transitive, not in package.json)
  node_modules/discord-api-types   0.38.57
  node_modules/undici              6.29.1       (via the `overrides` pin)
node_modules on disk                matches the lock (preflight is satisfied)
node:   service runs v21.2.0 (deploy/ususbot.service pins the nvm path, npm 10.2.3 bundled);
        a plain `ssh` shell resolves v20.20.2 from PATH — that is the shell default, not the
        service. `engines: node >=18`, so either is fine.
git:    server HEAD = local HEAD = bfc1fe1; server working tree has the known
        `modules/gladius/modders.json` modification + untracked `uploads/`.
```

`discord-api-types` is **already 0.38.57** and already ships `FileUploadType` and
`file_types` on the attachment-option payload
(`payloads/v10/_interactions/_applicationCommands/_chatInput/attachment.d.ts`). Nothing to
bump there.

---

## 3. What the three version numbers are

| Claim | Reality |
|---|---|
| `discord.js` 14.28.0 | Real. Published 2026-10-30, four days ago. Direct dependency. |
| `@discordjs/builders` 1.15.0 | Real, same release train. **Transitive**: `discord.js@14.28.0` requires `^1.15.0`. Comes along on its own. |
| `@discordjs/core` 2.7.0 | Real, but **not ours**. See below. |

`@discordjs/core` is the thin REST + gateway wrapper that sits *beside* `discord.js`, not
under it — discord.js 14.28.0 does not depend on it. Its 2.x line also pulls
`@discordjs/ws@^2.0.4` while discord.js is on `@discordjs/ws@^1.2.3`, so installing it would
add a second, parallel gateway implementation to `node_modules` for no gain. We use
`discord.js`; there is nothing to take here. Treat that line of the update notice as "same
monorepo release, ignore".

Context worth knowing: `14.27.0` (2026-07-15) is what we run, and `14.28.0` is the only
release since. We are 3½ months behind on the minor, not one release behind.

---

## 4. The exact lock delta (verified, not estimated)

Resolved `npm install --package-lock-only discord.js@14.28.0` in a scratch copy and diffed:

```
package.json            discord.js  ^14.25.1 -> ^14.28.0
package-lock.json       discord.js            14.27.0  -> 14.28.0
                        @discordjs/builders   1.14.1   -> 1.15.0
                        (dependency-range lines for those two entries only)
```

Nothing else moves. `discord-api-types` stays at 0.38.57, `@discordjs/rest` stays 2.6.3,
`@discordjs/ws` stays 1.2.3, `undici` 6.29.1 still satisfies 14.28.0's `^6.27.0` and our
`overrides` pin. Total churn: 11 lines added, 11 removed, in the lock.

`npm audit` is unchanged by this bump: 5 moderate, all pre-existing and unrelated to
discord.js (`showdown` → `clean-jsdoc-theme`, `minimatch` → `glob` → `shelljs`; the last two
are the unused deps already listed in AGENTS.local §10.8).

---

## 5. What we gain

### 5.1 `file_types` on attachment options — the reason to take this (real, actionable)

Discord now accepts a `file_types` list on a command's attachment option and enforces it in
the client: the upload picker filters, and a wrong file cannot be submitted. Builders 1.15.0
exposes `setFileTypes(...)` / `addFileTypes(...)` / `clearFileTypes()`, and the value is
serialised by the existing `toJSON()` (`return { ...this }`).

Today `modules/gladius/commands/updatemod.js` declares the `patch` option as a bare
attachment and then rejects the wrong extension at runtime, after the interaction has
already been deferred:

```js
// updatemod.js:138
if (!attachment.name.toLowerCase().endsWith('.xdelta') && !attachment.name.toLowerCase().endsWith('.xdelta3')) {
    this.logger.warn(`updatemod rejected for ${userId}: unsupported patch extension on ${attachment.name}.`);
    await setStatus('Attached file must end with .xdelta or .xdelta3.');
    return;
}
```

That becomes:

```js
.addAttachmentOption(option =>
    option.setName('patch')
        .setDescription('The .xdelta or .xdelta3 patch file to apply')
        .setFileTypes('.xdelta', '.xdelta3')
        .setRequired(true))
```

Keep the runtime check — it is the authority for the archive path, and `file_types` is a UI
constraint, not a security boundary. The win is that a modder cannot start a multi-minute
pipeline with the wrong file, and the rejection message stops being a dead end.

Also available and unused by us: `file_types` on file-upload *components* (modal uploads).
Not needed today; `updatemod` takes its patch on the command itself.

### 5.2 `BaseChannel#permissions` / `#appPermissions` — real feature, no current use

New: any channel resolved through an interaction's `resolved` data
(`interaction.options.getChannel(...)`) now carries the invoking member's computed
permissions and the app's computed permissions for that channel, straight from the payload.
No `guild.members.fetch` and no `permissionsFor` walk.

Caveat that decides its value for us: **it only exists on resolved channels**, not on
`interaction.channel`. And `interaction.appPermissions` / `interaction.memberPermissions`
have existed since 14.0 and cover the "can I reply/post here" question we would actually
ask. We have zero `addChannelOption` calls in the codebase, so this feature is worth exactly
nothing until we add a command that takes a channel argument. Note it, use it if that day
comes, do not invent work for it.

### 5.3 Invite target users and roles — real feature, wrong fit (for now)

`guild.invites.create()` gains `roles` (roles granted on accept) and `targetUsersFile`
(a user list, uploaded as CSV and processed as an async job with
`fetchTargetUsersJobStatus`); `Invite` gains `fetchTargetUsers` / `updateTargetUsers` /
`fetchTargetUsersJobStatus` and a `roles` collection. `Invite` and `Role` were refactored to
share a new `BaseRole`.

The only invite we have is a static URL (`config.guild_invite`) that we print in DMs. Nothing
in the bot creates or manages invites, so there is nothing to gain without a new command
("`/invite` with an auto-role" is a plausible product idea, but it is a feature request, not
a dependency update, and it needs `MANAGE_GUILD` we may not want to grant). Explicitly out
of scope here.

---

## 6. What we do not get

- **No bug fixes.** The 14.28.0 changelog's *Bug Fixes* section is empty; it is features-only.
  So there is no "urgent, something is broken" pressure — the argument for updating now is
  that staying current is cheaper than catching up, and the lock is already at 14.27.0.
- **No security fixes.** No advisory is addressed; the audit count is identical before and
  after (§4).
- **No new intents, no breaking changes, no deprecations** introduced in this release.

---

## 7. Risk register

| Risk | Assessment | Mitigation |
|---|---|---|
| `Role` → `BaseRole` refactor touches every role object | Behaviour preserved: `Role` keeps its own `_patch` fields and calls `super._patch`. We only read `member.roles.cache` membership and role names. `Role#toString` still returns `@everyone` for the guild id. | Syntax gate + `tools/verify` sweep; watch the first boot log for role-related errors. |
| `BaseChannel` constructor now sets `permissions`/`appPermissions` on every channel | Two guarded assignments; `null` for cached channels. No `in`-checks in our code depend on these names. | Nothing needed. |
| Command registration now sends `file_types` for one option | `register_slash_commands` does a full `PUT` of the guild command set. If Discord rejects the field, that `PUT` 400s, the error is logged, and the **old** command set stays live — no crash, no outage, just no new option. | Land it as its own push, after the deps push is confirmed healthy, so a registration failure has exactly one candidate cause. |
| Deploy-time `npm ci` inside preflight is fail-closed | On lock drift preflight installs into `deps-staging/` and swaps, and if the install fails it `process.exit(1)`. The unit is `Restart=always` with `StartLimitBurst=5` / 300 s, so a registry outage during the deploy window can park the unit in `failed` — and we cannot `sudo systemctl restart`. | Registry reachable from the server today (`curl` → 200). Re-check immediately before pushing. If the unit does park: push any commit — the webhook pulls and restarts without sudo. |
| Webhook reports the deploy as failed | The first boot after the push spends ~30–60 s in `npm ci` *before* `client.login`, so `is-active` reports `activating` during the webhook's 10 s poll → GitHub shows a red delivery and `update_ususbot.php` returns 500. This is cosmetic and expected on a dependency bump (it is not the unit failing; no `OnFailure` alert fires). | Expect it, verify with `journalctl`/`preflight.log` rather than the delivery status. |
| `modules/gladius/modders.json` landmine | Already modified in the server working tree; any commit touching it fails the next `git pull`. | Neither commit touches it. Check `git status --short` before each push. |
| Update churn on `docs/` | This document is new and uncommitted. | Commit it with the deps commit, or delete it after approval — owner's call. |

Unrelated observation, worth one line because it is cheap to fix while we are in here:
`ususbot.js:83` still listens to `client.on('ready')`. It works in 14.28.0 but emits a
one-time `DeprecationWarning` ("renamed to clientReady … will only emit under that name in
v15"). One-line cleanup, no behaviour change.

---

## 8. Plan

### Commit 1 — `chore(deps): move discord.js to 14.28.0`

1. `npm install --package-lock-only discord.js@14.28.0 --cache "$env:TEMP\npm-cache-ususbot"`
   (the default npm cache lives outside the sandbox and fails with `EPERM`; `--cache` into
   `%TEMP%` works, and `--package-lock-only` needs no `node_modules`, so the "no
   `node_modules` on this box" rule holds).
2. Confirm the diff is exactly the two entries in §4 — `git diff package.json package-lock.json`
   should be one line in `package.json` and 11 added / 11 removed in the lock. Anything else
   appearing means npm resolved something unexpected; stop.
3. Syntax gate over the tree:
   ```powershell
   Get-ChildItem E:\UsusBot -Recurse -Filter *.js -File |
     Where-Object { $_.FullName -notmatch 'node_modules' } |
     ForEach-Object { $o = & node --check $_.FullName 2>&1; if ($LASTEXITCODE -ne 0) { "FAIL $($_.FullName): $o" } }
   ```
4. `node tools/verify/probe.js` + the `tools/verify` sweep, per AGENTS.local §10.9.
5. `curl` the registry from the server one last time, then push `master`.
6. Verify the deploy *by hand*, not by the webhook status:
   ```powershell
   ssh aihelper@192.168.1.9 "systemctl is-active ususbot; \
     node -p \"require('/home/bots/UsusBot/node_modules/discord.js/package.json').version\"; \
     tail -5 /home/bots/UsusBot/logs/preflight.log; journalctl -u ususbot --since '-5 min' --no-pager | tail -25"
   ```
   Expect `active`, `14.28.0`, an `npm ci` line in the preflight log, and a clean boot with no
   new error signatures.

Stop here and let it run for a while before commit 2. If the version bump alone misbehaves,
the file-types change is not yet in the way.

### Commit 2 — `feat(updatemod): constrain the patch option to .xdelta/.xdelta3`

`setFileTypes('.xdelta', '.xdelta3')` on the existing attachment option, runtime check kept.
Push, then read `/home/bots/ususbot.log` for
`Successfully reloaded N application (/) commands` — that line is the proof Discord accepted
`file_types`. If it 400s instead, revert this commit and push; the dependency bump stands on
its own.

Manual check afterwards: `/updatemod` in Discord should refuse to attach a `.zip`.

### Commit 3 (optional, approved separately) — `refactor: listen for clientReady`

`client.on('ready', …)` → `client.on(Events.ClientReady, …)` in `ususbot.js:83`, killing the
deprecation warning ahead of v15.

### Not doing

- Not adding `@discordjs/builders` or `@discordjs/core` to `package.json`.
- Not touching `modules/gladius/modders.json`, the deploy hook, or the unit file.
- Not adding channel options just to use `BaseChannel#appPermissions`.
- Not adding invite management just to use §5.3.

### Rollback

`git revert` the offending commit and push; the revert restores the previous lock, preflight
detects the drift and reinstalls 14.27.0 on the next boot. There is no server-side state to
undo — nothing here writes to disk beyond `node_modules`, and the swap is atomic.

---

## 9. One question for the owner

Commit 2 changes what modders see and is the only part with a failure mode (a rejected
command registration). Ship it in the same round as the bump, or take the bump alone first and
decide on `file_types` afterwards? My recommendation: bump alone, confirm a clean boot, then
`file_types` — the two pushes are minutes apart and it keeps cause and effect separable.

**Answered:** both in one push, as three commits (`550c698`, `03a3ed4`, this document).

---

## 10. Outcome (2026-11-03)

Applied as approved and verified on the running service:

- Preflight logged the drift (`@discordjs/builders: 1.14.1 installed, 1.15.0 locked`,
  `discord.js: 14.27.0 installed, 14.28.0 locked`) and reinstalled in **10 seconds**; the boot
  was a clean `Deactivated successfully.` → `Started`, `npm ci` did not delay the webhook poll
  enough to matter this time.
- On the server: `discord.js 14.28.0`, `@discordjs/builders 1.15.0`, `@discordjs/rest 2.6.3`,
  `node tools/preflight.js --check` → 225 packages, clean.
- `Successfully reloaded 16 application (/) commands` for both guilds — so the API accepted
  `file_types` on an attachment option with non-media extensions. Confirmed by reading the
  registered command back from Discord rather than trusting the PUT:
  ```json
  {"type":11,"name":"patch","description":"The .xdelta or .xdelta3 patch file to apply",
   "required":true,"file_types":[".xdelta3",".xdelta"]}
  ```
  (Discord returns the list in its own order — not a problem, it is a set.)
- The expected `DeprecationWarning` for `ready` appeared once per boot; commit 3 is still open.
- Contracts probe reports 20 findings against the 7 stored in `.verify/contracts-result.json`.
  That is **not** a regression: the extra 13 are `/help omits /X`, and a run with this change
  reverted produces the identical 20. The stored fixture predates the `/help` rewrite
  (`bfc1fe1`). Refreshing `.verify/contracts-result.json` is open work.
