# UsusBot functional verification — report

**Date:** 2026-10-25
**Deployed commit:** `3045b23` (server `active`, both guild command sets match the tree)
**Data verified:** a snapshot of `/var/www/gladius-data` — what the bot actually reads, for all four mods. 6,410 files, 103 MB, taken 2026-10-24 23:13 UTC. Nothing in this report comes from the repository's own `skills.tok` / `classdefs.tok`, which are not what production serves.
**Method:** replay each command against a fake Discord interaction, capture exactly what would be sent, validate it against Discord's limits, and compare the result with an independent reader of the same game files. Then feed every button/select back through the real event handler.

---

## Bottom line

The bot is live and correctly registered; the data plumbing is solid (counts, joins, statsets, recruits, pagination, permissions). The breakage is concentrated in **class identity**, **text encoding**, and **one malformed Ragnarok record**:

- **Two class bugs** make navigation fail for the majority of classes: Learnable Skills is empty for variant classes (83–93 per mod), and `/classes` rejects the class names its own autocomplete suggests (92–101 per mod).
- **Ragnarok hides "Mind Control"** because two skill records are glued together by a missing blank line.
- **Accented text is garbled** in three of four mods because the game's lookuptext is cp1252 and the bot reads UTF-8.
- **Punctuation in names** (`Song: …`, `+10`, `(50%%%%)`) makes 5–13 skills per mod unfindable even when selected from the autocomplete.

5 high, 6 medium, 11 low/informational findings. Each has a reproduction command.

**Post-fix (working tree, not deployed):** every finding with a code fix is resolved and the full sweep is green — 5,080/5,080 entity runs, 525/525 command cases, 19/19 component cases. See the post-fix status below.

---

## Resolution log — owner decisions (2026-10-25)

| # | Question | Decision | Effect |
|---|---|---|---|
| 1 | Encoding | "Do what you need to do to make sure output is proper to users." | H3 becomes an approved fix: decode per file (strict UTF-8, latin1 fallback). |
| 2 | Class identity | "Same name = same class under the hood, except Hero (costume + Valens/Ursula). Verify." | Verified and **corrected**: Hero is not the only mixed group — Eiji, Urlan and Ludo are unique characters reusing a base display name, and LeoMod adds a Channeler mix. Recommendation revised in M5. |
| 3 | Malformed data | "Handle data gracefully; there is a minimum proper form." | H4 and H1 fixes approved in principle: split records at their opener, tolerate extra lines, never depend on blank lines or counts. |
| 4 | `/module` | "Remnant from the base architecture, can probably be removed." | M4 becomes a removal item. |
| 5 | Unnamed skills | "Give me examples." | Classified below: 150 of 156 are combo-chain steps already shown by `/skill`/`/explain`; 6 are orphans. |
| 6 | `Other` / `Invalid` | "Other = any class / item skills, cross-ref items.tok. Not sure on Invalid." | Verified: 53 of 55 `Other` skills are item-granted; the two exceptions are exactly the case-typo targets. `Invalid` is 8 Summoner combo/test skills. |
| 7 | Dangling subskills | "If missing or not called, those are bugs." | Verified: **two are capitalization typos** (`Scarab RIposteSub`, `Summoner Combochain II`); one is genuinely absent (`Item PreemptiveBlindCounterSub`). |
| 8 | Ragnarok 136th class | "Verify; possible he messed up the entry." | Verified: `NUMCLASSDEFS` is stale (136 records, 135 declared). The eight added classes are structurally complete except `Druid` (no description); three have copy-paste mismatches. |
| 9 | `/help`, `/crashreport` | "Only user-usable commands. `/crashreport` does what it should — the next-newest log has the crash." | Retracted: `/crashreport` works as designed. `/help`'s scope is correct; only its dead `command.module` filter is a defect. |
| 10 | id-0 leagues | "Make them findable. Hiding data is typically bad." | M7/L5 fix: index the literal `LEAGUE`/`ENCOUNTER` names as well as lookuptext. |
| 11 | `;` references | "Remove or update to match slash commands." | L1 fix: update the `explain` hint to `/skill`. |

### Verification detail for questions 2, 5, 6, 7 and 8

**Q2 — shared display names.** Same display name *and* same `SKILLUSENAME` is a skin/variant (Samnite ×6, Bandit ×4, Secutor ×4, Undead Legionnaire ×8, Citizens, etc.). The groups that mix **different** skill-use classes are:

| Display name | Classes (skill-use) | Vanilla | VanillaPlus | LeoMod | Ragnarok |
|---|---|---|---|---|---|
| Hero | Ursula / Valens / Usus | yes | yes | yes | — (Usus is `Samnite`, below) |
| Archer | Archer / **Eiji** | yes | yes | yes | yes |
| Barbarian | Barbarian / **Urlan** | yes | yes | yes | — (Urlan displays "Heavy Barbarian") |
| Legionnaire | Legionnaire / **Ludo** | yes | yes | yes | — (Ludo displays "Legate") |
| Channeler | Channeler / **Nephilia** | — | — | yes | — |
| Legate / Dark Legate | Legionnaire / Ludo | — | — | — | yes |
| Behemoth | Galverg / Centurion | — | — | — | yes |

So "Hero is the only one" is true only in the sense that it is the only group with three distinct classes; three single characters (Eiji, Urlan, Ludo) and one LeoMod class (Nephilia) also reuse a base display name. **Consequence:** grouping `/classes` by display name would merge distinct classes; grouping by `SKILLUSENAME` would be correct for skills but hides the skin variants. Recommendation revised in M5.

**Q5 — unnamed skills (Vanilla 156).** 150 are `… ComboChain I–IV` steps referenced by a named combo skill; they are already shown inside `/skill`'s combo-chain output and used by `/explain`. The six not referenced anywhere:

```
Citizen Bait                (Citizen)
Gungnir ComboChain II       (Gungnir)
Gungnir ComboChain III      (Peltast)
Gungnir ComboChain IV       (Peltast)
Prop Campfire               (Prop)
Summoner Combochain II      (Invalid)
```

**Q6 — `Other` and `Invalid`.** 55 Vanilla skills use `SKILLUSECLASS: "Other"`; **53 are `ITEMSKILL` targets** in `items.tok` — equipment-granted skills usable by any class, matching your recollection. The two not linked are `Item BerserkOn` ("Berserk") and `Item CrowdUp` ("Crowd's Favor"), and both fail only because the items say `Item BerserkON` / `Item CrowdUP` (M1). `Invalid` is eight Summoner combo skills (`Summoner Combo I–IV`, `Summoner ComboChain I–IV`); none is item-granted or class-learnable.

**Q7 — dangling subskills.**

| Target referenced | Actually called | Verdict |
|---|---|---|
| `Scarab RiposteSub` (by `Scarab Riposte`) | `Scarab RIposteSub` | capitalization typo |
| `Summoner ComboChain II` (by `Summoner ComboChain I`) | `Summoner Combochain II` | capitalization typo |
| `Item PreemptiveBlindCounterSub` (by `Item BlindCounter`) | nothing similar | genuinely missing |

The chain lookup is case-sensitive, so the two typos silently truncate the combo. Case-insensitive resolution fixes both; the third needs data (or a guard).

**Q8 — Ragnarok's extra class.** `NUMCLASSDEFS: 135` vs 136 records: the count is stale, not a malformed class. The eight classes Ragnarok adds are complete except `Druid` (no `DESCRIPTIONID`). Three look copy-pasted:

| Class | Display | Skill-use | Problem |
|---|---|---|---|
| Valkyrie | Valkyrie (A) | `Ogregreater` | Ogre Greater skills; Legionnaire description |
| Sicarii | Sicarii | `Gwazi` | Gwazi skills; Gwazi description |
| Jötunn | **Behemoth** | `Centurion` | Centurion skills; Galverg description; display name collides |
| Druid | Druid | `BerserkerEnraged` | empty description |
| Cultist | Cultist | `Nephilia` | reuses Nephilia's skills/description |
| UndeadRogue | Undead Rogue | `UndeadMelee` | reuses Undead Melee |
| Legate / DarkLegate | Legate / Dark Legate | `Legionnaire` | reuses Legionnaire |

Also **Ragnarok's `Usus` has `SKILLUSENAME: "Samnite"`** (every other mod: `Usus`), so Ragnarok's Usus learnable list would be Samnite's skills. That looks like a bad edit in the mod, not a bot bug — worth telling the author.

---

## Post-fix status (working tree, not deployed)

The changes are applied locally on top of `3045b23`; nothing is pushed. The harness was re-run against the same four-mod snapshot afterwards.

| Finding | Status | What changed | Verification |
|---|---|---|---|
| H1 Learnable Skills empty | **fixed** | records split at `CREATECLASS:` instead of blank lines (`splitClassRecords`) | 512/512 class buttons list skills; `ArcherF` shows 43 |
| H2 `/classes` filter | **fixed** | accepts `className` or `displayName`; raw input is not sanitised | 520/520 class names resolve |
| H3 cp1252 text | **fixed** | `readTextFile`: strict UTF-8, else cp1252 (including the 0x80–0x9F table) | Amazon page reads "warriors’"; 0 lookup strings contain U+FFFD |
| H4 Ragnarok merged record | **fixed** | skills split at `SKILLCREATE:` | 1,828/1,828 blocks; "Mind Control" resolves |
| H5 punctuation names | **fixed** | lookup tries the raw name before the sanitised form | 2,236/2,236 skill names resolve, including `Song:` names |
| M1 case-sensitive item join | **fixed** | case-insensitive skill↔item matching in `itemskill` and the event handler | the 9/10/25/9 items appear under their skill |
| M2 dangling sub-skills | **partial** | case-insensitive chain index fixes `Scarab RIposteSub` and `Summoner Combochain II`; `Item PreemptiveBlindCounterSub` genuinely does not exist and the chain stops cleanly | combo chains reach the real sub-skill |
| M3 `/help` dead filter | **fixed** | dead `command.module` branch removed; `/help` still lists user-facing commands only | 12 fields, no dead code |
| M4 `/module` | **fixed** | `/module` and `/modules` deleted | command set is 15 (2 admin, 1 core, 12 gladius) |
| M5 ambiguous class titles | **fixed** | `labelClass`: `Display (Code)` when the display name is shared | `Archer (ArcherF)`, `Hero (Usus)`, plain `Amazon` |
| M6 Ragnarok class count | **data only** | parser counts records, never `NUMCLASSDEFS` | 136 parsed |
| M7 / L5 unfindable prizes | **fixed** | `/prizes` indexes literal `LEAGUE`/`ENCOUNTER` names and tries the raw input first | `Altahrun_MP` resolves; 1,016/1,016 prize lookups pass |
| L1 `;skill` hint | **fixed** | hint now uses `/skill` | — |
| L3 phantom lookup id | **fixed** | non-numeric lookup ids are skipped | 0 non-numeric keys |
| L4 unnamed skills | **classified** | no code change: 150 are combo steps shown by `/skill`/`/explain`, 6 are orphans | — |
| L6 zero-skill classes | **fixed** | Learnable Skills answers "no learnable skills" instead of an empty Page 0/0 | `Nephilia`, `Usus` |
| L11 help dead branch | **fixed** | removed with M3 | — |
| L2 orphan `level-select` handlers | open | no emitter; harmless | — |
| L7 duplicate helpers | open | `classes.js`/`explain.js` still carry local copies | — |
| L8 inert metadata | open | `has_state`, `/ping`'s `input` | — |
| L9 autocomplete re-parse | open | 24 ms per keystroke | — |
| L10 registration gate | open | no pre-registration validation | — |
| M8 variant names in `/recruits` / `/stats` | **fixed** | `class_catalog.js`: exact for a code/label, family by shared `SKILLUSENAME` for a display name | `Archer` = Archer+ArcherF, `ArcherF` exact; 153/153 recruits, 255/255 stats |
| Class input model | **fixed** | labels `Display (Code)`, autocomplete value = label, catalog-built recruit/stat lists | 75/75 offered class choices accepted; 520/520 class filters |
| Object exclusion | **fixed** | class `doesntmove` + zero `ITEMCAT` | PropBarrel/Statue/Tombstone/PracticePost excluded; no playable class matches |

**Post-fix totals:** command matrix 532/532 · components 19/19 · autocomplete 17/17 plus 75/75 offered class choices round-trip · sweep 5,080/5,080 · conformance lossless for skills/classes/items in all four mods.

Live registration still shows the old 17 commands until the next deploy; the next boot registers 15.

---

## Class identity model (verified)

The game uses three different keys for "class"; the bot has to use the right one per question.

| Concept | Key | Where it appears |
|---|---|---|
| Unit class | `CREATECLASS` (e.g. `ArcherF`) | `classdefs.tok`, `gladiators.txt` `Class:`, class pages, recruits, stats |
| Skill list | `SKILLUSENAME` (e.g. `Archer`) | `skills.tok` `SKILLUSECLASS`, `/skill` and `/explain` class filters, Learnable Skills |
| Equipment | per-class `ITEMCAT` triples | `classdefs.tok`; item styles (`weapon, Bow, Archer`) match them |

Verified against Vanilla:

- **No `SKILLUSECLASS` value is a variant class name.** The 57 distinct values are base skill-use names, plus `Other`/`Invalid` and four lowercase spellings (`bandit`, `bear`, `channeler`, `cyclops`) that the filters match case-insensitively.
- **20 of the 21 same-display/same-skillUse groups have identical `ITEMCAT`.** The exception is `UrsulaCostumeB`, which adds Valkyrie item categories. Item usability therefore usually carries over, but it is defined per class and must be read, not inferred.
- **Variants differ by attributes and unit stat sets.** Archer has 51 units across sets 31/46/50/149; ArcherF has 31 units across 31/46/50. Gender/region are the usual attribute difference.
- **Battle requirements carry with the skill list.** `SKILLPREREQ`, `SKILLWEAPONREQ` and the condition keys reference skills, weapons or statuses, not class variants. The bot displays them raw; it does not compute requirement checks yet.

**Open inconsistency (M8).** `/recruits` autocomplete offers `ArcherF`, but the execute path normalises gladiators to the base class and compares against the raw input, so `ArcherF` returns "No gladiators found"; `Archer` returns both genders. `/stats` offers only base names, rejects a typed variant, and picks one "most common" stat set across the family. Needs a decision: variant name = exact class, or family?

---

## User journey simulation (autocomplete + game names)

What a user actually sees, walking the commands as a player would (Vanilla, current working tree):

| Journey | User action | Result |
|---|---|---|
| Look up a skill | `/skill` → mod `Vanilla` → skill `Chomp` from autocomplete | works; the response says *"Skill details for 'chomp'"* (the submitted value is lowercased) |
| Female archer's skills | `/skill` → class `ArcherF` from autocomplete + an Archer skill | works after the class-map fix |
| Browse a class | `/classes` → class `ArcherF` | works; page title `Archer (ArcherF)` |
| Recruit an archer | `/recruits` → class `ArcherF` from autocomplete | **"No gladiators found"** — the offered value is rejected |
| Recruit an archer | `/recruits` → class `Archer` | works, but lists both Archer and ArcherF units |
| Stats for a variant | `/stats` → class `ArcherF` (typed) | **"No class named 'ArcherF'"**; the autocomplete only offers base names |
| Stats by display name | `/stats` → `Mongrel Shaman` (typed) | **"No class named"**; only `MongrelShaman` works |
| Skills by display name | `/skill` → class `Mongrel Shaman` | **"No skill named ... for class"**; only `MongrelShaman` works |
| Prizes | `/prizes` → `Chagatai Fire and Air` from autocomplete | works |
| Items | `/itemskill` → item name from autocomplete | works |

What the class autocompletes show today: `ArcherF`, `BearGreater`, `BeastDarkAirGreater`, `SamniteExp`, `PropBarrel` — internal `CREATECLASS` codes. What the game shows: `Archer`, `Greater Bear`, `Mongrel Shaman`, `Southern Expanse Citizen`, `Undead Legionnaire`, `Arcane Hero`. Only **83 distinct display labels** cover the 128 classes; 20 labels cover more than one class. Ten classes have no gladiator rows at all (`Boss`, `PropBarrel`-style props, costumes, `ChannelerExp`, …), so selecting them can only ever return "No gladiators".

### Input model (implemented)

1. **Autocomplete labels are game names.** `name` = `Display` when unique, `Display (Code)` when shared; `value` = the `CREATECLASS` code so the exact class survives the round trip.
2. **Every class option accepts three forms:** the code (exact class), the `Display (Code)` label (exact class), or the bare display name (all classes sharing that label).
3. **Skill commands** resolve the family to `SKILLUSENAME`, so `Archer`, `Archer (ArcherF)` and `ArcherF` all return the shared list.
4. **Recruits/stats** use the exact class for a code or label, and the family for a bare display name. Both should offer the same sorted list, and only classes that have units.
5. **Echo the display name** in responses (`Skill details for 'Chomp'`, not `'chomp'`).
6. **Sort** the class choices; today `/stats` returns them in gladiator-file order.

Implemented in `modules/gladius/class_catalog.js` (mtime-cached): classes, labels, units, league `RECRUIT` names, schools, stat sets and an object flag; `resolveClassInput` returns either exact codes or the family. Labels use the class code. Object classes (`doesntmove` + empty `ITEMCAT`) are the only exclusion; event and story units stay in the list and report "No Standard Location".

---

### Recruitment and stats cross-reference (verified)

The class lists must be derived from the data, not from suffix patterns:

- **Iaar** — Yeti, `School: 0`, `RECRUIT` line in `fjordfallen_leagues.tok` (cost 0, event flag 1). League-based event recruit.
- **Taithleach** — UndeadCasterA, `School: 0`, `RECRUIT` in `mordaresden_leagues.tok`. League-based.
- **Langston** — Minotaur, `School: 104` (The Invaders), **no** `RECRUIT` line anywhere. He is granted by a script: `gb.SchoolAddCharacter("Langston", recruitLV)` in `script/leaguemongrelsmaw.scp` (the Mongrel's Maw league reward). A league-only cross-reference would drop every Minotaur; the school field is incidental to a scripted grant.
- **Eiji** — Archer, `School: 0`, no `RECRUIT` line. Granted by the campaign (`SchoolAddCharacter("Eiji", 10)` appears commented out in the league scripts; the grant is in the gameflow scripts). A pure league/school cross-reference would drop her.

Crossref over Vanilla:

| Set | Count | Notes |
|---|---|---|
| classes with units | 118 | 10 class-defs have no units at all |
| units in a league `RECRUIT` line and in a school | 47 | e.g. Archer, Amazon |
| school-based only | 67 | e.g. Minotaur (`The Invaders`, `Krakens`, `ImperiaMonsterSchool`) |
| league-based only | 0 | — |
| units with neither | 4 classes | Eiji, Mutuus, Nephilia, ValensNoAmulet — story/unique units |
| classes with a valid stat set on every unit | 118 | 0 dangling stat-set ids |

Prop classes (`PropBarrel`, `PropStatue`, `PropTombstone`, `PropPracticePost`) have units with `School: 0` and no `RECRUIT` line, so the union excludes them. The four story classes are also excluded from the recruit list, but their units still have stat sets and remain reachable by direct `/stats`.

**Formula:** because event grants live in scripts, the recruit list is *every class with units*, not the subset with a league/school location. Object classes (attributes include `doesntmove` and zero `ITEMCAT`) are the only data-driven exclusion. Stats-capable = at least one unit whose `Stat set` exists in `statsets.txt`. `/recruits` renders league locations and school names, and says "no standard location (event/story reward)" when both are empty (Langston, Eiji). The suffix-stripping regex in `recruits.js`/`stats.js` must go: it merges `UndeadCasterA` with `UndeadCaster`, and it is why `/recruits UndeadCasterA` finds nothing.

---

## 1. Coverage

| Probe | What it exercised | Volume | Result |
|---|---|---|---|
| Contracts | every command, option, manifest, customId, help listing | 17 commands, 28 options, 8 autocomplete handlers, 14 producers / 16 consumers | see findings |
| Conformance | every file type in all four mods, bot parser vs independent parser | 4 mods, 6,410 files | 3 systemic problems |
| Command matrix | each command, realistic + adversarial inputs, all four mods | 522 cases | 491 pass / 31 fail (29 = classes filter, 2 = colon names) |
| Components | every button/select emitted by a command, fed back into `events.js` | 19 cases | 18 pass / 1 fail (the variant-class bug) |
| Entity sweep | every skill name, class, class button, league, sampled encounter/recruit/item/stat | 5,080 runs | see §2 |
| Autocomplete | every handler, every option, prefix `a` | 17 checks | 17 pass, all ≤25 choices |
| Live | registered slash commands, per guild | 2 guilds | 17/17 in both |

Entities covered by the sweep: **7,293 skills, 520 classes, 7,422 items, 891 leagues, 3,416 encounters, 9,171 gladiators, 683 stat sheets, 236 shop files** across Vanilla, VanillaPlus, LeoMod and Ragnarok.

No Discord-limit violation, no double response, and no uncaught throw occurred in any of the ~5,600 executions.

---

## 2. Findings

### HIGH

#### H1 — Learnable Skills is empty for variant classes

**Symptom.** `/classes` → page to `ArcherF` → click **Learnable Skills**. The bot replies with an empty embed: *"Learnable Skills for ArcherF", "Page 0/0"*, no fields, both paging buttons wrong. The class has 43 skills.

**Scale.** Vanilla 84 of 125 classes with skills · VanillaPlus 84/125 · LeoMod 83/126 · Ragnarok 93/136.

**Cause.** `events.js:889-893` splits `classdefs.tok` on blank lines and looks for `SKILLUSENAME`. Class blocks contain blank lines internally, so the split yields 1,581 fragments and **0 of 128** contain `SKILLUSENAME`. The handler falls back to the `CREATECLASS` name (`ArcherF`); the skills are filed under `SKILLUSENAME` (`Archer`), so nothing matches. Splitting on `CREATECLASS` instead resolves **127/128**.

**Why the two entry points disagree.** The same button built from pagination (`events.js:1273`) passes `skillUseName` and works; the one built by `/classes` (`classes.js:178`) passes `className` and fails.

**Repro.**
```
node tools/verify/run.js --component "class-skills|Vanilla|ArcherF"
node tools/verify/run.js --component "class-skills|Vanilla|Archer"
```

**Fix direction.** One record-splitting rule for `classdefs.tok` (split at `CREATECLASS:`), used by both the handler and `/classes`. This is the same change H4 needs for `skills.tok`.

#### H2 — `/classes` rejects the class names its own autocomplete offers

**Symptom.** Pick `ArcherF` (or `MongrelShaman`, `BanditA`, `UrsulaCostumeB`) from the class picker → *"No classes found matching 'archerf' in 'Vanilla'."*

**Scale.** Vanilla 92/128 · VanillaPlus 92/128 · LeoMod 92/128 · Ragnarok 101/136.

**Cause.** The autocomplete offers `CREATECLASS` names (`classes.js:37`); the filter compares only against the display name (`classes.js:152`). `ArcherF`'s display name is `Archer`; `MongrelShaman`'s is `Mongrel Shaman`.

**Repro.**
```
node tools/verify/run.js --command classes --opt mod_name=Vanilla --opt class_name=ArcherF
```

**Fix direction.** Match `className` **or** `displayName`, case-insensitively. (H5/M5 suggest the display names are not unique enough to be the only key.)

#### H3 — Latin-1 game text is decoded as UTF-8

**Facts.** `lookuptext_eng.txt` is cp1252 in Vanilla (456 non-ASCII bytes), Ragnarok (456) and LeoMod (30): it is not valid UTF-8. VanillaPlus's copy is valid UTF-8 (1,336 non-ASCII bytes). The bot reads every file as UTF-8.

**Symptom.** `/classes Vanilla` page 0 is Amazon, and its description reads *"…these fierce, female warriors� true skills…"*. Affected per mod: 12 class descriptions in Vanilla, 13 in Ragnarok, 2 item descriptions, 2 league names and 1 encounter name. LeoMod's 25 accented entries are not on class descriptions.

**Repro.**
```
node tools/verify/run.js --command classes --opt mod_name=Vanilla --opt class_name=Amazon --json
```

**Fix direction.** Decode per file: attempt strict UTF-8, fall back to latin1. A blanket latin1 decode would break VanillaPlus.

**Owner question.** Confirm the shipped text is cp1252/cp1252-compatible (the VanillaPlus copy appears to have been converted to UTF-8, which is why it renders correctly).

#### H4 — Ragnarok "Mind Control" is unfindable

**Facts.** Ragnarok's `skills.tok` declares 1,828 skills, but blank-line splitting produces 1,827 chunks. Two records are glued together by a missing blank line (and a stray `.` line):

```
SKILLCREATE: "Cultist DrainAffinity", "Innate", "Hit Cause"
...
SKILLSTATUSSITUATIONSKILLCONDITION: "skillattr ign affinity"
.
SKILLCREATE: "Cultist Charm", "Support", "One Time"
...
```

`parseSkillChunk` keeps every value, but consumers read `[0]`, so the second skill is invisible. Its display name is **"Mind Control"** (id 8411).

**Symptom.**
```
node tools/verify/run.js --command skill --opt mod_name=Ragnarok --opt skill_name="Mind Control"
→ No skill named 'Mind Control' found in 'Ragnarok'.
```

**Fix direction.** Split records at `SKILLCREATE:` rather than blank lines (also fixes H1's class split). The game data is 20+ years old and contains this shape; the parser should not depend on cosmetic blank lines.

**Owner question.** Is the missing blank line a Ragnarok authoring bug, or original data? Either way, the bot should survive it.

#### H5 — `/skill` and `/explain` cannot find names containing punctuation

**Facts.** Both commands sanitise the typed name (`[^\w\s'’-]`), removing `:`, `+`, `.`, `(`, `)`, `%`, `&`, etc., *then* look the name up. The autocomplete offers the raw names.

**Scale.** Vanilla 5 (the five `Song: …` names) · VanillaPlus 5 · LeoMod 13 (`1.5x Affinity Charge`, `Beast Defense +10`, `Counter Attack (50%%%%)`, …) · Ragnarok 10.

**Symptom.** Selecting *"Song: BattleMarch"* from autocomplete yields *"No skill named 'Song BattleMarch'"*.

**Repro.**
```
node tools/verify/run.js --command skill --opt mod_name=Vanilla --opt skill_name="Song: BattleMarch"
```

**Fix direction.** Look up the raw value first and fall back to the sanitised form (sanitising is for paths, not for lookup keys).

### MEDIUM

_M3 (the `/help` finding) was reclassified as L11 after your answer; IDs stay stable for cross-references._

#### M1 — Item grants are joined case-sensitively

`itemskill.js:209-210` compares `skill.skillName === itemSkillName` exactly. Some `ITEMSKILL` values differ only by case: `Item BerserkON` / `Item BerserkOn`, `Item CrowdUP` / `Item CrowdUp`, `item bleeding` / `Item Bleeding`. Those items never appear under their skill in **Granted by**, and never match a skill-name search.

Items affected: Vanilla 9 · LeoMod 10 · Ragnarok 25 · VanillaPlus 9. One target is genuinely absent (`Item StealAffinity`, Vanilla and VanillaPlus).

#### M2 — Dangling `SKILLSUBSKILL` targets stop combo chains silently

Two of the three are **capitalization typos**, not missing skills: `Scarab Riposte` references `Scarab RiposteSub` but the skill is `Scarab RIposteSub`; `Summoner ComboChain I` references `Summoner ComboChain II` but the skill is `Summoner Combochain II`. The lookup is case-sensitive, so both chains silently stop. The third, `Item PreemptiveBlindCounterSub` (referenced by `Item BlindCounter`), is genuinely absent.

Decision: treat all three as bugs. Case-insensitive sub-skill resolution fixes the two typos; the missing one needs data or a guard (see §5, step 1).


#### M4 — `/module` is a remnant and will be removed

`/module enable|disable` writes `enabled_module` rows via the API and reports success. The router gates commands only on `bot_module.json`'s global `enabled` flag (`module_handler.js:234`); nothing else reads the per-guild state. A user can "disable" a module and still use its commands.

Decision: remove `/module` as a leftover from the base architecture. Consequence to settle at the same time: `/modules` also reads `enabled_module` to print per-guild state; it should either be simplified to the local registry or removed too.

#### M5 — Class pages need a disambiguating label

Twenty display names are shared in Vanilla. The verification for question 2 shows the correct model:

- Same display name **and** same `SKILLUSENAME` = one class, different skins/descriptions (Samnite ×6, Bandit ×4, Secutor ×4, Undead Legionnaire ×8). Merging these is safe for skills but loses the equipment/description differences the pages exist to show.
- Same display name **and different** `SKILLUSENAME` = genuinely different classes (Hero: Ursula/Valens/Usus; Archer: Archer/Eiji; Barbarian: Barbarian/Urlan; Legionnaire: Legionnaire/Ludo; LeoMod additionally Channeler/Nephilia; Ragnarok Legate/Ludo+Legionnaire and Behemoth/Galverg+Centurion). **Do not group by display name** — it would merge distinct characters.

Recommendation: keep one page per `CREATECLASS` and append the code when the display name is shared: `Hero (Ursula)`, `Hero (Valens)`, `Hero (Usus)`, `Samnite (SamniteExp)`. That also makes H2's fix visible and keeps Ragnarok's renamed labels ("Arcane Hero", "Heavy Barbarian") readable.

#### M6 — Ragnarok's `NUMCLASSDEFS` is stale, and three added classes are copy-paste

`NUMCLASSDEFS: 135`, but the file contains 136 `CREATECLASS` records. The eight classes Ragnarok adds are complete except `Druid` (no description); `Valkyrie`/`Sicarii`/`Jötunn` carry another class's skill set and description (full table in the resolution log). Ragnarok's `Usus` also has `SKILLUSENAME: "Samnite"` where every other mod has `Usus`.

The bot must not depend on `NUM*` (it doesn't; the parser counts records). These are mod-data fixes to hand to the author — no bot change needed beyond tolerating the stale count.

#### M7 — Some prize names are unfindable

Vanilla 5 · VanillaPlus 5 · Ragnarok 4 · LeoMod 3:
- `M�rdare's Den Tournament` / `M�rdares Den League` — encoding + sanitizer (H3/H5).
- `*Scene65VB`, `Practice!` — internal names, punctuation stripped.
- One `ENCOUNTER` id resolves to a full sentence (*"Excellent work Urlan and Ursula. I'm happy to award you…"*), i.e. the encounter line points at a text id that is not a name.

Decision: make them findable. `/prizes` currently matches only through lookuptext; it should also index the literal `LEAGUE`/`ENCOUNTER` names and fall back to them, which covers id-0 leagues (L5) and these internal names in one change.

### LOW / INFO

| ID | Finding |
|---|---|
| L1 | `explain` output tells users to run `;skill <class> <name>` (`events.js:238`); the `;` form is retired. Decision: change the hint to `/skill`. |
| L2 | `level-select-1/2` are handled in `events.js:274` but no command emits them. |
| L3 | `loadLookupText` indexes a non-numeric id: the comment line `// id^speak^listen^localized text` becomes a `NaN` key (`functions.js:308`). Harmless today, but it is a phantom name in every lookup map. |
| L4 | 146–160 skills per mod have no `SKILLDISPLAYNAMEID` and cannot be found by name. Verified: 150 of 156 in Vanilla are `ComboChain I–IV` steps already shown by `/skill`/`/explain`; six are unreferenced orphans (listed in the resolution log). No search change needed; the combo path already covers them. |
| L5 | 37 league entries per mod use id 0 and resolve to no display name. Decision: make them findable by indexing the literal `LEAGUE`/`ENCOUNTER` names (same change as M7). |
| L6 | Classes with no skills at all (`Nephilia`, `Usus`) produce the same empty "Page 0/0" pager as H1, rather than a clear "this class has no skills" message. |
| L7 | Duplicate implementations: `parseSkillChunk` ×3, `parseClassChunk` ×2, `createClassEmbed` ×2, `sanitizeInput` ×6 (three different charsets), `splitMessage` copies. A fix in one does not reach the others. |
| L8 | Inert metadata: `has_state` on all 17 commands (read nowhere), `/ping`'s unused `input` option, `/help`'s unused `needs_api`. |
| L9 | Autocomplete re-reads and re-parses `skills.tok` + `lookuptext` (~1.6 MB) on every keystroke: measured **24 ms per call** on the production data. It blocks the event loop for all guilds, not just the typist. |
| L11 | `/help` filters on `command.module` (`help.js:23`), a property no command defines; the branch is dead. `/crashreport` was reported as a mismatch and is **not** one — the second-newest log is deliberate (the newest belongs to the clean reboot). |
| L10 | Nothing gates command registration. The production log shows a single invalid builder rejecting the **entire** guild command set (HTTP 50035 on `options[1]`) while the bot still logged "Slash commands registered successfully". The current 17 builders validate and both guilds have exactly 17 commands, so this is a latent risk, not a current defect. |

### Description vs behaviour

| Command | Says | Observed |
|---|---|---|
| `/skill` | finds a skill | fails for punctuation names (H5); unnamed combo steps are internal and shown through the combo path |
| `/classes` | lists/filters classes | filter fails for 92–101 suggested names (H2); shared display names need a code label (M5) |
| `/help` | "provides a list of commands" | correct scope (user-facing only, 12 commands); dead filter branch (L11) |
| `/module` | enable/disable a module | writes state nothing enforces; removal approved (M4) |
| `/crashreport` | "returns the last error in the logs" | by design — the newest log is the clean reboot; wording could say "previous log" |
| `/prizes` | prizes for an encounter/league | 3–5 names unfindable, mostly internal (M7) |
| `/ping` | "sends a message back" | replies "Admin Pong!"; admin module but no permission check |
| `/explain` | skill explanation | advertises the retired `;skill` form (L1) |
| `/recruits`, `/stats`, `/itemskill`, `/modlist`, `/add_modder`, `/cheats`, `/hello`, `/updatemod` | — | behaviour matches the declared contract in every case tested |

---

## 3. What verified clean

- **Discovery:** all four mods found by both the bot and the reference reader. No mod has a missing `skills.tok`, `lookuptext`, `items.tok`, `prizes.tok`, `gladiators.txt`, `statsets.txt`, `leagues/` or `shops/`.
- **Counts:** `NUMENTRIES` matches the parsed record count for skills, items and statsets in every mod; `NUMCLASSDEFS` matches everywhere except Ragnarok (M6).
- **Lookups:** every skill display name id resolves in `lookuptext`; every description id resolves. 499/504 (Vanilla), 492/505 (LeoMod), 695/706 (Ragnarok), 516/521 (VanillaPlus) names are findable by `/skill`.
- **Commands that are fully clean in the sampled sweep:** `/recruits` 153/153, `/stats` 255/255, `/itemskill` 138/138, prizes 999/1,016.
- **Autocomplete:** all 8 handlers answer for every declared option, always ≤25 choices, no invalid labels/values.
- **Components:** pagination works in both directions, out-of-range pages are refused with a message, the class dropdown from `/skill` switches class correctly, `explain-select` works, `itemskill` paging works, `recruits-class-select` works.
- **Permissions:** `/add_modder`, `/crashreport`, `/module`, `/modules` refuse non-admins; `/updatemod` refuses non-modders before touching anything.
- **Write path:** `/add_modder` correctly adds a modder to a copy of `allowed_modders.json` (tested against a throwaway file, never the production one).
- **Rotating mod:** `/skill Tournament` answers "That mod does not have files yet!" — correct for a tournament that comes and goes.
- **Live:** both guilds have exactly the 17 commands in the tree, including `hello`, which the older log's failed registrations could have left stale.

---

## 4. Open items

None blocking. The data quirks stay as data: Ragnarok's stale `NUMCLASSDEFS`, its three copy-paste classes, `Usus → Samnite`, and the one genuinely missing sub-skill (`Item PreemptiveBlindCounterSub`) are tolerated and documented. `/recruits` reports a class with no league or school location as an event/story reward rather than hiding it.

---
## 5. Fix plan (from your decisions)

1. **Record splitting at the opener.** Replace blank-line splitting for `skills.tok` and `classdefs.tok` with a split at `SKILLCREATE:` / `CREATECLASS:`. Fixes H1 and H4, and makes extra lines or a missing blank line harmless. Do not trust `NUM*` to equal record count.
2. **Case-insensitive sub-skill resolution.** Fixes the two capitalization typos (M2); leave the genuinely missing `Item PreemptiveBlindCounterSub` visible in the log rather than inventing it.
3. **`/classes` filter and labels.** Accept `className` or `displayName`; append the code when the display name is shared. Fixes H2 and M5 without merging distinct classes.
4. **Raw-name lookup first.** `/skill` and `/explain` try the value as typed, then the sanitised form. Fixes H5.
5. **Per-file decoding.** Strict UTF-8, latin1 fallback, applied to lookuptext (and any other text read). Fixes H3; must not break VanillaPlus's UTF-8 copy.
6. **Case-insensitive item join.** `itemskill` matches `ITEMSKILL` names case-insensitively. Fixes M1.
7. **`/prizes` literal names.** Index `LEAGUE`/`ENCOUNTER` names as well as lookuptext. Fixes M7 and L5.
8. **Remove `/module`** (and settle `/modules` per §4.1); delete the dead `command.module` filter in `/help`; change the `;skill` hint to `/skill`. Fixes M4, L11, L1.
9. **Lock it in.** One regression case per fix in `tools/verify`; rerun contracts, conformance and the full sweep; update this report's status.

---

## 6. Limitations

- **No in-Discord click test.** The registered command set was verified read-only over the REST API; every button was exercised through the real handler with a fake interaction, not by a human clicking in the guild.
- **`updatemod` end-to-end is not exercised.** It needs a real `.xdelta` patch and writes to `uploads/`; only the guard rails (deferral, permissions, extension check) were run.
- **Mod intent is unknown.** For Vanilla the corpus is an exact copy of production, but for the three mods "correct" means internally consistent and consistent with the command's contract — not "matches the pristine game".
- **Sampling.** All skill names and all classes were swept; `explain`, encounters, recruits, itemskill and stats were sampled (`SWEEP=full` runs the rest).
- **Encoding caveat.** For the three cp1252 mods, both the bot and the reference reader decode as UTF-8, so text-level assertions are consistent with each other but the *display* is wrong (H3).
- **Local library version.** The harness ran against a sibling `discord.js` 14.26.4 install (`NODE_PATH`), not the repo's lock. Payload validation and command logic are unaffected; re-run on the server before fixes are pushed.

---

## Appendix A — per-mod inventory (from the bot's own data root)

| | Vanilla | VanillaPlus | LeoMod | Ragnarok |
|---|---|---|---|---|
| skills | 1,811 | 1,826 | 1,828 | 1,828 |
| classes (`NUMCLASSDEFS` / records) | 128 / 128 | 128 / 128 | 128 / 128 | **135 / 136** |
| items | 1,852 | 1,852 | 1,854 | 1,864 |
| `LEAGUE` entries | 220 | 220 | 221 | 230 |
| `ENCOUNTER` entries | 839 | 839 | 844 | 894 |
| gladiators | 2,170 | 2,170 | 2,502 | 2,329 |
| stat sets | 169 | 169 | 177 | 168 |
| shop files | 59 | 59 | 59 | 59 |
| distinct skill names | 504 | 521 | 505 | 706 |
| class variants (`SKILLUSENAME` ≠ `CREATECLASS`) | 84 | 84 | 85 | 94 |
| classes with no skills | 2 | 2 | 1 | 0 |
| unnamed skills | 156 | 156 | 160 | 146 |
| lookup entries with accents | 221 | 221 | 25 | 221 |
| lookuptext encoding | cp1252 | UTF-8 | cp1252 | cp1252 |

## Appendix B — how to rerun

```powershell
$env:NODE_PATH = 'E:\ModBot\node_modules'        # local dev only; the repo has no node_modules
$env:GLADIUS_DATA_ROOT = 'E:\UsusBot\.verify'   # the server-data snapshot
$env:ALLOWED_MODDERS_FILE = 'E:\UsusBot\.verify\modders.json'

node tools/verify/probe.js contracts
node tools/verify/probe.js conformance
node tools/verify/probe.js commands
node tools/verify/probe.js components
node tools/verify/probe.js sweep                  # SWEEP_MODS=Vanilla limits it; SWEEP=full widens it

node tools/verify/run.js --command skill --opt mod_name=Vanilla --opt skill_name=Chomp
node tools/verify/run.js --command classes --opt mod_name=Vanilla --opt class_name=ArcherF
node tools/verify/run.js --component "class-skills|Vanilla|ArcherF"
```

`tools/verify/sync.ps1` refreshes `.verify/` from the server (read-only; it tars only `data/config`, `data/towns`, `data/units` plus the modders file). `.verify/` is git-ignored and must stay that way — it is game content.
















