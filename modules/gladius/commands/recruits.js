// recruits.js – revamped with verbose logging throughout
// Adds extensive this.logger.info / this.logger.error calls so that execution flow
// and data counts can be traced end‑to‑end.
// -----------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const helpers = require('../functions');

/**
 * Build a mapping of *player‑facing* class names → internal CREATECLASS names.
 * We read lookuptext_eng.txt first (ID ► text) and then classdefs.tok to pair
 * DISPLAYNAMEID with its CREATECLASS.
 */
function buildClassMap(modPath, logger) {
  const lookupPath    = path.join(modPath, 'lookuptext_eng.txt');
  const classdefPath  = path.join(modPath, 'data', 'config', 'classdefs.tok');
  const map           = new Map();

  try {
    logger.info(`[recruits] buildClassMap() starting. modPath = ${modPath}`);

    // 1) ---------------- lookuptext -------------------------------------------------
    logger.info(`[recruits] Reading lookup file: ${lookupPath}`);
    const lookupRaw   = fs.readFileSync(lookupPath, 'utf8');
    const lookupLines = lookupRaw.split(/\r?\n/);
    logger.info(`[recruits] lookuptext_eng.txt lines: ${lookupLines.length}`);

    // Build ID ➜ text map once.
    const id2txt = new Map();
    for (const ln of lookupLines) {
      const caret = ln.indexOf('^');
      if (caret === -1) continue; // not a valid entry
      const id    = parseInt(ln.slice(0, caret), 10);
      const text  = ln.slice(caret + 1).split('^').pop().trim();
      if (!Number.isNaN(id) && text) id2txt.set(id, text);
    }
    logger.info(`[recruits] lookup map built: ${id2txt.size} IDs`);

    // 2) ---------------- classdefs --------------------------------------------------
    logger.info(`[recruits] Reading classdefs: ${classdefPath}`);
    const classRaw = fs.readFileSync(classdefPath, 'utf8');
    const chunks   = classRaw.split(/\n\s*\n/);
    logger.info(`[recruits] classdefs chunks: ${chunks.length}`);

    for (const ch of chunks) {
      const createMatch = ch.match(/^\s*CREATECLASS:\s*(.+)$/m);
      const displayMatch = ch.match(/^\s*DISPLAYNAMEID:\s*(\d+)/m);
      if (!createMatch || !displayMatch) continue; // malformed chunk

      const createClass = createMatch[1].trim();
      const displayId   = Number(displayMatch[1]);
      const frontTxt    = id2txt.get(displayId);

      if (!frontTxt) {
        logger.info(`[recruits] DISPLAYNAMEID ${displayId} has no lookup text – skipped`);
        continue;
      }

      const key = frontTxt.toLowerCase();
      if (!map.has(key)) map.set(key, { frontEndName: frontTxt, classes: [] });
      map.get(key).classes.push(createClass);
      logger.info(`[recruits] Mapped '${frontTxt}' → '${createClass}'`);
    }
    logger.info(`[recruits] buildClassMap() complete. front‑names: ${map.size}`);
  } catch (err) {
    logger.error(`[recruits] Error building class map: ${err.stack || err}`);
    throw err; // bubble up
  }

  return map;
}

module.exports = {
  name: 'recruits',
  description: 'Locate recruitable gladiators by class name',
  async execute(message, args) {
    const started = Date.now();
    const logger  = this.logger || console; // safety fallback

    logger.info(`[recruits] Command invoked by ${message.author.tag}. Raw args: ${args.join(' | ')}`);

    // ---------------------------------------------------------------------------
    // 0) Basic validation
    if (!args || args.length === 0) {
      logger.info('[recruits] No arguments supplied – aborting early');
      return message.reply('You need to supply a class name to search for.');
    }

    // ---------------------------------------------------------------------------
    // 1) Resolve mod path using existing helper (keeps original logic intact)
    let modInfo;
    try {
      modInfo = helpers.resolveModPath(args); // original helper: returns { modPath, gladiatorsPath, ... }
    } catch (err) {
      logger.error(`[recruits] Error resolving mod path: ${err.stack || err}`);
      return message.reply('Unable to locate the specified mod or its data files.');
    }

    const { modPath, gladiatorsPath } = modInfo;
    logger.info(`[recruits] Resolved modPath = ${modPath}`);
    logger.info(`[recruits] Resolved gladiatorsPath = ${gladiatorsPath}`);

    // ---------------------------------------------------------------------------
    // 2) Build / fetch the class‑name mapping
    let classMap;
    try {
      classMap = buildClassMap(modPath, logger);
    } catch {
      return message.reply('Failed to build class dictionary; cannot continue.');
    }

    // ---------------------------------------------------------------------------
    // 3) Figure out what the user actually asked for
    const requestedRaw = args.join(' ');
    const requestedKey = helpers.sanitizeInput(requestedRaw).toLowerCase();
    logger.info(`[recruits] Sanitised term: '${requestedKey}'`);

    let mapping = classMap.get(requestedKey);
    if (!mapping) {
      // Maybe they typed the internal CREATECLASS already – keep behaviour parity
      mapping = { frontEndName: requestedRaw, classes: [requestedRaw] };
      logger.info(`[recruits] Term not in classMap; treating as raw CREATECLASS '${requestedRaw}'`);
    }

    if (!mapping.classes.length) {
      logger.info(`[recruits] No internal classes resolved for '${requestedRaw}' – aborting`);
      return message.reply(`Unknown class: **${requestedRaw}**`);
    }

    logger.info(`[recruits] Internal class list to match: ${mapping.classes.join(', ')}`);

    // ---------------------------------------------------------------------------
    // 4) Read & parse gladiators.txt ------------------------------------------------
    let gladiRaw;
    try {
      logger.info(`[recruits] Reading gladiators file: ${gladiatorsPath}`);
      gladiRaw = fs.readFileSync(gladiatorsPath, 'utf8');
    } catch (err) {
      logger.error(`[recruits] Unable to read gladiators file: ${err.stack || err}`);
      return message.reply('Could not load gladiators.txt.');
    }

    const gChunks   = gladiRaw.split(/\n\s*\n/);
    logger.info(`[recruits] Gladiator chunks parsed: ${gChunks.length}`);

    const prelimMatches = [];
    for (const chunk of gChunks) {
      const classLine = chunk.match(/^\s*Class:\s*(.+)$/m);
      if (!classLine) continue;
      const className = classLine[1].trim();
      if (!mapping.classes.includes(className)) continue; // filter early

      const nameLine  = chunk.match(/^\s*Name:\s*(.+)$/m);
      const setLine   = chunk.match(/^\s*Stat set:\s*(\d+)/m);

      prelimMatches.push({
        name     : nameLine ? nameLine[1].trim() : 'Unknown',
        className: className,
        statSet  : setLine ? Number(setLine[1]) : null,
      });
    }

    logger.info(`[recruits] Gladiators matching class list: ${prelimMatches.length}`);

    if (!prelimMatches.length) {
      return message.reply(`No recruits found for class **${mapping.frontEndName}**.`);
    }

    // ---------------------------------------------------------------------------
    // 5) Apply statset5 filter (original stat logic lives in helpers)
    const filtered = helpers.filterTopStatsets(prelimMatches);
    logger.info(`[recruits] After statset5 filtering: ${filtered.length} recruits remain`);

    if (!filtered.length) {
      return message.reply(`No recruits with top stat sets found for **${mapping.frontEndName}**.`);
    }

    // ---------------------------------------------------------------------------
    // 6) Build & send the embed -----------------------------------------------------
    const embed = new EmbedBuilder()
      .setTitle(`Recruits – ${mapping.frontEndName}`)
      .setDescription(`${filtered.length} gladiator(s) found`)
      .setColor(0x4caf50);

    filtered.forEach(g => {
      const val = `Class: **${g.className}**\nStatset: **${g.statSet ?? 'N/A'}**`;
      embed.addFields({ name: g.name, value: val, inline: true });
    });

    try {
      await message.channel.send({ embeds: [embed] });
      logger.info(`[recruits] Embed dispatched successfully. Runtime: ${Date.now() - started} ms`);
    } catch (err) {
      logger.error(`[recruits] Failed to send embed: ${err.stack || err}`);
      await message.reply('Could not send recruit list – Discord error.');
    }
  }
};
