> **P0/P1 implemented locally:** class catalog and text decoding are in `site_p0.md`; Stats Lab, learnable skills, URL state, skill anchors/payload trim and the Command Companion are in `site_p1.md`. The cumulative deploy package is `.verify/site-p1.zip`. The findings below are the original stocktake.

> **P0 implemented locally:** the class catalog, text decoding and stats/recruits/stats-page fixes are in site_p0.md; the deploy package is .verify/site-p0.zip. The findings below are the original stocktake.

# Website ↔ bot parity stocktake

Read-only review of `/var/www/gladiuscommunity` (the `\\192.168.1.9\gladiuscommunity` share),
taken against the deployed bot at `1fccf98`. No site files were changed. Live measurements
were taken on the server against `127.0.0.1:7000` with GET requests only.

## 1. What the site is

| | |
|---|---|
| Stack | Node 21 / Express 4, server-rendered static HTML + vanilla JS in `public/` |
| Entry | `app.js`; routes in `routes/`; shared game-data helpers in `utils/gladiusData.js` |
| Game data | `/var/www/gladius-data` — the **same files the bot reads** |
| Auth | Discord OAuth (Passport), Discord admin role, modder list; content pages are public |
| Deployment | `gladiuscommunity-website.service` (plus `gladius-monitor`, `gladiusnet-relay`) |
| Versioning | **No git repository.** Changes are hand-edited; `.bak-YYYYMMDD` files sit next to `app.js` |
| Dependencies | express, passport-discord, express-session (file store), helmet, morgan, multer, archiver, winston; no tests, no scripts |

### Pages and APIs

| Page | API | Purpose |
|---|---|---|
| `/homepage` | — | Landing page, mod downloads, xDelta upload, ISO patcher, Discord login |
| `/skills` | `/skills/api/mods`, `/skills/api/mod/:mod` | Skill browser: search, class filter, alphabet/class views, combo chain, raw record, explain mode |
| `/classes` | `/classes/api`, `/classes/api/unit-data`, `/classes/api/search-gladiators` | Class cards, equipment, sets, best statset, unit detail, gladiator finder |
| `/recruits` | `/recruits/api`, `/recruits/api/unit-data` | Recruit arenas by region, statset-5 filter, unit detail |
| `/stats` | `/stats/api` | Class + level stat lookup |
| `/prizes` | `/prizes/api/names`, `/prizes/api/catalog`, `/prizes/api` | League/encounter prize lookup and catalog |
| `/itemskills` | `/itemskills/api/mod/:mod`, `/suggest`, `/shops/by-skill`, `/shops/by-item` | Item-skill browser, item compare, shop locations |
| `/modlist` | `/modlist/api` | Mods → Discord author IDs |
| `/cheats` | `/cheats/api` | Button-code cheat list |
| `/admin` | `/admin/api/*` | Metrics, xDelta management, game-data browser/downloads |
| `/relay` | `/relay/api/*` | GladiusNet relay panel (separate feature) |

The site resolves the same mod set as the bot: Vanilla, Ragnarok, LeoMod, VanillaPlus.
`resolveModPaths` prefers `data/config` for statsets/gladiators and `data/towns/leagues`
for leagues, matching the served layout.

## 2. Command parity

Status: **Full** = same capability; **Full+** = site does more; **Partial** = works but a
meaningful capability or correctness piece is missing; **None** = no graphical equivalent.

| Bot command | Site page | Status | Notes |
|---|---|---|---|
| `/skill` | `/skills` | **Full+** | Search, class filter, raw record, combo chain, links between skills. Since mode is chosen per page, explain is a toggle. Class badges are display names only. |
| `/explain` | `/skills` (explain mode) | **Partial** | The parsed explain text exists, but there is no dedicated page/URL and it is hidden behind the page's mode toggle. No class-filter label model. |
| `/classes` | `/classes` | **Partial** | Rich data (description, attributes, equipment, stat/skill/item sets, best statset, gladiators, finder) but the variant model is the old regex one, cards duplicate data, and the bot's **Learnable Skills** view has no equivalent. |
| `/recruits` | `/recruits` | **Partial** | Correctly league-only, grouped by region, with statset-5/debug and unit detail. But it only accepts base class names (`ArcherF` → 404), has no game-name labels/autocomplete, and no event/no-location state. |
| `/stats` | `/stats` | **Partial (weakest)** | Free-text class input, no class list/autocomplete, base-class only (`ArcherF` → 404), plain text result, no shareable URL or graph. |
| `/prizes` | `/prizes` | **Full+** | Name suggestions, arena filter, catalog, league/encounter sections, tiers and reward ranges. Text is UTF-8-decoded incorrectly (see §3). |
| `/itemskill` | `/itemskills` | **Full+** | Item-skill cards, item detail, class associations, item compare, shop locations by skill/item. Far beyond the bot command. |
| `/modlist` | `/modlist` | **Full (basic)** | Lists mods but prints raw Discord author IDs; the bot resolves guild display names. |
| `/cheats` | `/cheats` | **Full** | Same list. |
| `/hello` | `/homepage` | N/A | Landing page serves the purpose. |
| `/help` | — | **None** | Navigation is a menu, not a command reference. `public/scripts/commands.js` is an abandoned command-emulator front end (see §4). |
| `/add_modder` | `/modders/reload` only | **None** | No graphical add/remove; only a reload endpoint, and it is modder-gated. |
| `/updatemod` | `/xdelta`, `/upload`, `/admin` | **Partial** | Web xDelta upload and ISO patching exist, plus admin game-data browsing, but not the bot's mod-update pipeline/status. |
| `/crashreport`, `/ping` (admin) | `/admin` | **Partial** | Metrics/health exist; no crash-log download or ping equivalent. |

**Bottom line:** 7 of the 12 Gladius commands already have a useful graphical page
(skill, explain, classes, recruits, stats, prizes, itemskill) and two more are basic
(modlist, cheats). The gap is not coverage — it is **accuracy and depth**: the site is one
generation behind the bot's class model and text decoding, and stats/help are the weak spots.

## 3. Accuracy findings (P0)

### 3.1 Encoding: the site decodes cp1252 data as UTF-8

Every route uses `fs.readFile(path, 'utf8')`. Vanilla, Ragnarok and LeoMod text is cp1252;
the bot uses a strict UTF-8 decode with cp1252 fallback. The site therefore emits U+FFFD.

Measured on the live site:

| Endpoint | Bytes | Time | U+FFFD |
|---|---:|---:|---:|
| `/skills/api/mod/Vanilla?mode=explain` | 3,236,774 | 0.62 s | 0 |
| `/classes/api?mod=Vanilla` | 600,483 | 0.31 s | **12** |
| `/recruits/api?mod=Vanilla` | 20,842 | 0.10 s | **1** |
| `/prizes/api/catalog?mod=Vanilla` | 108,495 | 0.21 s | **43** |
| `/itemskills/api/mod/Vanilla` | 1,470,440 | 0.37 s | 0 |
| `/stats/api?mod=Vanilla&class=Archer&level=1` | 134 | 0.03 s | 0 |

`lookuptext_eng.txt` alone has 456 replacement characters in Vanilla and Ragnarok, 30 in
LeoMod, 0 in VanillaPlus. The visible result includes:

> “They may carry a bow, but these fierce, female warriors**�** true skills…”

This affects class descriptions, prize names, arena names and any lookup text with
apostrophes/accents. It also makes the site disagree with the bot on the same data.

**Fix:** move the bot's `readTextFile` (UTF-8 strict → cp1252 fallback) into
`utils/gladiusData.js` and use it in every route. Add a response test that rejects U+FFFD.

### 3.2 Class identity: the site still uses the old suffix regex

`utils/gladiusData.js` exports `normalizeClassVariant`, the regex the bot removed
(`F`, `Imp/Nor/Ste/Exp/A/B` stripping). Vanilla's 128 class definitions collapse to 92 bases,
with 22 merged groups. Live examples:

- `/classes/api?mod=Vanilla&class=Archer` returns **three cards**: Archer (82 gladiators),
  ArcherF (82), Eiji (1). The two Archer cards are duplicates because the route combines
  all variants' gladiators for each card.
- `/classes/api?mod=Vanilla&class=ArcherF` returns one card with **82** gladiators; the bot's
  exact ArcherF has 31.
- `/stats/api?mod=Vanilla&class=ArcherF` → **404 “Class not found”**.
- `/recruits/api?mod=Vanilla&class=ArcherF` → **404 “No gladiators found”**.
- `UndeadCasterA`/`UndeadCasterB`, Bandit A/B variants, Citizen variants and similar groups
  are all merged the same way.

The bot now uses `class_catalog.js`: exact code or `Display (Code)` label, family only for a
bare display name, and labels such as `Archer (ArcherF)`. The site needs the same model.

**Fix:** port/reuse the catalog (or a shared module) and replace `normalizeClassVariant`
matching in `classes`, `recruits` and `stats`. Class cards should be one per CREATECLASS
(or a family card with an explicit variant switcher), with the same labels the bot shows.

### 3.3 Labels and autocomplete

The site's class badges/lists are display names or base names, not the bot's
`Display (Code)` labels. Consequences:

- Skill class badges show “Archer” for Archer, ArcherF and Eiji (`buildClassUseNameMap`
  maps Eiji → Archer), so Eiji's skills look like Archer's.
- Recruit/stats inputs accept base names only; there is no class picker with labels.
- `sanitizeInput` strips non-ASCII (`ö`), so `Jötunn` becomes `Jtunn`; the display name
  “Behemoth” works, the internal code does not.

The bot's exact/family/autocomplete model is the one to mirror.

## 4. UX and technical findings (P1)

1. **Stats is a bare form.** Text input, optional level, plain output. No class list, no
   autocomplete, no level slider/graph, no URL. It is labelled “Web version of /stats” but is
   the least usable page. The bot's class autocomplete and labels are ahead of it.
2. **Classes has no Learnable Skills.** The bot's class page has a skills button; the site
   card has description/equipment/sets/gladiators but no skill list. The skills page groups
   by class, but there is no link from a class card to “skills for this class”.
3. **Class cards duplicate data.** For each merged base, every class definition gets a card
   with the combined gladiator list. The internal name distinguishes them, but the counts
   and tables are repeated.
4. **No deep links / URL state.** Mod, class, skill, level and prize selections are not in
   the URL, so users cannot share a link to a specific class, skill or stat block. The bot
   replies do not link to the site either.
5. **Large, uncompressed payloads.** The skills explain response is 3.24 MB and is not
   gzip-compressed (`Content-Length: 3236774` even with `Accept-Encoding: gzip`); itemskills
   is 1.47 MB. Every page load re-parses files server-side (no mtime cache). This is fine on
   the LAN, poor on mobile.
6. **`public/scripts/commands.js` is an abandoned command emulator.** 13.6 KB, expects
   `global-mod-select`, `run-classes`, `run-stats`, etc. and fetches `/commands/api/*`.
   No HTML includes it and no `/commands` route exists. It is the natural skeleton for a
   **Command Companion** page, or should be deleted.
7. **Modlist prints Discord IDs.** The site has a bot token and guild ID in its env but does
   not resolve author display names the way the bot does.
8. **No version control.** No `.git`, hand-edited `.bak` files. Any change programme should
   start by putting the site under git (and ideally sharing the data-layer module with the
   bot), otherwise bot/site parity will drift again.
9. **Admin/modder gaps.** No graphical `/add_modder`; `/updatemod` is only partly represented
   by xDelta/ISO flows; `/crashreport`/`/ping` are only inferable from metrics. These are
   lower priority than the user-facing data pages.
10. **Data-source parity is otherwise good.** The site and bot read the same
    `/var/www/gladius-data` tree; league path resolution and mod discovery agree. The bot's
    new league-only `/recruits` behaviour is already what the site does.

## 5. Recommended graphical representations

Ordered by user value and dependency.

### P0 — make the existing pages correct
1. **Shared text decoding** in `utils/gladiusData.js` (UTF-8 → cp1252) used by every route.
   Acceptance: no U+FFFD in classes/prizes/recruits responses; Amazon description matches
   the bot.
2. **Shared class catalog** (labels, exact/family, units, schools, stat sets, objects) used by
   `classes`, `recruits`, `stats` and the skill class badges. Acceptance: `ArcherF` works
   everywhere; ArcherF has 31 units, not 82; `Archer` is the family; labels match the bot.
3. **One class card per class code** (or a family card with a variant switcher) so duplicate
   82-unit tables disappear. Show the same `Display (Code)` label the bot uses.

### P1 — the pages users will actually live in
4. **Stats Lab** (`/stats`): class picker with bot labels, level slider 1–30, stat bars/table,
   “most common stat set” plus alternatives, URL state
   (`/stats?mod=Vanilla&class=ArcherF&level=30`). This is the biggest single UX win.
5. **Class Codex** (`/classes`): add **Learnable Skills** (skills whose `SKILLUSECLASS` matches
   the class's `SKILLUSENAME`, the same rule as the bot), link to the skill explorer filtered
   by that class, and link each unit to its set detail.
6. **Skill Explorer** (`/skills` + `/explain`): one page, searchable, class-filterable with
   labels, per-skill anchor/URL, raw/explain tabs, combo visual; lazy-load explain or split
   the endpoint (3.2 MB is too much for a page load). Add gzip and an mtime cache.
7. **Recruitment Map** (`/recruits`): class picker with labels, arena cards grouped by region,
   recruitable units, statset-5 toggle, explicit “No standard location — event/story reward”
   for Minotaur/Eiji, unit detail. URL state.
8. **Command Companion** (`/help` or `/commands`): rebuild the orphan `commands.js` into a
   real page that lists each Gladius command, its options, an example, and a link to the
   graphical page. This is the single best bridge from Discord to the site.
9. **Deep links from the bot**: once pages accept URL state, bot replies can link
   “View on the site” for skills, classes, recruits and stats. That is the cheapest way to
   make the graphical side feel like part of the bot rather than a separate site.

### P2 — polish
10. **Prizes**: keep the current lookup; add a tier table/graph, canonical display names and
    the encoding fix.
11. **Item Skills**: keep the shops/compare capability; add deep links and shareable item
    pages.
12. **Mods & Authors**: resolve Discord display names, add download/version links, link each
    mod to its data pages.
13. **Admin/modder**: graphical add/remove modder, `updatemod` status, crash-log download and
    a health/ping panel; reuse the existing admin shell.

## 6. Suggested sequencing for development

1. Put the site under git; add a smoke test that fetches each page/API and asserts no U+FFFD.
2. Land the shared text decoder and shared class catalog (P0). This fixes correctness without
   changing the visual design.
3. Rebuild `/stats` and add Learnable Skills to `/classes` (P1, highest user value).
4. Add URL state + Command Companion + bot deep links (P1, makes the two surfaces one product).
5. Split/lazy-load the skills and item-skills payloads; add gzip and a cache.
6. P2 admin/modder parity.

## Appendix — endpoint/metric quick reference

- Site root: `/var/www/gladiuscommunity`; Express port 7000 behind the web server.
- Game data: `/var/www/gladius-data/<Mod>/data/...` (same as bot).
- All content APIs are public; `/admin/api` is admin-gated, `/modders/reload` is
  modder-gated, `/relay/api` is admin/relay-gated.
- Live measurements above were taken with `curl` against `127.0.0.1:7000`; no writes.
- Site files were copied read-only to the gitignored `.verify/site/` for analysis only.


