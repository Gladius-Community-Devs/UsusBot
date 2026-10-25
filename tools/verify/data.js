'use strict';

/**
 * Independent reference reader for a Gladius mod's data directory.
 *
 * This deliberately does NOT use the bot's parsers. It segments files
 * line-by-line at each record's opening keyword, which is how the format
 * actually works, and keeps raw values. The bot's parsers are then compared
 * against this in probes.js; where they disagree, one of them is wrong and the
 * report says which.
 */

const fs = require('fs');
const path = require('path');

// Same decode rule as modules/gladius/functions.js: strict UTF-8, else cp1252.
const CP1252 = {
  0x80: '\u20AC', 0x82: '\u201A', 0x83: '\u0192', 0x84: '\u201E',
  0x85: '\u2026', 0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02C6',
  0x89: '\u2030', 0x8A: '\u0160', 0x8B: '\u2039', 0x8C: '\u0152',
  0x8E: '\u017D', 0x91: '\u2018', 0x92: '\u2019', 0x93: '\u201C',
  0x94: '\u201D', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014',
  0x98: '\u02DC', 0x99: '\u2122', 0x9A: '\u0161', 0x9B: '\u203A',
  0x9C: '\u0153', 0x9E: '\u017E', 0x9F: '\u0178'
};

function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (error) {
    let text = '';
    for (const byte of buffer) {
      text += (byte >= 0x80 && byte <= 0x9F && CP1252[byte]) ? CP1252[byte] : String.fromCharCode(byte);
    }
    return text;
  }
}

/**
 * Split a .tok-style file into records, each starting at a line matching
 * `starter`. Blank lines and comments stay with the record they follow.
 * @param {string} text
 * @param {RegExp} starter
 * @returns {{lines: string[], text: string}[]}
 */
function splitBlocks(text, starter) {
  const blocks = [];
  let current = null;

  for (const line of String(text).split(/\r?\n/)) {
    if (starter.test(line)) {
      if (current) blocks.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) blocks.push(current);

  return blocks.map((lines) => ({ lines, text: lines.join('\n') }));
}

/**
 * key -> array of raw values, preserving duplicates and order.
 * @param {{lines: string[]}} block
 * @returns {Map<string, string[]>}
 */
function parseKeyValues(block) {
  const values = new Map();
  for (const line of block.lines) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1].toUpperCase();
    if (!values.has(key)) values.set(key, []);
    values.get(key).push(match[2]);
  }
  return values;
}

/**
 * Every double-quoted string in a value, in order.
 * @param {string} value
 * @returns {string[]}
 */
function quoted(value) {
  return [...String(value || '').matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

/**
 * First value for a key, or undefined.
 * @param {Map<string, string[]>} values
 * @param {string} key
 * @returns {string|undefined}
 */
function first(values, key) {
  const list = values.get(key);
  return list && list.length ? list[0] : undefined;
}

/**
 * Parse lookuptext_eng.txt: `id^speak^listen^text`.
 * @param {string} text
 * @returns {{idToText: Map<number,string>, nameToIds: Map<string,number[]>}}
 */
function parseLookup(text) {
  const idToText = new Map();
  const nameToIds = new Map();

  for (const line of String(text).split(/\r?\n/)) {
    if (!line.includes('^')) continue;
    const fields = line.split('^');
    const id = Number.parseInt(fields[0].trim(), 10);
    if (!Number.isFinite(id)) continue;
    const label = fields[fields.length - 1].trim();
    idToText.set(id, label);
    const key = label.toLowerCase();
    if (!nameToIds.has(key)) nameToIds.set(key, []);
    nameToIds.get(key).push(id);
  }

  return { idToText, nameToIds };
}

/**
 * Parse skills.tok records.
 * @param {string} text
 * @returns {object[]}
 */
function parseSkills(text) {
  return splitBlocks(text, /^SKILLCREATE:/).map((block) => {
    const values = parseKeyValues(block);
    const create = quoted(first(values, 'SKILLCREATE') || '');
    const displayId = Number.parseInt((first(values, 'SKILLDISPLAYNAMEID') || '').trim(), 10);
    const descId = Number.parseInt((first(values, 'SKILLDESCRIPTIONID') || '').trim(), 10);

    return {
      block,
      values,
      create,
      name: create[0] || '',
      type: create[1] || '',
      category: create[2] || '',
      displayId: Number.isFinite(displayId) ? displayId : null,
      descId: Number.isFinite(descId) ? descId : null,
      classes: (values.get('SKILLUSECLASS') || []).flatMap((v) => quoted(v)),
      subSkills: (values.get('SKILLSUBSKILL') || []).flatMap((v) => quoted(v)),
      subSkillCondition: first(values, 'SKILLSUBSKILLCONDITION'),
      meter: first(values, 'SKILLMETER'),
      jobPointCost: first(values, 'SKILLJOBPOINTCOST'),
    };
  });
}

/**
 * Parse classdefs.tok records.
 * @param {string} text
 * @returns {object[]}
 */
function parseClasses(text) {
  return splitBlocks(text, /^CREATECLASS:/).map((block) => {
    const values = parseKeyValues(block);
    const name = (block.lines[0] || '').replace(/^CREATECLASS:\s*/, '').trim();
    const skillUseName = (first(values, 'SKILLUSENAME') || '').replace(/"/g, '').trim();
    const displayId = Number.parseInt((first(values, 'DISPLAYNAMEID') || '').trim(), 10);
    const descId = Number.parseInt((first(values, 'DESCRIPTIONID') || '').trim(), 10);

    return {
      block,
      values,
      name,
      skillUseName,
      displayId: Number.isFinite(displayId) ? displayId : null,
      descId: Number.isFinite(descId) ? descId : null,
      attributes: (values.get('ATTRIBUTE') || []).flatMap((v) => quoted(v)),
      itemCats: (values.get('ITEMCAT') || []).map((v) => v.trim()),
    };
  });
}

/**
 * Parse items.tok records.
 * @param {string} text
 * @returns {object[]}
 */
function parseItems(text) {
  return splitBlocks(text, /^ITEMCREATE:/).map((block) => {
    const values = parseKeyValues(block);
    const create = quoted(first(values, 'ITEMCREATE') || '');
    const displayId = Number.parseInt((first(values, 'ITEMDISPLAYNAMEID') || '').trim(), 10);

    return {
      block,
      values,
      create,
      name: create[0] || '',
      type: create[1] || '',
      subtype: create[2] || '',
      style: create[3] || '',
      displayId: Number.isFinite(displayId) ? displayId : null,
      skills: (values.get('ITEMSKILL') || []).flatMap((v) => quoted(v)),
      cost: first(values, 'ITEMCOST'),
      minLevel: first(values, 'ITEMMINLEVEL'),
    };
  });
}

/**
 * Parse every league/encounter entry in towns/leagues/*.tok.
 * @param {string} leaguesDir
 * @returns {{leagues: object[], encounters: object[]}}
 */
function parseLeagues(leaguesDir) {
  const leagues = [];
  const encounters = [];

  if (!fs.existsSync(leaguesDir)) return { leagues, encounters };

  for (const file of fs.readdirSync(leaguesDir).filter((f) => f.endsWith('.tok')).sort()) {
    const content = decodeText(fs.readFileSync(path.join(leaguesDir, file)));
    for (const line of content.split(/\r?\n/)) {
      const league = line.match(/^LEAGUE\s+"([^"]+)",\s*(\d+)/);
      if (league) {
        leagues.push({ file, name: league[1], id: Number.parseInt(league[2], 10) });
        continue;
      }
      const encounter = line.match(/^ENCOUNTER\s+"([^"]+)",\s*(\d+)/);
      if (encounter) {
        encounters.push({ file, name: encounter[1], id: Number.parseInt(encounter[2], 10) });
      }
    }
  }

  return { leagues, encounters };
}

/**
 * Parse units/gladiators.txt.
 * @param {string} text
 * @returns {object[]}
 */
function parseGladiators(text) {
  return splitBlocks(text, /^Name:/).map((block) => {
    const values = parseKeyValues(block);
    return {
      block,
      name: (first(values, 'NAME') || '').trim(),
      class: (first(values, 'CLASS') || '').trim(),
      statSet: (first(values, 'STAT SET') || '').trim(),
      skillSet: (first(values, 'SKILL SET') || '').trim(),
      itemSet: (first(values, 'ITEM SET') || '').trim(),
    };
  });
}

/**
 * Parse units/statsets.txt into id -> {levels}.
 * @param {string} text
 * @returns {Map<number, object>}
 */
function parseStatsets(text) {
  const sets = new Map();
  for (const block of splitBlocks(text, /^Statset\s+\d+:/)) {
    const header = (block.lines[0] || '').match(/^Statset\s+(\d+):/);
    if (!header) continue;
    const id = Number.parseInt(header[1], 10);
    const levels = new Map();
    for (const line of block.lines.slice(1)) {
      const row = line.match(/^\s*(\d+)\s*:\s*(.+)$/);
      if (row) levels.set(Number.parseInt(row[1], 10), row[2].trim());
    }
    sets.set(id, { id, block, levels });
  }
  return sets;
}

/**
 * Mods that satisfy the bot's own discovery rule (skills.tok + lookuptext).
 * @param {string} dataRoot
 * @returns {string[]}
 */
function discoverMods(dataRoot) {
  if (!fs.existsSync(dataRoot)) return [];
  return fs.readdirSync(dataRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      const config = path.join(dataRoot, entry.name, 'data', 'config');
      return fs.existsSync(path.join(config, 'skills.tok'))
        && fs.existsSync(path.join(config, 'lookuptext_eng.txt'));
    })
    .map((entry) => entry.name)
    .sort();
}

/**
 * Read one mod's data directory into reference structures.
 * @param {string} dataRoot
 * @param {string} modName
 * @returns {object}
 */
function loadMod(dataRoot, modName) {
  const dataDir = path.join(dataRoot, modName, 'data');
  const config = path.join(dataDir, 'config');
  const read = (p) => (fs.existsSync(p) ? decodeText(fs.readFileSync(p)) : null);

  const skillsText = read(path.join(config, 'skills.tok'));
  const classesText = read(path.join(config, 'classdefs.tok'));
  const itemsText = read(path.join(config, 'items.tok'));
  const lookupText = read(path.join(config, 'lookuptext_eng.txt'));
  const gladiatorsText = read(path.join(dataDir, 'units', 'gladiators.txt'));
  const statsetsText = read(path.join(dataDir, 'units', 'statsets.txt'));

  const lookup = lookupText ? parseLookup(lookupText) : { idToText: new Map(), nameToIds: new Map() };
  const skills = skillsText ? parseSkills(skillsText) : [];
  const classes = classesText ? parseClasses(classesText) : [];
  const items = itemsText ? parseItems(itemsText) : [];
  const { leagues, encounters } = parseLeagues(path.join(dataDir, 'towns', 'leagues'));
  const gladiators = gladiatorsText ? parseGladiators(gladiatorsText) : [];
  const statsets = statsetsText ? parseStatsets(statsetsText) : new Map();

  const declared = {};
  for (const [key, text] of [
    ['skills', skillsText],
    ['classes', classesText],
    ['items', itemsText],
    ['gladiators', gladiatorsText],
    ['statsets', statsetsText],
  ]) {
    if (!text) continue;
    const match = text.match(/^NUMENTRIES:\s*(\d+)/m) || text.match(/^NUMCLASSDEFS:\s*(\d+)/m);
    if (match) declared[key] = Number.parseInt(match[1], 10);
  }

  return {
    mod: modName,
    dataDir,
    configDir: config,
    paths: {
      skills: path.join(config, 'skills.tok'),
      classes: path.join(config, 'classdefs.tok'),
      items: path.join(config, 'items.tok'),
      lookup: path.join(config, 'lookuptext_eng.txt'),
      prizes: path.join(config, 'prizes.tok'),
      leagues: path.join(dataDir, 'towns', 'leagues'),
      shops: path.join(dataDir, 'towns', 'shops'),
      gladiators: path.join(dataDir, 'units', 'gladiators.txt'),
      statsets: path.join(dataDir, 'units', 'statsets.txt'),
    },
    declared,
    lookup,
    skills,
    classes,
    items,
    leagues,
    encounters,
    gladiators,
    statsets,
  };
}

module.exports = {
  splitBlocks,
  parseKeyValues,
  quoted,
  parseLookup,
  parseSkills,
  parseClasses,
  parseItems,
  parseLeagues,
  parseGladiators,
  parseStatsets,
  discoverMods,
  loadMod,
};

