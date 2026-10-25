'use strict';

/**
 * Sweep: every entity in the reference data is pushed through the command that
 * claims to expose it. This is the coverage measurement, not a curated list.
 *
 * Set SWEEP=full to include every encounter and every explain lookup; the
 * default samples the expensive ones so a run stays within a few minutes.
 */

const lib = require('../lib');
const ctxlib = require('./context');

const SKILL_SANITIZER = (value) => value.replace(/[^\w\s''-]/g, '').trim();

/**
 * Record one failure by category, keeping a few examples.
 * @param {object} bucket
 * @param {string} category
 * @param {string} example
 */
function tally(bucket, category, example) {
  bucket.failed += 1;
  if (!bucket.categories[category]) bucket.categories[category] = { count: 0, examples: [] };
  const entry = bucket.categories[category];
  entry.count += 1;
  if (entry.examples.length < 6) entry.examples.push(example);
}

/**
 * @param {object} ctx
 */
async function probeSweep(ctx) {
  const full = process.env.SWEEP === 'full';
  ctx.stats.sweep = {
    mode: full ? 'full' : 'sampled',
    mods: {},
    autocomplete: { checked: 0, failures: [] },
    totalRuns: 0,
  };

  // -------------------------------------------------------------------------
  // Autocomplete
  // -------------------------------------------------------------------------
  const AUTOCOMPLETE = {
    skill: ['mod_name', 'skill_name', 'class_name'],
    explain: ['mod_name', 'skill_name', 'class_name'],
    itemskill: ['mod_name', 'search'],
    prizes: ['mod_name', 'encounter_name'],
    stats: ['class_name', 'mod_name'],
    classes: ['mod_name', 'class_name'],
    recruits: ['mod_name', 'class_name'],
    updatemod: ['mod_name'],
  };

  for (const [command, options] of Object.entries(AUTOCOMPLETE)) {
    for (const option of options) {
      const other = option === 'mod_name' ? {} : { mod_name: 'Vanilla' };
      const out = await ctxlib.autocomplete(ctx, command, option, 'a', other);
      ctx.stats.sweep.autocomplete.checked += 1;
      ctx.stats.sweep.totalRuns += 1;
      const problems = [];
      if (out.thrown) problems.push(`threw: ${out.thrown.message || out.thrown}`);
      if (!Array.isArray(out.choices)) problems.push('responded with no choice array');
      else {
        if (out.choices.length > 25) problems.push(`${out.choices.length} choices (max 25)`);
        for (const choice of out.choices) {
          if (!choice || !choice.name || !choice.value) problems.push('choice missing name/value');
          else if (String(choice.name).length > 100 || String(choice.value).length > 100) problems.push('choice over 100 chars');
        }
      }
      if (problems.length) {
        ctx.stats.sweep.autocomplete.failures.push({ command, option, problems, durationMs: out.durationMs });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Per mod
  // -------------------------------------------------------------------------
  for (const mod of (process.env.SWEEP_MODS ? ctx.mods.filter((name) => process.env.SWEEP_MODS.split(',').includes(name)) : ctx.mods)) {
    const index = ctx.indexes.get(mod);
    const bucket = {
      skills: { checked: 0, passed: 0, failed: 0, categories: {} },
      explain: { checked: 0, passed: 0, failed: 0, categories: {} },
      classFilter: { checked: 0, passed: 0, failed: 0, categories: {} },
      classLearnable: { checked: 0, passed: 0, failed: 0, skippedNoSkills: 0, categories: {} },
      prizes: { checked: 0, passed: 0, failed: 0, categories: {} },
      recruits: { checked: 0, passed: 0, failed: 0, categories: {} },
      itemskill: { checked: 0, passed: 0, failed: 0, categories: {} },
      stats: { checked: 0, passed: 0, failed: 0, categories: {} },
    };

    const skillUseNames = new Map(index.classes.filter((cls) => cls.skillUseName).map((cls) => [cls.skillUseName.toLowerCase(), cls.skillUseName]));
    const skillsByUse = new Map();
    for (const skill of index.skills) {
      for (const cls of skill.classes) {
        const key = cls.toLowerCase();
        skillsByUse.set(key, (skillsByUse.get(key) || 0) + 1);
      }
    }

    // --- every skill display name through /skill ---------------------------
    const names = [...new Set(index.skills
      .filter((skill) => skill.displayId && index.lookup.idToText.has(skill.displayId))
      .map((skill) => index.lookup.idToText.get(skill.displayId)))].sort();

    for (const name of names) {
      bucket.skills.checked += 1;
      ctx.stats.sweep.totalRuns += 1;
      const out = await ctxlib.run(ctx, 'skill', { values: { mod_name: { type: 3, value: mod }, skill_name: { type: 3, value: name } } });
      if (out.thrown) {
        tally(bucket.skills, 'threw', `${name}: ${out.thrown.message}`);
        continue;
      }
      if (out.problems.length) {
        tally(bucket.skills, 'payload-limit', `${name}: ${out.problems[0]}`);
        continue;
      }
      if (out.payloads.length === 0) {
        tally(bucket.skills, 'no-response', name);
        continue;
      }
      if (/No skill named/i.test(out.text)) {
        const sanitized = SKILL_SANITIZER(name);
        tally(bucket.skills, sanitized.toLowerCase() === name.toLowerCase() ? 'not-found' : 'sanitizer-changes-name', name);
        continue;
      }
      bucket.skills.passed += 1;
    }

    // --- explain, sampled ---------------------------------------------------
    for (const name of ctxlib.sample(names, 40, 29)) {
      bucket.explain.checked += 1;
      ctx.stats.sweep.totalRuns += 1;
      const out = await ctxlib.run(ctx, 'explain', { values: { mod_name: { type: 3, value: mod }, skill_name: { type: 3, value: name } } });
      if (out.thrown) {
        tally(bucket.explain, 'threw', `${name}: ${out.thrown.message}`);
        continue;
      }
      if (out.problems.length) {
        tally(bucket.explain, 'payload-limit', `${name}: ${out.problems[0]}`);
        continue;
      }
      if (/No skill named/i.test(out.text)) {
        const sanitized = SKILL_SANITIZER(name);
        tally(bucket.explain, sanitized.toLowerCase() === name.toLowerCase() ? 'not-found' : 'sanitizer-changes-name', name);
        continue;
      }
      bucket.explain.passed += 1;
    }

    // --- every class name through /classes --------------------------------
    for (const cls of index.classes) {
      bucket.classFilter.checked += 1;
      ctx.stats.sweep.totalRuns += 1;
      const out = await ctxlib.run(ctx, 'classes', { values: { mod_name: { type: 3, value: mod }, class_name: { type: 3, value: cls.name } } });
      if (out.thrown) {
        tally(bucket.classFilter, 'threw', `${cls.name}: ${out.thrown.message}`);
        continue;
      }
      if (!out.payloads.some((entry) => (entry.payload.embeds || []).length)) {
        tally(bucket.classFilter, /No classes found/i.test(out.text) ? 'display-name-mismatch' : 'no-embed', cls.name);
        continue;
      }
      bucket.classFilter.passed += 1;
    }

    // --- every class through the Learnable Skills button ------------------
    for (const cls of index.classes) {
      const expected = cls.skillUseName ? (skillsByUse.get(cls.skillUseName.toLowerCase()) || 0) : 0;
      if (expected === 0) {
        bucket.classLearnable.skippedNoSkills += 1;
        continue;
      }
      bucket.classLearnable.checked += 1;
      ctx.stats.sweep.totalRuns += 1;
      const out = await ctxlib.component(ctx, `class-skills|${mod}|${encodeURIComponent(cls.name)}`, []);
      if (out.thrown) {
        tally(bucket.classLearnable, 'threw', `${cls.name}: ${out.thrown.message}`);
        continue;
      }
      if (out.problems.length) {
        tally(bucket.classLearnable, 'payload-limit', `${cls.name}: ${out.problems[0]}`);
        continue;
      }
      const fields = out.payloads.flatMap((entry) => (entry.payload.embeds || []).flatMap((embed) => embed.fields || []));
      if (fields.length === 0) {
        tally(bucket.classLearnable, 'no-skills-shown', `${cls.name} (expected ${expected})`);
        continue;
      }
      bucket.classLearnable.passed += 1;
    }

    // --- prizes -------------------------------------------------------------
    const leagueNames = [...new Set(index.leagues
      .filter((league) => index.lookup.idToText.has(league.id))
      .map((league) => index.lookup.idToText.get(league.id)))];
    const encounterNames = [...new Set(index.encounters
      .filter((encounter) => index.lookup.idToText.has(encounter.id))
      .map((encounter) => index.lookup.idToText.get(encounter.id)))];

    const prizeTargets = leagueNames.concat(full ? encounterNames : ctxlib.sample(encounterNames, 60, 23));
    for (const label of prizeTargets) {
      bucket.prizes.checked += 1;
      ctx.stats.sweep.totalRuns += 1;
      const out = await ctxlib.run(ctx, 'prizes', { values: { mod_name: { type: 3, value: mod }, encounter_name: { type: 3, value: label } } });
      if (out.thrown) {
        tally(bucket.prizes, 'threw', `${label}: ${out.thrown.message}`);
        continue;
      }
      if (out.problems.length) {
        tally(bucket.prizes, 'payload-limit', `${label}: ${out.problems[0]}`);
        continue;
      }
      if (/No encounter or league/i.test(out.text)) {
        tally(bucket.prizes, 'not-found', label);
        continue;
      }
      bucket.prizes.passed += 1;
    }

    // --- recruits -----------------------------------------------------------
    const baseClasses = [...new Set(index.gladiators.map((gladiator) => {
      let base = gladiator.class;
      if (/^(.+)F$/.test(base)) base = base.replace(/^(.+)F$/, '$1');
      if (/^(.+?)(?:Imp|Nor|Ste|Exp|[AB])F?$/.test(base)) base = base.replace(/^(.+?)(?:Imp|Nor|Ste|Exp|[AB])F?$/, '$1');
      if (/^(UndeadMelee)(?:Exp|Imp|Nor|Ste)[AB]F?$/.test(base)) base = base.replace(/^(UndeadMelee)(?:Exp|Imp|Nor|Ste)[AB]F?$/, '$1');
      return base;
    }).filter(Boolean))];
    for (const className of ctxlib.sample(baseClasses, 30, 7)) {
      bucket.recruits.checked += 1;
      ctx.stats.sweep.totalRuns += 1;
      const out = await ctxlib.run(ctx, 'recruits', { values: { mod_name: { type: 3, value: mod }, class_name: { type: 3, value: className } } });
      if (out.thrown) {
        tally(bucket.recruits, 'threw', `${className}: ${out.thrown.message}`);
        continue;
      }
      if (out.problems.length) {
        tally(bucket.recruits, 'payload-limit', `${className}: ${out.problems[0]}`);
        continue;
      }
      if (/No gladiators found/i.test(out.text)) {
        tally(bucket.recruits, 'not-found', className);
        continue;
      }
      bucket.recruits.passed += 1;
    }

    // --- itemskill ----------------------------------------------------------
    const itemSkillNames = [...new Set(index.skills
      .filter((skill) => skill.name.startsWith('Item ') && skill.displayId && index.lookup.idToText.has(skill.displayId))
      .map((skill) => index.lookup.idToText.get(skill.displayId)))];
    for (const label of ctxlib.sample(itemSkillNames, 30, 7)) {
      bucket.itemskill.checked += 1;
      ctx.stats.sweep.totalRuns += 1;
      const out = await ctxlib.run(ctx, 'itemskill', { values: { mod_name: { type: 3, value: mod }, search: { type: 3, value: label } } });
      if (out.thrown) {
        tally(bucket.itemskill, 'threw', `${label}: ${out.thrown.message}`);
        continue;
      }
      if (out.problems.length) {
        tally(bucket.itemskill, 'payload-limit', `${label}: ${out.problems[0]}`);
        continue;
      }
      if (/No item skills|No results/i.test(out.text)) {
        tally(bucket.itemskill, 'not-found', label);
        continue;
      }
      bucket.itemskill.passed += 1;
    }

    // --- stats --------------------------------------------------------------
    for (const className of ctxlib.sample(index.classes.map((cls) => cls.name), 10, 11)) {
      for (const level of [1, 10, 30]) {
        bucket.stats.checked += 1;
        ctx.stats.sweep.totalRuns += 1;
        const out = await ctxlib.run(ctx, 'stats', { values: { mod_name: { type: 3, value: mod }, class_name: { type: 3, value: className }, level: { type: 4, value: level } } });
        if (out.thrown) {
          tally(bucket.stats, 'threw', `${className}@${level}: ${out.thrown.message}`);
          continue;
        }
        if (out.problems.length) {
          tally(bucket.stats, 'payload-limit', `${className}@${level}: ${out.problems[0]}`);
          continue;
        }
        if (!out.payloads.length) {
          tally(bucket.stats, 'no-response', `${className}@${level}`);
          continue;
        }
        bucket.stats.passed += 1;
      }
    }

    ctx.stats.sweep.mods[mod] = bucket;
  }

  // -------------------------------------------------------------------------
  // Aggregate findings (one per mechanism, not one per mod)
  // -------------------------------------------------------------------------
  const mods = Object.keys(ctx.stats.sweep.mods);
  const aggregate = (key, category) => mods
    .map((mod) => ({ mod, bucket: ctx.stats.sweep.mods[mod][key] }))
    .filter(({ bucket }) => bucket.categories[category])
    .map(({ mod, bucket }) => ({ mod, entry: bucket.categories[category] }));

  const classMismatch = aggregate('classFilter', 'display-name-mismatch');
  if (classMismatch.length) {
    ctxlib.addFinding(ctx, {
      severity: 'high',
      area: 'sweep',
      subject: '/classes cannot find the class names its autocomplete offers',
      expected: 'selecting a suggested class shows that class',
      actual: classMismatch.map(({ mod, entry }) => `${mod}: ${entry.count}/${ctx.stats.sweep.mods[mod].classFilter.checked}`).join(', '),
      evidence: 'modules/gladius/commands/classes.js filters displayName only; autocomplete offers CREATECLASS names',
      repro: 'node tools/verify/run.js --command classes --opt mod_name=Vanilla --opt class_name=ArcherF',
      note: `examples: ${classMismatch[0].entry.examples.join(', ')}`,
    });
  }

  const learnableMissing = aggregate('classLearnable', 'no-skills-shown');
  if (learnableMissing.length) {
    ctxlib.addFinding(ctx, {
      severity: 'high',
      area: 'sweep',
      subject: 'Learnable Skills is empty for variant classes',
      expected: 'a class with skills lists them',
      actual: learnableMissing.map(({ mod, entry }) => `${mod}: ${entry.count}/${ctx.stats.sweep.mods[mod].classLearnable.checked}`).join(', '),
      evidence: 'events.js resolves class -> SKILLUSENAME from blank-line chunks of classdefs.tok',
      repro: 'node tools/verify/run.js --command classes --opt mod_name=Vanilla  (then class-skills|Vanilla|ArcherF)',
      note: `examples: ${learnableMissing[0].entry.examples.join(', ')}`,
      ownerQuestion: 'Should the button pass the CREATECLASS name and let the handler resolve SKILLUSENAME from whole class blocks?',
    });
  }

  const sanitizer = aggregate('skills', 'sanitizer-changes-name');
  if (sanitizer.length) {
    const names = new Set();
    for (const { entry } of sanitizer) for (const example of entry.examples) names.add(example);
    ctxlib.addFinding(ctx, {
      severity: 'medium',
      area: 'sweep',
      subject: '/skill cannot find names containing punctuation',
      expected: 'every name the autocomplete offers is accepted by the command',
      actual: sanitizer.map(({ mod, entry }) => `${mod}: ${entry.count}`).join(', '),
      evidence: 'skill.js/explain.js sanitizeInput strips : & etc. before the lookup',
      repro: 'node tools/verify/run.js --command skill --opt mod_name=Vanilla --opt skill_name="Song: BattleMarch"',
      note: `examples: ${[...names].slice(0, 6).join(', ')}`,
      ownerQuestion: 'Should the sanitizer allow ":" (and similar) in names, or should the lookup use the raw autocomplete value?',
    });
  }

  const prizeMisses = aggregate('prizes', 'not-found');
  if (prizeMisses.length) {
    ctxlib.addFinding(ctx, {
      severity: 'info',
      area: 'sweep',
      subject: 'some league/encounter names are not findable by /prizes',
      expected: 'every name in lookuptext that is a league or encounter resolves',
      actual: prizeMisses.map(({ mod, entry }) => `${mod}: ${entry.count}`).join(', '),
      evidence: 'prizes.js matches LEAGUE/ENCOUNTER ids after sanitising the typed name',
      note: `examples: ${prizeMisses[0].entry.examples.join(' | ')}`,
      ownerQuestion: 'Some of these look internal or mis-encoded (Latin-1); confirm which should be findable.',
    });
  }

  for (const key of ['recruits', 'itemskill', 'stats', 'explain']) {
    const categories = new Set();
    for (const mod of mods) {
      for (const category of Object.keys(ctx.stats.sweep.mods[mod][key].categories)) categories.add(category);
    }
    for (const category of categories) {
      const hits = aggregate(key, category);
      if (!hits.length) continue;
      ctxlib.addFinding(ctx, {
        severity: key === 'stats' ? 'medium' : 'low',
        area: 'sweep',
        subject: `${key}: ${category}`,
        expected: 'every reference entity resolves',
        actual: hits.map(({ mod, entry }) => `${mod}: ${entry.count}`).join(', '),
        evidence: 'sweep',
        note: `examples: ${hits[0].entry.examples.join(', ')}`,
      });
    }
  }

  if (ctx.stats.sweep.autocomplete.failures.length) {
    ctxlib.addFinding(ctx, {
      severity: 'high',
      area: 'sweep',
      subject: 'autocomplete failures',
      expected: 'every autocomplete responds with valid choices',
      actual: JSON.stringify(ctx.stats.sweep.autocomplete.failures.slice(0, 5)),
      evidence: 'command autocomplete handlers',
    });
  }
}

module.exports = { probeSweep };
