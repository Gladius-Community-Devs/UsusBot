# P1/P2 implementation — Stats Lab, learnable skills, deep links, command page

Local continuation of the site work after P0. Validated on the local site copy on
port 7100 with the same `/var/www/gladius-data` content the bot uses. The live
site was not modified.

## P1

**Stats Lab (`/stats`)**
- Class picker with catalog labels; level 1–30 slider; five stat cards with bars.
- Most-common stat set plus a collapsible table of the alternatives used by the
  class (units using it, level-30 average, stats).
- Copy-link button; URL state (`/stats?mod=Vanilla&class=Archer%20(ArcherF)&level=30`).
- Slider changes the displayed level and the URL without another request.
- API: `/stats/api` now returns `byLevel` always and an `alternatives` array.

**Classes**
- Expanded class cards load **Learnable Skills** from a new
  `/classes/api/learnable-skills?mod=&class=` endpoint (matches `SKILLUSECLASS`
  against the class `SKILLUSENAME`), with links into Skill Explorer and an
  “open all” link.
- URL state (`/classes?mod=Vanilla&class=ArcherF`).
- (P0) equipment, attributes, stat-set comparison, recruit arenas; no set-ID pills.

**Skills / Explain**
- URL state for mod, search, mode and sort:
  `/skills?mod=Vanilla&q=Air%20Affinity%20Attack%201&mode=skill`.
- Per-skill `#` anchors and `:target` highlight, so a card can be linked.
- Removed the unused `skillData` object from responses: payload **3.24 MB → 1.59 MB**.
- mtime cache and gzip: **109 KB** over the wire for the full Vanilla payload.
- Visible-count status.

**Recruits**
- URL state (`/recruits?mod=Vanilla&class=ArcherF&statset5=1`), labels and
  no-standard-location state from P0.

**Command Companion (`/commands`)**
- Searchable page listing all 11 user-facing commands, examples, and the page that
  does the same job; linked from the homepage. Removed the stale WIP tags.

## Rate limit fix

The global limiter was 100 requests / 15 minutes for every request, including CSS/JS, which is only ~20 page views for a whole NAT and is easy to exhaust while testing. The local build now skips static assets, defaults to 600/15 min (`RATE_LIMIT_MAX` overrides), and bypasses the limiter when `NODE_ENV=development` or `DISABLE_RATE_LIMIT=1`. A local 120-request run returned 200 for all 120.

## Traffic attribution caveat

Apache's `gladiuscommunity.conf` writes to the generic `access.log`, which is
shared with budaslounge, courtney and vaultofeternals; `gladius-access.log` is
empty. The whole-server logs show ~306k requests and 6,643 429s, but those are
not Gladius traffic.

Isolated to Gladius-specific paths in the current+rotated `access.log`:
~13.4k requests, 166 429s, 20 of them on content pages, across 27 IPs. The
app-level `metrics.json` (Gladius only) has 88,333 requests since March
(~382/day, 1,195/day over the last 30 days), but only 2,887 HTML page views in
the last 30 days (~96/day), 6,248 visitor fingerprints (includes bots) and 20
Discord users. Content paths in Apache show ~1,055 requests over 29 days from
378 IPs: 237 single-request IPs, 103 with 2–5, 34 with 6–20, 3 with 21–100 and
one with 100+.

Conclusion: the site did not blow up. It is a small community plus bots and
scanners. The 100/15 global limit was still too low because it counted assets;
600/15 with assets skipped is reasonable, and a dedicated vhost log should be
added if traffic/429s need to be attributed reliably.
## P2

- **Mod list** resolves Discord display names through the bot token/guild, with
  the author ID as fallback.
- **Prizes / item skills / item compare**: `?mod=&name=`, `?mod=&q=` and
  repeated `?compare=` state; URLs update as the user works.
- **Admin**: Discord-role-gated modder add/remove against the shared
  `ALLOWED_MODDERS_FILE` (same-origin, write-limited, validated, atomic 0644
  write, immediate reload) plus read-only service/host health.
- **Stats Lab**: optional class comparison, level-progression chart, best-stat
  emphasis, copy link; all URL-backed.
- **Cheats**: category cards, search, copy-to-clipboard, `?q=`.
- **Lazy Explain**: per-skill endpoint used by a card button; the full explain
  mode remains while the engine is WIP.
- **Observability**: global 429s are counted in metrics and shown with HTML
  share in admin.
- **Data**: bot and site point at `/var/www/gladius-data`; site path resolution
  now prefers the bot's `data/units` and `data/towns/leagues` files. Local
  sample data removed.
- **UI**: WIP tags restored for Classes/Stats/Cheats; Command Companion removed.

## Validation

| Check | Result |
|---|---|
| Stats deep link | class ArcherF, level 30, 5 cards, 3 alternatives |
| Slider | level 30 → 15 changes cards and URL `level=15`; PWR 86 → 44 |
| Learnable skills | ArcherF → 42 distinct skills (43 records, duplicate `Cover Area` deduped) |
| Skills deep link | `q=Air Affinity Attack 1` → 30 cards; 30 anchors |
| Skills payload | 1,588,926 B raw / 109,023 B gzip |
| Recruits deep link | `Showing 2 recruits for Archer (ArcherF) in Vanilla.` |
| Mobile 390px | all pages scrollWidth = innerWidth (no horizontal overflow) |
| CSP | no inline-style violations on stats/classes/commands |
| Pages | homepage, skills, classes, recruits, stats, prizes, itemskills, modlist, cheats = 200; /commands = 404 |
| Errors | no 500s after the final restart |
| Rate limit | 120 local requests all 200; assets skipped; default 600/15 min |

Screenshots: `E:/UsusBot/.verify/site-shots/` —
`stats-lab-archerf-30.png`, `stats-lab-mobile.png`, `classes-learnable-skills.png`,
`skills-deep-link.png`, `commands-page.png`, `recruits-deep-link.png`.

## Package

`E:/UsusBot/.verify/site-p1.zip` (expanded: `site-p1-package/`) is the cumulative
P0+P1 patch (20 files) and supersedes `site-p0.zip`. Copy over the live site,
back it up first, restart `gladiuscommunity-website.service`. No dependency,
config or database changes.

## Live deployment (2026-10-26)

- Backup: `/var/backups/gladiuscommunity-20261026-135236` (app.js, routes, public, utils, middleware, config, package files, data; Apache config).
- Site package deployed to `/var/www/gladiuscommunity` and `gladiuscommunity-website.service` restarted.
- Apache vhost now has its own logs:
  - `CustomLog ${APACHE_LOG_DIR}/gladiuscommunity-access.log combined`
  - `ErrorLog ${APACHE_LOG_DIR}/gladiuscommunity-error.log`
  - `apache2ctl configtest` passed; Apache reloaded gracefully.
- Live smoke tests: `/homepage`, `/commands`, `/classes`, `/recruits`, `/stats` = 200; `ArcherF` class/stats/recruits return the new labels; skills gzip = 109 KB.
- Rate limit: 110 consecutive homepage requests → **110 × 200**, no 429.
- Utilization after deploy: load ~2.2 (Minecraft dominates), 21 GiB / 59 GiB RAM used, disk 37%, site node ~103 MB RSS, ~12.9% CPU during startup.

## Repository and auto-deploy

- Repo: `Gladius-Community-Devs/gladiuscommunitywebsite`, branch `main` (private).
- Local dev checkout: `E:\code_stuff\gladiuscommunitywebsite` — npm ci,
  `.env` against `E:\UsusBot\.verify`, port 7101, `node tools/smoke.js`.
- Server checkout: `/var/www/gladiuscommunity`, owned `www-data`, deploy key
  `/var/www/.ssh/gladius_deploy` (read-only GitHub deploy key).
- Webhook: `https://budaslounge.com/automation/update_gladiuscommunitywebsite.php`;
  verifies HMAC, `git pull --ff-only` as `www-data`, restarts
  `gladiuscommunity-website`, returns 200 only when active.
- Sudoers: `/etc/sudoers.d/gladiuscommunity-deploy` allows `www-data` to restart
  exactly that unit.
- Verified: initial push, docs push, P2 push and receiver-source push all
  delivered `200`, pulled, restarted, homepage 200.

**P2 completed**: prizes `?mod=&name=` and item skills `?mod=&q=` deep links
(with URL updates), mod-list author names, dedicated Gladius Apache log, rate
limit at 600 with assets skipped, bot→site links (`14afcab`).

## What remains

1. **Admin/modder parity remaining**: web `updatemod` status/upload parity and a
   bot crash-log view; modder add/remove and read-only health are done.
2. **Unify the class catalog code**: both apps read one data root now, but each
   still has its own parser.
3. **Traffic observability remaining**: 429s and HTML share are in admin metrics;
   an external log view/alert or fail2ban is still open.
4. **Optional polish**: broader accessibility audit and more mobile QA.

**Bot work unrelated to the site**

- The bot is deployed at `14afcab`; site docs commits are local only and were not
  pushed (a docs-only push would restart the bot).
- Tournament remains empty by design.
- Data quirks (Ragnarok `NUMCLASSDEFS`, copy-paste classes, `Usus → Samnite`,
  missing sub-skill) stay documented as data, not code changes.


