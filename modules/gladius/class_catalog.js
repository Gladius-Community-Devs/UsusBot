'use strict';

/**
 * One data-driven view of a mod's classes.
 *
 * The game uses three different keys for "class", and the bot needs a single
 * place that knows how they relate:
 *
 *   CREATECLASS   the unit class (ArcherF) - what gladiators, recruits and stats use
 *   SKILLUSENAME  the shared skill list (Archer) - what skills.tok keys on
 *   display name  what the game shows the player ("Archer", "Greater Bear")
 *
 * It also derives, from the data rather than from name patterns:
 *
 *   - which classes have units at all (gladiators.txt)
 *   - which units are recruited from a league (RECRUIT lines)
 *   - which units belong to a school (School: field + schools.txt)
 *   - which classes have a valid stat set (statsets.txt)
 *
 * Event grants live in script files, not in leagues or schools, so a class with
 * units and no standard location is still offered; the recruit command reports
 * it as having no standard location instead of dropping it.
 */

const fs = require('fs');
const path = require('path');
const helpers = require('./functions');

/** @type {Map<string, {stamp: string, catalog: object}>} */
const cache = new Map();

/**
 * @param {string} file
 * @returns {string}
 */
function fileStamp(file) {
    try {
        const stat = fs.statSync(file);
        return `${stat.size}:${stat.mtimeMs}`;
    } catch (error) {
        return 'missing';
    }
}

/**
 * Parse a gladiator record's simple `Key: value` lines.
 * @param {string} chunk
 * @returns {object}
 */
function parseUnit(chunk) {
    const get = (key) => {
        const match = chunk.match(new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*(.*)$', 'm'));
        return match ? match[1].trim() : '';
    };
    return {
        name: get('Name'),
        class: get('Class'),
        affinity: get('Affinity'),
        school: Number.parseInt(get('School'), 10),
        statSet: get('Stat set'),
        skillSet: get('Skill set'),
        itemSet: get('Item set'),
        outfit: get('Outfit'),
        tintSet: get('Tint set'),
    };
}

/**
 * Build the catalog for one mod. Callers should use getCatalog() so the mtime
 * cache is shared.
 * @param {string} modName
 * @returns {object}
 */
function build(modName) {
    const paths = helpers.getModFilePaths(modName);
    const schoolsFile = path.join(paths.modPath, 'data', 'units', 'schools.txt');

    const lookup = helpers.loadLookupText(paths.lookupFilePath);
    const idToText = lookup.idToText || {};

    const classes = [];
    for (const chunk of helpers.splitClassRecords(helpers.readTextFile(paths.classdefsPath))) {
        const data = helpers.parseClassChunk(chunk);
        if (!data || !data.className || data.className.startsWith('//')) continue;
        classes.push({
            code: data.className,
            displayName: idToText[data.DISPLAYNAMEID] || data.className,
            skillUseName: (data.skillUseName || '').replace(/"/g, '').trim(),
            itemCatCount: data.weapons.length + data.armors.length + data.helmets.length
                + data.shields.length + data.accessories.length,
            attributes: data.attributes,
        });
    }

    const displayCounts = new Map();
    for (const cls of classes) {
        displayCounts.set(cls.displayName, (displayCounts.get(cls.displayName) || 0) + 1);
    }
    const sharedNames = new Set([...displayCounts].filter(([, count]) => count > 1).map(([name]) => name));
    for (const cls of classes) cls.label = helpers.labelClass(cls.displayName, cls.code, sharedNames);

    const units = [];
    for (const chunk of helpers.splitContentIntoChunks(helpers.readTextFile(paths.gladiatorsFilePath))) {
        if (!/^Name:/m.test(chunk)) continue;
        const unit = parseUnit(chunk);
        if (unit.name && unit.class) units.push(unit);
    }

    const recruitNames = new Set();
    if (fs.existsSync(paths.leaguesPath)) {
        for (const file of fs.readdirSync(paths.leaguesPath).filter((name) => name.endsWith('.tok'))) {
            const content = helpers.readTextFile(path.join(paths.leaguesPath, file));
            for (const match of content.matchAll(/^RECRUIT\s+"([^"]+)"/gm)) {
                recruitNames.add(match[1].trim().toLowerCase());
            }
        }
    }

    const schoolNames = new Map();
    if (fs.existsSync(schoolsFile)) {
        for (const line of helpers.readTextFile(schoolsFile).split(/\r?\n/)) {
            const match = line.match(/^(\d+):\s*(.*)$/);
            if (match) schoolNames.set(Number.parseInt(match[1], 10), match[2].trim());
        }
    }

    const statsetIds = new Set();
    if (fs.existsSync(paths.statsetsFilePath)) {
        for (const match of helpers.readTextFile(paths.statsetsFilePath).matchAll(/^Statset\s+(\d+):/gm)) {
            statsetIds.add(Number.parseInt(match[1], 10));
        }
    }

    const unitsByClass = new Map();
    for (const unit of units) {
        if (!unitsByClass.has(unit.class)) unitsByClass.set(unit.class, []);
        unitsByClass.get(unit.class).push(unit);
    }

    for (const cls of classes) {
        const list = unitsByClass.get(cls.code) || [];
        cls.units = list;
        cls.unitCount = list.length;
        cls.schoolLocations = [...new Set(list
            .filter((unit) => unit.school > 0 && schoolNames.has(unit.school))
            .map((unit) => schoolNames.get(unit.school)))];
        cls.leagueUnits = list.filter((unit) => recruitNames.has(unit.name.toLowerCase()));
        cls.hasStats = list.some((unit) => statsetIds.has(Number.parseInt(unit.statSet, 10)));
        cls.isLocationless = list.length > 0 && cls.schoolLocations.length === 0 && cls.leagueUnits.length === 0;
        // Objects are the only classes that cannot be characters: they never
        // move and have no equipment categories. Everything else is a unit.
        cls.isObject = cls.itemCatCount === 0 && cls.attributes.some((attr) => String(attr).toLowerCase() === 'doesntmove');
    }

    const byCode = new Map();
    const byLabel = new Map();
    const byDisplay = new Map();
    const bySkillUse = new Map();
    for (const cls of classes) {
        byCode.set(cls.code.toLowerCase(), cls);
        byLabel.set(cls.label.toLowerCase(), cls);
        const key = cls.displayName.toLowerCase();
        if (!byDisplay.has(key)) byDisplay.set(key, []);
        byDisplay.get(key).push(cls);
        if (cls.skillUseName) {
            const useKey = cls.skillUseName.toLowerCase();
            if (!bySkillUse.has(useKey)) bySkillUse.set(useKey, []);
            bySkillUse.get(useKey).push(cls);
        }
    }

    return {
        modName,
        classes,
        byCode,
        byLabel,
        byDisplay,
        bySkillUse,
        schoolNames,
        statsetIds,
        // A class is offered for recruits if it has units. Event grants live in
        // scripts, so the absence of a league/school location is not exclusion.
        recruitClasses: classes.filter((cls) => cls.unitCount > 0 && !cls.isObject),
        statClasses: classes.filter((cls) => cls.hasStats && !cls.isObject),
    };
}

/**
 * Get the cached catalog for a mod.
 * @param {string} modName
 * @returns {object}
 */
function getCatalog(modName) {
    const paths = helpers.getModFilePaths(modName);
    const schoolsFile = path.join(paths.modPath, 'data', 'units', 'schools.txt');
    const stamp = [
        paths.classdefsPath,
        paths.gladiatorsFilePath,
        paths.statsetsFilePath,
        paths.lookupFilePath,
        paths.leaguesPath,
        schoolsFile,
    ].map(fileStamp).join('|');

    const key = paths.modPath;
    const cached = cache.get(key);
    if (cached && cached.stamp === stamp) return cached.catalog;

    const catalog = build(modName);
    cache.set(key, { stamp, catalog });
    return catalog;
}

/**
 * Resolve a typed class value to one or more classes.
 *
 * Accepted, in order: CREATECLASS code (exact), "Display (Code)" label (exact),
 * bare display name (all classes sharing it), and SKILLUSENAME (shared list).
 *
 * @param {string} input
 * @param {object} catalog
 * @returns {?{codes: string[], exact: boolean, displayName: string, label: string}}
 */
function resolveClassInput(input, catalog) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();

    const byLabel = catalog.byLabel.get(lower);
    if (byLabel) {
        return { codes: [byLabel.code], exact: true, displayName: byLabel.displayName, label: byLabel.label };
    }

    // A bare display name shared by several classes means the family; the
    // autocomplete submits the disambiguated label, so a selected entry stays
    // exact. A class code is checked after this so "Archer" (code and display)
    // is the family, while "ArcherF" stays exact.
    const byDisplay = catalog.byDisplay.get(lower);
    if (byDisplay && byDisplay.length > 1) {
        // A shared display name means the family. If every class in the group
        // shares one SKILLUSENAME (Archer / ArcherF), the family is that skill
        // list's classes; Hero (Ursula/Valens/Usus) has no single skill list, so
        // the whole display group is the family.
        const codeMatch = catalog.byCode.get(lower);
        const uses = new Set(byDisplay.map((cls) => cls.skillUseName.toLowerCase()).filter(Boolean));
        let family;
        if (codeMatch && codeMatch.skillUseName) {
            family = catalog.bySkillUse.get(codeMatch.skillUseName.toLowerCase()) || byDisplay;
        } else if (uses.size === 1) {
            family = catalog.bySkillUse.get([...uses][0]) || byDisplay;
        } else {
            family = byDisplay;
        }
        return {
            codes: family.map((cls) => cls.code),
            exact: false,
            displayName: byDisplay[0].displayName,
            label: byDisplay[0].displayName,
        };
    }

    const byCode = catalog.byCode.get(lower);
    if (byCode) {
        return { codes: [byCode.code], exact: true, displayName: byCode.displayName, label: byCode.label };
    }

    if (byDisplay && byDisplay.length === 1) {
        const only = byDisplay[0];
        return { codes: [only.code], exact: true, displayName: only.displayName, label: only.label };
    }

    const byUse = catalog.classes.filter((cls) => cls.skillUseName && cls.skillUseName.toLowerCase() === lower);
    if (byUse.length) {
        return {
            codes: byUse.map((cls) => cls.code),
            exact: false,
            displayName: byUse[0].displayName,
            label: byUse[0].label,
        };
    }

    return null;
}

/**
 * The skill-use names covered by a resolved class input.
 * @param {object} resolved
 * @param {object} catalog
 * @returns {Set<string>}
 */
function skillUseNamesFor(resolved, catalog) {
    const names = new Set();
    for (const code of resolved.codes) {
        const cls = catalog.byCode.get(String(code).toLowerCase());
        if (cls && cls.skillUseName) names.add(cls.skillUseName.toLowerCase());
    }
    return names;
}

/**
 * Autocomplete choices for a class list.
 * @param {object[]} classes
 * @param {string} focused
 * @returns {{name: string, value: string}[]}
 */
function classChoices(classes, focused) {
    const needle = String(focused || '').toLowerCase();
    return classes
        .filter((cls) => cls.label.toLowerCase().includes(needle) || cls.code.toLowerCase().includes(needle))
        .sort((a, b) => a.label.localeCompare(b.label))
        .slice(0, 25)
        .map((cls) => ({ name: cls.label, value: cls.label }));
}

module.exports = {
    getCatalog,
    resolveClassInput,
    skillUseNamesFor,
    classChoices,
};




