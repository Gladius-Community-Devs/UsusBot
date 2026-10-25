'use strict';

/**
 * Data conformance: does the bot read the files the way the files are actually
 * shaped, and can every entity in them be reached?
 *
 * The reference side is data.js (line-based record splitting, raw values). The
 * bot side is the real modules/gladius/functions.js, run against the real data
 * directory. Disagreement means one of the two is wrong; the report shows which
 * by naming the mechanism.
 */

const fs = require('fs');
const path = require('path');
const lib = require('../lib');
const ctxlib = require('./context');

/**
 * Normalise text for whole-block comparison.
 * @param {string} text
 * @returns {string}
 */
function norm(text) {
  return String(text).replace(/\r\n/g, '\n').trim();
}

/**
 * How many of the bot's chunks are byte-identical (modulo line endings) to a
 * reference record? Anything less means the splitting strategy lost or merged
 * content.
 * @param {string[]} botChunks
 * @param {{text: string}[]} referenceBlocks
 * @param {number} [examples]
 * @returns {{matched: number, total: number, reference: number, misses: string[]}}
 */
function lossless(botChunks, referenceBlocks, examples = 3) {
  const wanted = new Set(referenceBlocks.map((block) => norm(block.text)));
  let matched = 0;
  const misses = [];
  for (const chunk of botChunks) {
    if (wanted.has(norm(chunk))) matched++;
    else if (misses.length < examples) misses.push(norm(chunk).split('\n')[0].slice(0, 90));
  }
  return { matched, total: botChunks.length, reference: referenceBlocks.length, misses };
}

/**
 * Count values that occur more than once.
 * @param {string[]} values
 * @returns {Map<string, number>}
 */
function duplicates(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return new Map([...counts].filter(([, count]) => count > 1));
}

/**
 * The class-variant normalisation recruits.js applies.
 * @param {string} className
 * @returns {string}
 */
function normalizeClass(className) {
  let base = String(className || '');
  if (/^(.+)F$/.test(base)) base = base.replace(/^(.+)F$/, '$1');
  if (/^(.+?)(?:Imp|Nor|Ste|Exp|[AB])F?$/.test(base)) base = base.replace(/^(.+?)(?:Imp|Nor|Ste|Exp|[AB])F?$/, '$1');
  if (/^(UndeadMelee)(?:Exp|Imp|Nor|Ste)[AB]F?$/.test(base)) base = base.replace(/^(UndeadMelee)(?:Exp|Imp|Nor|Ste)[AB]F?$/, '$1');
  return base;
}

/**
 * @param {object} ctx
 */
async function probeConformance(ctx) {
  const helpers = require(path.join(lib.BOT_ROOT, 'modules', 'gladius', 'functions.js'));
  const available = helpers.getAvailableMods();

  ctx.stats.conformance = {
    dataRoot: ctx.dataRoot,
    discoveredByBot: available,
    discoveredByReference: ctx.mods,
    mods: {},
  };

  const discoveredMismatch = available.length !== ctx.mods.length
    || available.some((mod) => !ctx.mods.includes(mod));
  if (discoveredMismatch) {
    ctxlib.addFinding(ctx, {
      severity: 'medium',
      area: 'conformance',
      subject: 'mod discovery disagrees between bot and reference',
      expected: 'getAvailableMods() lists every mod with skills.tok + lookuptext_eng.txt',
      actual: `bot: ${available.join(', ')} | reference: ${ctx.mods.join(', ')}`,
      evidence: 'modules/gladius/functions.js getAvailableMods',
    });
  }

  for (const mod of ctx.mods) {
    const ref = ctx.indexes.get(mod);
    const paths = helpers.getModFilePaths(mod);
    const text = (file) => (fs.existsSync(file) ? helpers.readTextFile(file) : '');

    const skillsText = text(paths.skillsFilePath);
    const classesText = text(paths.classdefsPath);
    const itemsText = text(paths.itemsFilePath);
    const gladiatorsText = text(paths.gladiatorsFilePath);
    const statsetsText = text(paths.statsetsFilePath);

    // --- bot-side parsing ---------------------------------------------------
    const botSkillChunks = helpers.splitSkillRecords(skillsText).filter((chunk) => chunk.includes('SKILLCREATE:'));
    const botSkills = botSkillChunks.map((chunk) => helpers.parseSkillChunk(chunk));
    // A chunk with two SKILLCREATE lines means the source is missing the blank
    // line between two records; every parser that keys off [0] then silently
    // drops the second skill.
    const mergedSkillChunks = botSkillChunks.filter((chunk) => (chunk.match(/^SKILLCREATE:/gm) || []).length > 1);

    const botClassChunks = helpers.splitClassRecords(classesText).filter((chunk) => chunk.includes('CREATECLASS:'));
    const botClasses = botClassChunks.map((chunk) => helpers.parseClassChunk(chunk)).filter(Boolean);
    const classBlocks = classesText.match(/CREATECLASS:[\s\S]*?(?=CREATECLASS:|$)/g) || [];
    const botBlockClasses = classBlocks.map((block) => helpers.parseClassChunk(block.trim())).filter(Boolean);

    const botItemChunks = helpers.splitItemRecords(itemsText).filter((chunk) => chunk.includes('ITEMCREATE:'));
    const botItems = botItemChunks.map((chunk) => helpers.parseChunk(chunk));

    const botGladiatorChunks = helpers.splitContentIntoChunks(gladiatorsText).filter((chunk) => /^Name:/m.test(chunk));
    const botStatsetChunks = helpers.splitContentIntoChunks(statsetsText).filter((chunk) => /^Statset\s+\d+:/m.test(chunk));

    const botLookup = helpers.loadLookupText(paths.lookupFilePath);

    // --- comparisons ---------------------------------------------------------
    const skillLoss = lossless(botSkillChunks, ref.skills.map((skill) => skill.block));
    const classLoss = lossless(botClassChunks, ref.classes.map((cls) => cls.block));
    const itemLoss = lossless(botItemChunks, ref.items.map((item) => item.block));
    const gladiatorLoss = lossless(botGladiatorChunks, ref.gladiators.map((gladiator) => gladiator.block));
    const statsetLoss = lossless(botStatsetChunks, [...ref.statsets.values()].map((set) => set.block));

    const stats = {
      counts: {
        skills: { declared: ref.declared.skills, reference: ref.skills.length, botChunks: botSkillChunks.length, botParsed: botSkills.length },
        classes: {
          declared: ref.declared.classes,
          reference: ref.classes.length,
          botRecordChunks: botClassChunks.length,
          botRecordParsed: botClasses.length,
          botBlockParsed: botBlockClasses.length,
        },
        items: { declared: ref.declared.items, reference: ref.items.length, botParsed: botItems.length },
        gladiators: { declared: ref.declared.gladiators, reference: ref.gladiators.length, botChunks: botGladiatorChunks.length },
        statsets: { declared: ref.declared.statsets, reference: ref.statsets.size, botChunks: botStatsetChunks.length },
        lookup: { ids: ref.lookup.idToText.size, botIds: Object.keys(botLookup.idToText).length, names: ref.lookup.nameToIds.size },
      },
      lossless: {
        skills: skillLoss,
        classes: classLoss,
        items: itemLoss,
        gladiators: gladiatorLoss,
        statsets: { matched: statsetLoss.matched, total: statsetLoss.total, reference: ref.statsets.size },
      },
      classMapping: {
        recordSplitSkillUseName: botClasses.filter((cls) => cls.skillUseName).length,
        blockChunkSkillUseName: botBlockClasses.filter((cls) => cls.skillUseName).length,
        referenceSkillUseName: ref.classes.filter((cls) => cls.skillUseName).length,
      },
    };

    // --- reference invariants ------------------------------------------------
    const skillNameSet = new Set(ref.skills.map((skill) => skill.name));
    const classUseNames = new Set(ref.classes.map((cls) => cls.skillUseName).filter(Boolean));
    const classUseNamesLower = new Map([...classUseNames].map((name) => [name.toLowerCase(), name]));

    const unnamedSkills = ref.skills.filter((skill) => !skill.displayId);
    const unresolvedDisplay = ref.skills.filter((skill) => skill.displayId && !ref.lookup.idToText.has(skill.displayId));
    const unresolvedDesc = ref.skills.filter((skill) => skill.descId && !ref.lookup.idToText.has(skill.descId));

    const unknownClassRefs = new Map();
    for (const skill of ref.skills) {
      for (const cls of skill.classes) {
        if (!classUseNamesLower.has(cls.toLowerCase())) {
          unknownClassRefs.set(cls, (unknownClassRefs.get(cls) || 0) + 1);
        }
      }
    }

    const subSkillTargets = new Set();
    for (const skill of ref.skills) for (const sub of skill.subSkills) subSkillTargets.add(sub);

    const unnamedOrphans = unnamedSkills.filter((skill) => !subSkillTargets.has(skill.name)).map((skill) => skill.name);

    const skillNameByLower = new Map([...skillNameSet].map((name) => [name.toLowerCase(), name]));
    const missingSubSkills = new Map();
    for (const skill of ref.skills) {
      for (const sub of skill.subSkills) {
        if (!skillNameSet.has(sub)) missingSubSkills.set(sub, (missingSubSkills.get(sub) || 0) + 1);
      }
    }

    const missingItemSkills = new Map();
    for (const item of ref.items) {
      for (const skillName of item.skills) {
        if (!skillNameSet.has(skillName)) missingItemSkills.set(skillName, (missingItemSkills.get(skillName) || 0) + 1);
      }
    }

    const classSkillCounts = new Map();
    for (const skill of ref.skills) {
      for (const cls of skill.classes) {
        const key = cls.toLowerCase();
        classSkillCounts.set(key, (classSkillCounts.get(key) || 0) + 1);
      }
    }
    const zeroSkillClasses = ref.classes.filter((cls) => cls.skillUseName && !classSkillCounts.get(cls.skillUseName.toLowerCase()));
    const variantClasses = ref.classes.filter((cls) => cls.skillUseName && cls.skillUseName !== cls.name);
    const duplicateClasses = duplicates(ref.classes.map((cls) => cls.name));
    const emptySkillUseName = ref.classes.filter((cls) => !cls.skillUseName);

    const leagueIdMisses = ref.leagues.filter((league) => !ref.lookup.idToText.has(league.id));
    const encounterIdMisses = ref.encounters.filter((encounter) => !ref.lookup.idToText.has(encounter.id));

    const statsetIds = new Set(ref.statsets.keys());
    const missingStatsets = ref.gladiators.filter((gladiator) => gladiator.statSet !== '' && !statsetIds.has(Number.parseInt(gladiator.statSet, 10)));
    const gladiatorBaseClasses = new Map();
    for (const gladiator of ref.gladiators) {
      const base = normalizeClass(gladiator.class);
      gladiatorBaseClasses.set(base, (gladiatorBaseClasses.get(base) || 0) + 1);
    }
    // A gladiator's Class is the CREATECLASS name; some classes exist only as a
    // skill-use name. Accept either, at the raw value or after the variant
    // suffix is stripped, before calling one unknown.
    const classNameSet = new Set(ref.classes.map((cls) => cls.name));
    const classNameLower = new Map([...classNameSet].map((name) => [name.toLowerCase(), name]));
    const gladiatorClassNames = new Set(ref.gladiators.map((gladiator) => gladiator.class).filter(Boolean));
    const unknownGladiatorClasses = [...gladiatorClassNames].filter((name) => {
      const base = normalizeClass(name);
      return !classNameLower.has(name.toLowerCase())
        && !classUseNamesLower.has(name.toLowerCase())
        && !classNameLower.has(base.toLowerCase())
        && !classUseNamesLower.has(base.toLowerCase());
    });

    const skillNameLower = new Map([...skillNameSet].map((name) => [name.toLowerCase(), name]));
    const itemSkillCaseOnly = [];
    const itemSkillMissing = [];
    for (const [target, count] of missingItemSkills) {
      if (skillNameLower.has(target.toLowerCase())) itemSkillCaseOnly.push([target, count, skillNameLower.get(target.toLowerCase())]);
      else itemSkillMissing.push([target, count]);
    }

    const SENTINEL_CLASSES = new Set(['other', 'invalid']);
    const subSkillCaseMatches = new Map();
    for (const target of missingSubSkills.keys()) {
      const match = skillNameByLower.get(target.toLowerCase());
      if (match) subSkillCaseMatches.set(target, match);
    }

    const itemSkillTargets = new Set();
    for (const item of ref.items) for (const target of item.skills) itemSkillTargets.add(target);
    const sentinelDetail = {};
    for (const sentinel of ['Other', 'Invalid']) {
      const rows = ref.skills.filter((skill) => skill.classes.some((cls) => cls.toLowerCase() === sentinel.toLowerCase()));
      sentinelDetail[sentinel] = {
        skills: rows.length,
        itemGranted: rows.filter((skill) => itemSkillTargets.has(skill.name)).length,
        notItemGranted: rows.filter((skill) => !itemSkillTargets.has(skill.name)).map((skill) => skill.name),
      };
    }

    const sentinelClassRefs = [...unknownClassRefs].filter(([cls]) => SENTINEL_CLASSES.has(cls.toLowerCase()));
    const realUnknownClassRefs = [...unknownClassRefs].filter(([cls]) => !SENTINEL_CLASSES.has(cls.toLowerCase()));

    const leagueIdZero = leagueIdMisses.filter((league) => league.id === 0);
    const leagueIdOther = leagueIdMisses.filter((league) => league.id !== 0);

    const botLookupKeys = Object.keys(botLookup.idToText);
    const nonNumericLookupKeys = botLookupKeys.filter((key) => !/^\d+$/.test(key));

    const displayNames = new Map();
    for (const skill of ref.skills) {
      if (!skill.displayId) continue;
      const name = ref.lookup.idToText.get(skill.displayId);
      if (!name) continue;
      if (!displayNames.has(name)) displayNames.set(name, []);
      displayNames.get(name).push(skill);
    }
    const sharedNames = [...displayNames.entries()].filter(([, skills]) => skills.length > 1).sort((a, b) => b[1].length - a[1].length);

    const classDisplayNames = new Map();
    for (const cls of ref.classes) {
      const label = ref.lookup.idToText.get(cls.displayId) || cls.name;
      classDisplayNames.set(label, (classDisplayNames.get(label) || 0) + 1);
    }
    const duplicateClassDisplayNames = [...classDisplayNames.entries()].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]);

    // Same display name but a different SKILLUSENAME means a distinct class, not
    // a skin: those must never be merged.
    const byDisplayName = new Map();
    for (const cls of ref.classes) {
      const display = ref.lookup.idToText.get(cls.displayId) || cls.name;
      if (!byDisplayName.has(display)) byDisplayName.set(display, []);
      byDisplayName.get(display).push(cls);
    }
    const mixedDisplayGroups = [...byDisplayName.entries()]
      .filter(([, members]) => new Set(members.map((cls) => cls.skillUseName)).size > 1)
      .map(([display, members]) => ({
        display,
        classes: members.map((cls) => `${cls.name} (${cls.skillUseName})`),
      }));

    // Which files are not valid UTF-8? The bot reads every file as UTF-8.
    const decode = new TextDecoder('utf-8', { fatal: true });
    const encodings = {};
    const encodingFiles = {
      skills: paths.skillsFilePath,
      classes: paths.classdefsPath,
      items: paths.itemsFilePath,
      lookup: paths.lookupFilePath,
    };
    for (const [label, file] of Object.entries(encodingFiles)) {
      if (!fs.existsSync(file)) continue;
      const buffer = fs.readFileSync(file);
      let highBytes = 0;
      for (const byte of buffer) if (byte >= 0x80) highBytes += 1;
      if (!highBytes) continue;
      let validUtf8 = true;
      try { decode.decode(buffer); } catch (error) { validUtf8 = false; }
      encodings[label] = { highBytes, validUtf8 };
    }

    stats.invariants = {
      skills: {
        withDisplayId: ref.skills.length - unnamedSkills.length,
        withoutDisplayId: unnamedSkills.length,
        unresolvedDisplayIds: unresolvedDisplay.length,
        unresolvedDescriptionIds: unresolvedDesc.length,
        mergedChunks: mergedSkillChunks.length,
        mergedChunkExamples: mergedSkillChunks.slice(0, 3).map((chunk) => (chunk.match(/^SKILLCREATE:\s*"([^"]+)"/gm) || []).join(' + ')),
        unknownClassRefs: realUnknownClassRefs,
        sentinelClassRefs,
        missingSubSkillTargets: [...missingSubSkills.keys()].filter((target) => !subSkillCaseMatches.has(target)),
        subSkillCaseTypos: [...subSkillCaseMatches],
        unnamedReferenced: unnamedSkills.length - unnamedOrphans.length,
        unnamedOrphans,
        sentinels: sentinelDetail,
      },
      classes: {
        total: ref.classes.length,
        withSkillUseName: ref.classes.length - emptySkillUseName.length,
        variants: variantClasses.length,
        zeroSkill: zeroSkillClasses.length,
        zeroSkillExamples: zeroSkillClasses.slice(0, 5).map((cls) => cls.name),
        duplicateNames: [...duplicateClasses],
        duplicateDisplayNameCount: duplicateClassDisplayNames.length,
        duplicateDisplayNames: duplicateClassDisplayNames.slice(0, 10).map(([name, count]) => `${name} x${count}`),
        mixedDisplayGroups,
        emptySkillUseName: emptySkillUseName.map((cls) => cls.name),
      },
      encoding: encodings,
      items: {
        total: ref.items.length,
        grantingSkills: ref.items.filter((item) => item.skills.length > 0).length,
        missingSkillTargets: itemSkillMissing,
        caseOnlySkillTargets: itemSkillCaseOnly,
      },
      leagues: {
        total: ref.leagues.length,
        encounters: ref.encounters.length,
        unresolvedIds: leagueIdMisses.length,
        unresolvedIdZero: leagueIdZero.length,
        unresolvedOtherIds: leagueIdOther.length,
        unresolvedExamples: leagueIdOther.slice(0, 5).map((league) => `${league.name} (id ${league.id})`),
      },
      encounters: {
        total: ref.encounters.length,
        unresolvedIds: encounterIdMisses.length,
      },
      gladiators: {
        total: ref.gladiators.length,
        baseClasses: gladiatorBaseClasses.size,
        missingStatsets: missingStatsets.length,
        unknownBaseClasses: unknownGladiatorClasses,
      },
      lookup: {
        botNonNumericKeys: nonNumericLookupKeys,
      },
      names: {
        distinctDisplayNames: displayNames.size,
        sharedNames: sharedNames.length,
        largestShared: sharedNames.slice(0, 3).map(([name, skills]) => `${name} (${skills.length})`),
      },
    };

    ctx.stats.conformance.mods[mod] = stats;

    // --- findings ------------------------------------------------------------
    const sample = (list, n = 4) => list.slice(0, n).join(', ');

    if (stats.counts.skills.reference !== stats.counts.skills.declared || stats.counts.skills.declared === undefined) {
      ctxlib.addFinding(ctx, {
        severity: 'medium',
        area: 'conformance',
        subject: `${mod}: skills count disagrees with NUMENTRIES`,
        expected: `${stats.counts.skills.declared} declared`,
        actual: `${stats.counts.skills.reference} records parsed by reference`,
        evidence: paths.skillsFilePath,
      });
    }
    if (stats.counts.classes.reference !== stats.counts.classes.declared) {
      ctxlib.addFinding(ctx, {
        severity: 'medium',
        area: 'conformance',
        subject: `${mod}: classes count disagrees with NUMCLASSDEFS`,
        expected: `${stats.counts.classes.declared} declared`,
        actual: `${stats.counts.classes.reference} CREATECLASS records`,
        evidence: paths.classdefsPath,
        note: 'may be a deliberately uncounted class; needs owner classification',
        ownerQuestion: `Is the extra class in ${mod}/classdefs.tok intentional?`,
      });
    }
    if (stats.counts.items.reference !== stats.counts.items.declared) {
      ctxlib.addFinding(ctx, {
        severity: 'medium',
        area: 'conformance',
        subject: `${mod}: items count disagrees with NUMENTRIES`,
        expected: `${stats.counts.items.declared} declared`,
        actual: `${stats.counts.items.reference} records`,
        evidence: paths.itemsFilePath,
      });
    }

    if (botSkillChunks.length !== ref.skills.length || skillLoss.misses.length > 0) {
      ctxlib.addFinding(ctx, {
        severity: 'high',
        area: 'conformance',
        subject: `${mod}: skill records are merged by blank-line splitting`,
        expected: `${ref.skills.length} skill records, each parsed whole`,
        actual: `${botSkillChunks.length} chunks; ${mergedSkillChunks.length} chunk(s) contain two SKILLCREATE lines`,
        evidence: paths.skillsFilePath,
        repro: 'helpers.splitContentIntoChunks(skills.tok) then parseSkillChunk',
        note: `a missing blank line between records glues two skills together; every consumer reads [0] and silently drops the second. Examples: ${sample(mergedSkillChunks.map((chunk) => (chunk.match(/^SKILLCREATE:\s*"([^"]+)"/gm) || []).join(' + ')), 3)}`,
      });
    }

    if (classLoss.matched !== classLoss.total || classLoss.matched !== ref.classes.length) {
      ctxlib.addFinding(ctx, {
        severity: 'high',
        area: 'conformance',
        subject: `${mod}: blank-line chunking destroys class blocks`,
        expected: 'every CREATECLASS block parsed whole',
        actual: `${classLoss.matched}/${ref.classes.length} chunks identical to the source block; SKILLUSENAME resolved in ${stats.classMapping.recordSplitSkillUseName}/${ref.classes.length}`,
        evidence: paths.classdefsPath,
        repro: 'helpers.splitContentIntoChunks(classdefs) then parseClassChunk',
        note: `block splitting resolves ${stats.classMapping.blockChunkSkillUseName}/${ref.classes.length}`,
      });
    }

    if (itemLoss.matched !== itemLoss.total || itemLoss.matched !== ref.items.length) {
      ctxlib.addFinding(ctx, {
        severity: 'high',
        area: 'conformance',
        subject: `${mod}: blank-line chunking loses item content`,
        expected: 'every item block parsed whole',
        actual: `${itemLoss.matched}/${ref.items.length} chunks identical to the source block`,
        evidence: paths.itemsFilePath,
        note: `examples: ${sample(itemLoss.misses)}`,
      });
    }

    if (gladiatorLoss.matched !== gladiatorLoss.total) {
      ctxlib.addFinding(ctx, {
        severity: 'medium',
        area: 'conformance',
        subject: `${mod}: blank-line chunking loses gladiator content`,
        expected: 'every gladiator block parsed whole',
        actual: `${gladiatorLoss.matched}/${ref.gladiators.length}`,
        evidence: paths.gladiatorsFilePath,
      });
    }

    if (unnamedSkills.length) {
      ctxlib.addFinding(ctx, {
        severity: 'info',
        area: 'conformance',
        subject: `${mod}: ${unnamedSkills.length} skills have no SKILLDISPLAYNAMEID`,
        expected: 'every skill can be named by /skill',
        actual: `${unnamedSkills.length - unnamedOrphans.length} are combo-chain steps shown by /skill and /explain; ${unnamedOrphans.length} are unreferenced (${sample(unnamedOrphans, 6)})`,
        evidence: paths.skillsFilePath,
        note: 'combo steps do not need a display name; the orphans may be unused data',
      });
    }

    if (unresolvedDisplay.length) {
      ctxlib.addFinding(ctx, {
        severity: 'high',
        area: 'conformance',
        subject: `${mod}: ${unresolvedDisplay.length} SKILLDISPLAYNAMEID values are missing from lookuptext`,
        expected: 'every display-name id resolves',
        actual: sample(unresolvedDisplay.map((skill) => `${skill.name} (id ${skill.displayId})`)),
        evidence: `${paths.skillsFilePath} vs ${paths.lookupFilePath}`,
      });
    }

    if (realUnknownClassRefs.length) {
      ctxlib.addFinding(ctx, {
        severity: 'high',
        area: 'conformance',
        subject: `${mod}: ${realUnknownClassRefs.length} SKILLUSECLASS values match no class definition`,
        expected: 'every skill class resolves to a class name or SKILLUSENAME',
        actual: sample(realUnknownClassRefs.map(([cls, count]) => `${cls} (${count})`), 6),
        evidence: paths.skillsFilePath,
      });
    }
    if (sentinelClassRefs.length) {
      ctxlib.addFinding(ctx, {
        severity: 'info',
        area: 'conformance',
        subject: `${mod}: skills assigned to sentinel classes`,
        expected: 'player skills name a real class',
        actual: Object.entries(sentinelDetail).map(([cls, detail]) => `${cls}: ${detail.skills} skill(s), ${detail.itemGranted} item-granted`).join('; '),
        evidence: paths.skillsFilePath,
        note: 'Other = equipment-granted skills usable by any class; Invalid = Summoner combo/test skills',
      });
    }

    if (subSkillCaseMatches.size) {
      ctxlib.addFinding(ctx, {
        severity: 'info',
        area: 'conformance',
        subject: `${mod}: ${subSkillCaseMatches.size} SKILLSUBSKILL targets differ only by case`,
        expected: 'combo chains resolve case-insensitively',
        actual: sample([...subSkillCaseMatches].map(([target, real]) => `${target} -> ${real}`), 6),
        evidence: paths.skillsFilePath,
        note: 'the bot resolves these case-insensitively',
      });
    }
    const trulyMissingSubSkills = [...missingSubSkills.keys()].filter((target) => !subSkillCaseMatches.has(target));
    if (trulyMissingSubSkills.length) {
      ctxlib.addFinding(ctx, {
        severity: 'medium',
        area: 'conformance',
        subject: `${mod}: ${trulyMissingSubSkills.length} SKILLSUBSKILL target(s) absent`,
        expected: 'combo chains reference real skills',
        actual: sample(trulyMissingSubSkills, 6),
        evidence: paths.skillsFilePath,
        note: 'the bot stops the chain silently when a target is missing',
      });
    }

    if (itemSkillCaseOnly.length) {
      ctxlib.addFinding(ctx, {
        severity: 'info',
        area: 'conformance',
        subject: `${mod}: ${itemSkillCaseOnly.length} ITEMSKILL targets differ from the skill only by case`,
        expected: 'item grants resolve to their skill',
        actual: sample(itemSkillCaseOnly.map(([target, count, skill]) => `${target} -> ${skill} (${count} item(s))`), 6),
        evidence: paths.itemsFilePath,
        note: 'the bot joins these case-insensitively; kept as a data note',
      });
    }
    if (itemSkillMissing.length) {
      ctxlib.addFinding(ctx, {
        severity: 'info',
        area: 'conformance',
        subject: `${mod}: ${itemSkillMissing.length} ITEMSKILL targets do not exist at all`,
        expected: 'item-granted skills reference real skills',
        actual: sample(itemSkillMissing.map(([target, count]) => `${target} (${count})`), 6),
        evidence: paths.itemsFilePath,
        ownerQuestion: 'Is a dangling ITEMSKILL normal in the shipped data, or a mod typo?',
      });
    }

    if (zeroSkillClasses.length) {
      ctxlib.addFinding(ctx, {
        severity: 'info',
        area: 'conformance',
        subject: `${mod}: ${zeroSkillClasses.length} classes have no skills`,
        expected: 'a class either has learnable skills or is a non-player class',
        actual: sample(zeroSkillClasses.map((cls) => cls.name), 8),
        evidence: paths.skillsFilePath,
        ownerQuestion: 'Are these classes expected to have no skills (props, tests, monsters)?',
      });
    }

    if (duplicateClasses.size) {
      ctxlib.addFinding(ctx, {
        severity: 'medium',
        area: 'conformance',
        subject: `${mod}: duplicate CREATECLASS names`,
        expected: 'one definition per class',
        actual: sample([...duplicateClasses.keys()]),
        evidence: paths.classdefsPath,
      });
    }

    if (duplicateClassDisplayNames.length) {
      ctxlib.addFinding(ctx, {
        severity: 'info',
        area: 'conformance',
        subject: `${mod}: ${duplicateClassDisplayNames.length} class display names are shared`,
        expected: 'each class page is distinguishable by its title',
        actual: sample(duplicateClassDisplayNames.map(([name, count]) => `${name} x${count}`), 8),
        evidence: paths.classdefsPath,
        note: 'same display + same SKILLUSENAME = skins; different SKILLUSENAME = distinct classes that must not be merged',
      });
    }

    if (mixedDisplayGroups.length) {
      ctxlib.addFinding(ctx, {
        severity: 'info',
        area: 'conformance',
        subject: `${mod}: ${mixedDisplayGroups.length} display names cover distinct classes`,
        expected: 'a display name identifies one class',
        actual: sample(mixedDisplayGroups.map((group) => `${group.display}: ${group.classes.join(' / ')}`), 6),
        evidence: paths.classdefsPath,
        note: 'these must not be merged by display name; label them with the CREATECLASS code',
      });
    }

    // The files may be cp1252, but the bot must decode them without loss.
    const replacementStrings = Object.values(botLookup.idToText).filter((value) => value.includes('\uFFFD'));
    if (replacementStrings.length) {
      ctxlib.addFinding(ctx, {
        severity: 'high',
        area: 'conformance',
        subject: `${mod}: ${replacementStrings.length} lookup strings decode to U+FFFD`,
        expected: 'cp1252 text is decoded to readable characters',
        actual: sample(replacementStrings, 4),
        evidence: paths.lookupFilePath,
        note: 'readTextFile should fall back to cp1252 for these files',
      });
    }

    if (missingStatsets.length) {
      ctxlib.addFinding(ctx, {
        severity: 'high',
        area: 'conformance',
        subject: `${mod}: ${missingStatsets.length} gladiators reference a missing stat set`,
        expected: 'every Stat set id exists in statsets.txt',
        actual: sample(missingStatsets.map((g) => `${g.name} (set ${g.statSet})`), 6),
        evidence: `${paths.gladiatorsFilePath} vs ${paths.statsetsFilePath}`,
      });
    }

    if (unknownGladiatorClasses.length) {
      ctxlib.addFinding(ctx, {
        severity: 'medium',
        area: 'conformance',
        subject: `${mod}: ${unknownGladiatorClasses.length} gladiator classes normalise to no class`,
        expected: 'every gladiator class maps to a class definition',
        actual: sample(unknownGladiatorClasses, 8),
        evidence: paths.gladiatorsFilePath,
      });
    }

    if (leagueIdOther.length) {
      ctxlib.addFinding(ctx, {
        severity: 'medium',
        area: 'conformance',
        subject: `${mod}: ${leagueIdOther.length} LEAGUE ids are absent from lookuptext`,
        expected: 'every league id resolves to a display name',
        actual: sample(leagueIdOther.map((league) => `${league.name} (id ${league.id})`), 5),
        evidence: paths.leaguesPath,
      });
    }
    if (leagueIdZero.length) {
      ctxlib.addFinding(ctx, {
        severity: 'info',
        area: 'conformance',
        subject: `${mod}: ${leagueIdZero.length} LEAGUE entries use id 0`,
        expected: 'a league the UI can name',
        actual: sample(leagueIdZero.map((league) => league.name), 5),
        evidence: paths.leaguesPath,
        ownerQuestion: 'Are id-0 leagues internal MP/test entries that should never be findable by name?',
      });
    }
    if (nonNumericLookupKeys.length) {
      ctxlib.addFinding(ctx, {
        severity: 'low',
        area: 'conformance',
        subject: `${mod}: lookuptext parser keeps non-numeric ids`,
        expected: 'only numeric entry ids are indexed',
        actual: `${nonNumericLookupKeys.length} key(s): ${nonNumericLookupKeys.join(', ')}`,
        evidence: paths.lookupFilePath,
        note: 'loadLookupText does parseInt(line) without checking; header/comment lines become an id',
      });
    }
  }
}

module.exports = { probeConformance };







