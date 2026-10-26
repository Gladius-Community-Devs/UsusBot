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

## P2 (started)

- **Mod list** resolves Discord display names through the bot token/guild, with
  the author ID as fallback. The local copy uses a dummy token, so it shows the
  fallback; production will show names.

Still open: prizes/item-skill URL state, admin/modder parity (`add_modder`,
`updatemod`, crash/ping), and optional bot→site deep links.

## Validation

| Check | Result |
|---|---|
| Stats deep link | class ArcherF, level 30, 5 cards, 3 alternatives |
| Slider | level 30 → 15 changes cards and URL `level=15`; PWR 86 → 44 |
| Learnable skills | ArcherF → 42 distinct skills (43 records, duplicate `Cover Area` deduped) |
| Skills deep link | `q=Air Affinity Attack 1` → 30 cards; 30 anchors |
| Skills payload | 1,588,926 B raw / 109,023 B gzip |
| Commands page | 11 command cards; search “recruits” → 1 |
| Recruits deep link | `Showing 2 recruits for Archer (ArcherF) in Vanilla.` |
| Mobile 390px | all pages scrollWidth = innerWidth (no horizontal overflow) |
| CSP | no inline-style violations on stats/classes/commands |
| Pages | homepage, commands, skills, classes, recruits, stats, prizes, itemskills, modlist, cheats = 200 |
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

