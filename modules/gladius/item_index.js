'use strict';

/**
 * Normalized item identity for the item-focused bot commands.
 *
 * The game files can carry a raw ITEMCREATE name and a different localized
 * display name (for example Light Badge of Victus -> Badge of Victus).
 * Searching only one of those names makes autocomplete and execute disagree,
 * so every command should use this index.
 */

const fs = require('fs');
const helpers = require('./functions');

const cache = new Map();

function normalize(value) {
    return `${value || ''}`
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function unquote(value) {
    return `${value || ''}`.trim().replace(/^"|"$/g, '').trim();
}

function parseLookup(path) {
    const idToName = new Map();
    if (!path || !fs.existsSync(path)) return idToName;
    for (const line of helpers.readTextFile(path).split(/\r?\n/)) {
        if (!line.includes('^')) continue;
        const fields = line.split('^');
        const id = Number.parseInt(fields[0], 10);
        const name = unquote(fields[fields.length - 1]);
        if (Number.isFinite(id) && name) idToName.set(id, name);
    }
    return idToName;
}

function parseRawName(itemData) {
    const create = Array.isArray(itemData.ITEMCREATE) ? itemData.ITEMCREATE[0] : '';
    const quoted = `${create || ''}`.match(/^\s*"([^"]+)"/);
    const plain = `${create || ''}`.match(/^\s*([^,\r\n]+)/);
    return unquote(quoted ? quoted[1] : plain ? plain[1] : create);
}

function buildItemIndex(modName) {
    const paths = helpers.getModFilePaths(modName);
    const itemsStat = fs.statSync(paths.itemsFilePath);
    const lookupStat = fs.existsSync(paths.lookupFilePath) ? fs.statSync(paths.lookupFilePath) : null;
    const stamp = [
        paths.itemsFilePath,
        itemsStat.size,
        itemsStat.mtimeMs,
        lookupStat ? lookupStat.size : 0,
        lookupStat ? lookupStat.mtimeMs : 0
    ].join(':');

    const cached = cache.get(paths.modPath);
    if (cached && cached.stamp === stamp) return cached.index;

    const idToName = parseLookup(paths.lookupFilePath);
    const records = [];
    const byAlias = new Map();
    const names = new Set();

    for (const chunk of helpers.splitItemRecords(helpers.readTextFile(paths.itemsFilePath))) {
        if (!chunk.includes('ITEMCREATE:')) continue;
        const itemData = helpers.parseChunk(chunk);
        const rawName = parseRawName(itemData);
        if (!rawName) continue;

        const displayId = itemData.ITEMDISPLAYNAMEID
            ? Number.parseInt(itemData.ITEMDISPLAYNAMEID[0], 10)
            : null;
        const displayName = Number.isFinite(displayId) && idToName.get(displayId)
            ? idToName.get(displayId)
            : rawName;

        const aliases = [...new Set([displayName, rawName].map(normalize).filter(Boolean))];
        const record = {
            rawName,
            displayName,
            aliases,
            searchText: [displayName, rawName, itemData.ITEMTYPE?.[0], itemData.ITEMSUBTYPE?.[0]]
                .filter(Boolean)
                .join(' ')
                .toLowerCase(),
            itemData,
            chunk,
            matches(query) {
                const needle = normalize(query);
                return Boolean(needle) && this.searchText.includes(needle);
            }
        };

        records.push(record);
        names.add(displayName);
        names.add(rawName);
        for (const alias of aliases) {
            if (!byAlias.has(alias)) byAlias.set(alias, record);
        }
    }

    const index = {
        modName,
        paths,
        idToName,
        records,
        names: [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
        byAlias,
        find(query) {
            const key = normalize(query);
            if (!key) return null;
            return byAlias.get(key)
                || records.find(record => record.aliases.some(alias => alias.includes(key)))
                || null;
        },
        search(query) {
            const key = normalize(query);
            if (!key) return [];
            return records.filter(record => record.matches(key));
        }
    };

    cache.set(paths.modPath, { stamp, index });
    return index;
}

function clearItemIndexCache() {
    cache.clear();
}

module.exports = {
    buildItemIndex,
    clearItemIndexCache,
    normalize,
    unquote
};
