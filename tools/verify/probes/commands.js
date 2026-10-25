'use strict';

/**
 * Command behaviour: run each command against real mod data with realistic and
 * adversarial inputs, then assert on what a user would receive.
 *
 * The assertions are deliberately loose about wording and strict about facts:
 * a valid answer must mention the thing asked for, must not be an error
 * message, must fit Discord, and must be exactly one response unless the
 * command legitimately pages.
 */

const path = require('path');
const lib = require('../lib');
const ctxlib = require('./context');

const ERROR_TEXT = /an error occurred|there was an error|error while executing|something went wrong/i;

/**
 * Build the option value map for a command.
 * @param {object} command
 * @param {object} raw
 * @returns {object}
 */
function valueMap(command, raw) {
  const types = {};
  if (command.data) {
    for (const option of command.data.toJSON().options || []) types[option.name] = option.type;
  }
  const values = {};
  for (const [name, value] of Object.entries(raw || {})) {
    values[name] = { type: types[name] || 3, value };
  }
  return values;
}

/**
 * Read the text a user would see.
 * @param {object} out
 * @returns {string}
 */
function textOf(out) {
  return out.text || '';
}

/**
 * @param {object} ctx
 */
async function probeCommands(ctx) {
  ctx.stats.commands = {
    cases: 0,
    passed: 0,
    failed: 0,
    byCommand: {},
    failures: [],
  };

  const runCase = async (name, rawOptions, checks = {}, roles = []) => {
    const bucket = ctx.stats.commands.byCommand[name] || (ctx.stats.commands.byCommand[name] = { cases: 0, passed: 0, failed: 0 });
    ctx.stats.commands.cases += 1;
    bucket.cases += 1;

    const found = lib.findCommand(ctx.modules, name);
    if (!found) throw new Error(`no command ${name}`);

    const out = await ctxlib.run(ctx, name, { values: valueMap(found.command, rawOptions), roles });
    const text = textOf(out);
    const failures = [];

    if (out.thrown) failures.push(`threw: ${out.thrown.message || out.thrown}`);
    if (out.violations.length) failures.push(`interaction: ${out.violations.join('; ')}`);
    if (out.problems.length) failures.push(`payload: ${out.problems.join('; ')}`);
    if (out.payloads.length === 0) failures.push('sent no response');

    if (checks.expectError) {
      if (!ERROR_TEXT.test(text) && out.payloads.length) {
        // An "expected error" case does not have to use the word error, but it
        // must not look like a successful answer.
      }
    } else if (ERROR_TEXT.test(text)) {
      failures.push(`user-facing error text: ${text.slice(0, 120)}`);
    }

    for (const wanted of checks.contains || []) {
      if (!text.toLowerCase().includes(String(wanted).toLowerCase())) failures.push(`missing "${wanted}"`);
    }
    for (const unwanted of checks.notContains || []) {
      if (text.toLowerCase().includes(String(unwanted).toLowerCase())) failures.push(`contains "${unwanted}"`);
    }
    if (checks.minEmbeds !== undefined && out.payloads.every((p) => !(p.payload.embeds || []).length)) {
      failures.push('expected an embed');
    }
    if (checks.messageCount !== undefined && out.payloads.length !== checks.messageCount) {
      failures.push(`sent ${out.payloads.length} messages, expected ${checks.messageCount}`);
    }

    if (failures.length) {
      ctx.stats.commands.failed += 1;
      bucket.failed += 1;
      ctx.stats.commands.failures.push({
        command: name,
        options: rawOptions,
        failures,
        sample: text.slice(0, 240),
        durationMs: out.durationMs,
      });
    } else {
      ctx.stats.commands.passed += 1;
      bucket.passed += 1;
    }

    return { out, failures, text };
  };

  // -------------------------------------------------------------------------
  // Global commands
  // -------------------------------------------------------------------------

  await runCase('hello', {}, { contains: ['Hello'], messageCount: 1 });
  await runCase('ping', {}, { contains: ['Pong'], messageCount: 1 });
  await runCase('ping', { input: 'anything' }, { contains: ['Pong'], messageCount: 1 });
  await runCase('cheats', {}, { contains: ['Free Dinars'], messageCount: 1 });
  await runCase('modlist', {}, { minEmbeds: 1, messageCount: 1 });
  await runCase('add_modder', { user: { id: '100000000000000001' }, mod_name: 'VerifyMod' }, { contains: ['permission'], messageCount: 1 });
  await runCase('crashreport', {}, { contains: ['permission'], messageCount: 1 });
  await runCase('updatemod', { patch: { name: 'x.zip', url: 'https://example.invalid/x.zip', size: 1 } }, { messageCount: 1 });
  await runCase('help', {}, { minEmbeds: 1, messageCount: 1 });

  // Admin surface with the role present.
  await runCase('crashreport', {}, { messageCount: 1 }, ['Admin']);

  // add_modder writes the shared file; point it at a throwaway copy first.
  const moddersPath = process.env.ALLOWED_MODDERS_FILE;
  const tempModders = path.join(lib.BOT_ROOT, '.verify', 'modders.tmp.json');
  require('fs').copyFileSync(moddersPath, tempModders);
  process.env.ALLOWED_MODDERS_FILE = tempModders;
  try {
    await runCase('add_modder', { user: { id: '100000000000000001' }, mod_name: 'VerifyMod' }, { contains: ['Successfully'], messageCount: 1 }, ['Admin']);
    const written = JSON.parse(require('fs').readFileSync(tempModders, 'utf8'));
    if (!written['100000000000000001']) {
      ctxlib.addFinding(ctx, {
        severity: 'high',
        area: 'commands',
        subject: '/add_modder did not persist',
        expected: 'the new modder is written to ALLOWED_MODDERS_FILE',
        actual: 'file unchanged',
        evidence: tempModders,
        repro: 'node tools/verify/run.js --command add_modder --role Admin --opt user=... --opt mod_name=VerifyMod',
      });
    }
  } finally {
    process.env.ALLOWED_MODDERS_FILE = moddersPath;
  }

  // -------------------------------------------------------------------------
  // Data commands, every mod
  // -------------------------------------------------------------------------

  for (const mod of ctx.mods) {
    const index = ctx.indexes.get(mod);

    const names = [...new Set(index.skills
      .filter((skill) => skill.displayId && index.lookup.idToText.has(skill.displayId))
      .map((skill) => index.lookup.idToText.get(skill.displayId)))];
    const classes = index.classes.map((cls) => cls.name);
    const variants = index.classes.filter((cls) => cls.skillUseName && cls.skillUseName !== cls.name).map((cls) => cls.name);
    const leagues = index.leagues.filter((league) => index.lookup.idToText.has(league.id));
    const encounters = index.encounters.filter((encounter) => index.lookup.idToText.has(encounter.id));
    const gladiatorClasses = [...new Set(index.gladiators.map((gladiator) => gladiator.class))];

    const skillSamples = ctxlib.sample(names, 6, 53);
    const classSamples = ctxlib.sample(classes, 4, 23);
    const variantSample = variants.slice(0, 2);
    const leagueSample = ctxlib.sample(leagues, 4, 17);
    const encounterSample = ctxlib.sample(encounters, 4, 41);
    const recruitSample = ctxlib.sample(gladiatorClasses, 4, 29);

    for (const name of skillSamples) {
      await runCase('skill', { mod_name: mod, skill_name: name }, { contains: ['SKILLCREATE:'] });
      await runCase('explain', { mod_name: mod, skill_name: name }, { contains: ['Skills.tok Information'] });
    }
    await runCase('skill', { mod_name: mod, skill_name: 'definitely not a skill' }, { contains: ['No skill named'] });
    await runCase('explain', { mod_name: mod, skill_name: 'definitely not a skill' }, { contains: ['No skill named'] });

    for (const name of classSamples) {
      await runCase('classes', { mod_name: mod, class_name: name }, { minEmbeds: 1 });
    }
    for (const name of variantSample) {
      await runCase('classes', { mod_name: mod, class_name: name }, { minEmbeds: 1 });
    }
    await runCase('classes', { mod_name: mod, class_name: 'no such class' }, { contains: ['No classes found'] });

    const itemSkills = [...new Set(index.skills
      .filter((skill) => skill.name.startsWith('Item ') && skill.displayId && index.lookup.idToText.has(skill.displayId))
      .map((skill) => index.lookup.idToText.get(skill.displayId)))];
    for (const name of ctxlib.sample(itemSkills, 2, 7)) {
      await runCase('itemskill', { mod_name: mod, search: name }, {});
    }
    await runCase('itemskill', { mod_name: mod }, {});
    await runCase('itemskill', { mod_name: mod, search: 'zzzz not an item' }, { contains: ['No'] });

    for (const league of leagueSample) {
      const label = index.lookup.idToText.get(league.id);
      await runCase('prizes', { mod_name: mod, encounter_name: label }, {});
    }
    for (const encounter of encounterSample) {
      const label = index.lookup.idToText.get(encounter.id);
      await runCase('prizes', { mod_name: mod, encounter_name: label }, {});
    }
    await runCase('prizes', { mod_name: mod, encounter_name: 'no such encounter' }, { contains: ['No encounter'] });

    for (const className of recruitSample) {
      await runCase('recruits', { mod_name: mod, class_name: className }, {});
    }
    await runCase('recruits', { mod_name: mod, class_name: 'no such class' }, { contains: ['No class named'] });

    for (const className of ctxlib.sample(classes, 2, 31)) {
      await runCase('stats', { mod_name: mod, class_name: className, level: 1 }, {});
      await runCase('stats', { mod_name: mod, class_name: className, level: 30 }, {});
    }
    await runCase('stats', { mod_name: mod, class_name: 'no such class' }, { contains: ['No'] });
  }

  // A mod with no data (Tournament comes and goes) must fail cleanly.
  await runCase('skill', { mod_name: 'Tournament', skill_name: 'Chomp' }, { contains: ['does not have files'] });
  await runCase('classes', { mod_name: 'Tournament' }, { contains: ['Required files are missing'] });
  await runCase('prizes', { mod_name: 'Tournament', encounter_name: 'Chomp' }, { contains: ['does not have files'] });

  // Regression targets for the fixed defects.
  await runCase('skill', { mod_name: 'Vanilla', skill_name: 'Song: BattleMarch' }, { contains: ['SKILLCREATE:'] });
  await runCase('classes', { mod_name: 'Vanilla', class_name: 'ArcherF' }, { minEmbeds: 1 });
  await runCase('prizes', { mod_name: 'Vanilla', encounter_name: 'Altahrun_MP' }, { notContains: ['No encounter'] });
  await runCase('skill', { mod_name: 'Vanilla', skill_name: 'Air Affinity Attack 1', class_name: 'ArcherF' }, { contains: ['SKILLCREATE:'] });
  await runCase('explain', { mod_name: 'Vanilla', skill_name: 'Air Affinity Attack 1', class_name: 'ArcherF' }, { contains: ['Skills.tok Information'] });
  await runCase('classes', { mod_name: 'Ragnarok', class_name: 'Jötunn' }, { minEmbeds: 1 });
  await runCase('recruits', { mod_name: 'Vanilla', class_name: 'ArcherF' }, { contains: ['Recruitment Locations for Archer (ArcherF)'] });
  await runCase('recruits', { mod_name: 'Vanilla', class_name: 'Archer' }, { contains: ['Archer'] });
  await runCase('recruits', { mod_name: 'Vanilla', class_name: 'Minotaur' }, { contains: ['No Standard Location'], notContains: ['🏫'] });
  await runCase('recruits', { mod_name: 'Vanilla', class_name: 'Eiji' }, { contains: ['No Standard Location'] });
  await runCase('stats', { mod_name: 'Vanilla', class_name: 'ArcherF', level: 1 }, { contains: ['Stats for Archer (ArcherF)'] });
  await runCase('stats', { mod_name: 'Vanilla', class_name: 'Mongrel Shaman', level: 1 }, { contains: ['Stats for Mongrel Shaman'] });
  await runCase('classes', { mod_name: 'Vanilla', class_name: 'Mongrel Shaman' }, { minEmbeds: 1 });
}

module.exports = { probeCommands };





