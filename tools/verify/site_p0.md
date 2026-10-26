# P0 implementation — site class identity and text decoding

Local implementation of the P0 items from the site parity stocktake, validated
against the local copy of the site on port 7100 with the same
`/var/www/gladius-data` content the live site and bot use. The live site was not
modified.

## What changed

**1. Text decoding (`utils/gladiusData.js`)**

`readTextFile()` now decodes strict UTF-8 and falls back to `windows-1252` when
that fails. It is used by every user-facing data route: classes, recruits, stats,
skills, prizes, itemskills, modlist, and the unit-data endpoints. This removes the
U+FFFD characters that the site previously showed for Vanilla/Ragnarok/LeoMod
text (Amazon's `warriors’ true skills`, prize names, arena names).

`sanitizeInput` now keeps Unicode letters/numbers and parentheses, so
`Jötunn` survives and `Archer (ArcherF)` is not flattened to `Archer ArcherF`.

**2. Class catalog (`utils/classCatalog.js`)**

A cached, mtime-keyed view of one mod's classes, mirroring the bot's model:

- `CREATECLASS` code, `SKILLUSENAME`, display name.
- Label = `Display` when unique, `Display (Code)` when the display name is shared.
- Units with school and stat set; league `RECRUIT` names; `schools.txt`; stat sets.
- Object detection (`doesntmove` + no `ITEMCAT`).
- `resolveClassInput`: exact label, shared display family (skill-use aware), exact
  code, single display, skill use.

**3. Routes**

- `classes`: one card per CREATECLASS, exact gladiator counts, `label`, and
  exact/family filtering. The old `normalizeClassVariant` grouping is gone, so
  Archer and ArcherF no longer both show 82 gladiators. The card no longer shows
  raw stat/skill/item set IDs; equipment, attributes, all stat sets and the
  gladiator table remain. Each recruitable unit gets a small 🏟️ arena line
  cross-referenced from the league `RECRUIT` entries; a class with none shows a
  one-line note.
- `recruits`: exact/family class filter, labels, `noStandardLocation` for classes
  with units but no league `RECRUIT` lines (Minotaur), and `classLabel` on each
  unit so the page can show `Archer (ArcherF)` instead of `ARCHERF`.
- `stats`: exact/family class stats; `GET /stats/api/classes` supplies labels for
  the page datalist.
- `skills`: skill class badges use catalog labels (`Archer`, `Archer (Eiji)`),
  not the merged display map that made Eiji look like Archer.
- `prizes`, `itemskills`, `modlist`: use the decoder.

**4. Pages**

- `classes`: label in card title (no duplicate internal code), family/exact search
  (Archer → two cards; ArcherF → one; Eiji separate), visible-count status.
- `recruits`: no-standard-location message and status, class labels on unit groups.
- `stats`: usable form layout (CSS grid), dark inputs, class datalist.
- `skills`: visible/total status.
- CSS: hidden radio inputs no longer extend the page width (prizes was
  2387px wide at 1440px viewport); stats form responsive at 390px.

## Validation

| Check | Result |
|---|---|
| Classes per mod | Vanilla 128, VanillaPlus 128, Ragnarok 136, LeoMod 128 |
| Duplicate labels | 0 |
| `ArcherF` | exact card/count: 31 / 31 / 35 / 36 |
| `Archer` | 2 cards: Archer + ArcherF |
| `stats` ArcherF | 200, `Archer (ArcherF)` |
| `recruits` ArcherF | 200, `Archer (ArcherF)`, only ArcherF units |
| `recruits` Minotaur | `noStandardLocation: true` |
| Class card | no set-ID pills; recruitable units show league arena names; non-recruitable units no line; Minotaur note |
| Encoding | 0 U+FFFD in classes/prizes/recruits |
| Skills | 1,811; badges `Archer`, `Archer (Eiji)` |
| Itemskills | 55 item skills, 1,569 plain items |
| Pages | all content pages 200 |
| Layout | prizes 1440/1440; stats/classes/recruits 390px no overflow |
| Errors | no 500s after the final restart |

Screenshots: `E:/UsusBot/.verify/site-shots/` (classes exact/family/expanded,
recruits exact/family/no-location, stats desktop/mobile, skills, prizes).

## Deploy package

`E:/UsusBot/.verify/site-p0.zip` (and the expanded
`E:/UsusBot/.verify/site-p0-package/`) contains the 15 changed/new files plus a
README with copy/restart instructions. No dependency, database or config changes.

## Still P1/P2

Stats Lab (slider/graph/URL state), Learnable Skills on the class card, per-skill
URLs, skills payload reduction/gzip/cache, Command Companion page, modlist display
names, admin/modder parity.

