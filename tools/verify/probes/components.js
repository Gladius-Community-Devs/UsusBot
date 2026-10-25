'use strict';

/**
 * Component behaviour: every button/select a command can send is fed back into
 * the event handler, and the next message is asserted on.
 *
 * This is where navigation bugs show up: two entry points that build the same
 * customId with different meanings, handlers that resolve a class through the
 * wrong parser, and error paths that reply after deferUpdate.
 */

const lib = require('../lib');
const ctxlib = require('./context');

/**
 * Run one component case.
 * @param {object} ctx
 * @param {string} customId
 * @param {string[]} values
 * @param {object} checks
 * @returns {Promise<object>}
 */
async function componentCase(ctx, customId, values, checks = {}) {
  const bucket = ctx.stats.components.byId[customId.split('|')[0]] || (ctx.stats.components.byId[customId.split('|')[0]] = { cases: 0, passed: 0, failed: 0 });
  ctx.stats.components.cases += 1;
  bucket.cases += 1;

  const out = await ctxlib.component(ctx, customId, values);
  const failures = [];
  const text = out.text || '';

  if (out.thrown) failures.push(`threw: ${out.thrown.message || out.thrown}`);
  if (out.violations.length) failures.push(`interaction: ${out.violations.join('; ')}`);
  if (out.problems.length) failures.push(`payload: ${out.problems.join('; ')}`);
  if (out.payloads.length === 0 && !checks.allowNoResponse) failures.push('no response');
  if (checks.allowNoResponse === undefined && out.payloads.length > 0 && /an error occurred/i.test(text)) {
    failures.push(`error text: ${text.slice(0, 120)}`);
  }

  if (checks.embeds !== undefined) {
    const count = out.payloads.reduce((n, entry) => n + ((entry.payload.embeds || []).length), 0);
    if (count < checks.embeds) failures.push(`expected at least ${checks.embeds} embed(s), got ${count}`);
  }
  if (checks.fields !== undefined) {
    const fields = out.payloads.flatMap((entry) => (entry.payload.embeds || []).flatMap((embed) => embed.fields || []));
    if (fields.length < checks.fields) failures.push(`expected at least ${checks.fields} embed field(s), got ${fields.length}`);
  }
  if (checks.contains) {
    for (const wanted of [].concat(checks.contains)) {
      if (!text.toLowerCase().includes(String(wanted).toLowerCase())) failures.push(`missing "${wanted}"`);
    }
  }
  if (checks.notContains) {
    for (const unwanted of [].concat(checks.notContains)) {
      if (text.toLowerCase().includes(String(unwanted).toLowerCase())) failures.push(`contains "${unwanted}"`);
    }
  }
  if (checks.custom) {
    const extra = checks.custom(out, text);
    if (extra) failures.push(...[].concat(extra));
  }

  if (failures.length) {
    ctx.stats.components.failed += 1;
    bucket.failed += 1;
    ctx.stats.components.failures.push({ customId, values, failures, sample: text.slice(0, 240), durationMs: out.durationMs });
  } else {
    ctx.stats.components.passed += 1;
    bucket.passed += 1;
  }

  return { out, text, failures };
}

/**
 * @param {object} ctx
 */
async function probeComponents(ctx) {
  ctx.stats.components = { cases: 0, passed: 0, failed: 0, byId: {}, failures: [] };

  // --- class pagination ----------------------------------------------------
  const page1 = await componentCase(ctx, 'class-next|Vanilla|0', [], { embeds: 1, fields: 1 });
  const title = page1.out.payloads.flatMap((entry) => (entry.payload.embeds || []).map((embed) => embed.title)).filter(Boolean)[0];

  await componentCase(ctx, 'class-next|Vanilla|127', [], { allowNoResponse: false });
  await componentCase(ctx, 'class-prev|Vanilla|0', [], { allowNoResponse: false });

  // The Learnable Skills button, as emitted from /classes page 0 (Amazon).
  await componentCase(ctx, 'class-skills|Vanilla|Amazon', [], { embeds: 1, fields: 1 });

  // The same button on a variant class. /classes emits the CREATECLASS name;
  // the skills are filed under SKILLUSENAME (here Archer).
  const variantLearnable = await componentCase(ctx, 'class-skills|Vanilla|ArcherF', [], {
    embeds: 1,
    fields: 1,
    custom: (out) => {
      const embeds = out.payloads.flatMap((entry) => entry.payload.embeds || []);
      const fieldCount = embeds.reduce((n, embed) => n + (embed.fields || []).length, 0);
      if (fieldCount === 0) {
        return [`variant class ${title || ''} lists no skills (desc: ${embeds.map((e) => e.description).join('; ')})`];
      }
      return [];
    },
  });
  await componentCase(ctx, 'class-skills|Vanilla|Archer', [], { embeds: 1, fields: 1 });

  if (variantLearnable.failures.length) {
    ctxlib.addFinding(ctx, {
      severity: 'high',
      area: 'components',
      subject: 'Learnable Skills is empty when reached from /classes',
      expected: 'ArcherF lists the 43 skills filed under SKILLUSENAME "Archer"',
      actual: variantLearnable.text.slice(0, 160),
      evidence: 'events.js learns SKILLUSENAME by splitting classdefs.tok on blank lines; class blocks contain blank lines',
      repro: 'node tools/verify/run.js --command classes --opt mod_name=Vanilla  then click class-skills|Vanilla|ArcherF',
      note: 'reached from pagination the same button passes "Archer" and works, so the two entry points disagree',
    });
  }

  // A class that genuinely has no skills (Nephilia) — behaviour, not necessarily a bug.
  await componentCase(ctx, 'class-skills|Vanilla|Nephilia', [], { allowNoResponse: false });

  // --- skill class selector ------------------------------------------------
  await componentCase(ctx, 'class-select|Vanilla|Chomp|0', ['affinitybeastgreater'], { contains: ['SKILLCREATE'] });
  await componentCase(ctx, 'class-select|Vanilla|Chomp|0', ['affinitybeast'], { contains: ['SKILLCREATE'] });
  await componentCase(ctx, 'class-select|Vanilla|Chomp|0', ['nosuchclass'], { allowNoResponse: false, notContains: ['an error occurred'] });

  // --- explain class selector ---------------------------------------------
  const explained = await componentCase(ctx, 'explain-select|Vanilla|Strike|0', ['amazon'], { contains: ['Skills.tok Information'], notContains: ['an error occurred'] });
  await componentCase(ctx, 'explain-select|Vanilla|Strike|0', ['bandit'], { contains: ['Skills.tok Information'] });
  if (explained.text.includes(';skill')) {
    ctxlib.addFinding(ctx, {
      severity: 'low',
      area: 'components',
      subject: 'explain output tells users to use the retired ;skill form',
      expected: 'the message points at /skill',
      actual: 'it prints ";skill <class> <name>", which now answers with a "use /skill" hint',
      evidence: 'modules/gladius/events.js line 238',
      repro: 'node tools/verify/run.js --command skill ... then explain-select; or read the branch header',
    });
  }

  // --- itemskill -----------------------------------------------------------
  await componentCase(ctx, 'itemskill-prev|Vanilla|0', [], { allowNoResponse: false });
  await componentCase(ctx, 'itemskill-next|Vanilla|1', [], { allowNoResponse: false });
  await componentCase(ctx, 'itemskill-shops|Vanilla|0', [], { allowNoResponse: false });

  // --- learnable skills paging --------------------------------------------
  await componentCase(ctx, 'learnable-page|Vanilla|Archer|1', [], { embeds: 1, fields: 1 });
  await componentCase(ctx, 'learnable-page|Vanilla|Archer|999', [], { allowNoResponse: false });

  // --- recruits ------------------------------------------------------------
  await componentCase(ctx, 'recruits-class-select|Vanilla|0', ['Amazon'], { embeds: 1 });

  // --- unknown id ----------------------------------------------------------
  await componentCase(ctx, 'not-a-real-id|Vanilla|0', [], { allowNoResponse: true });
}

module.exports = { probeComponents };

