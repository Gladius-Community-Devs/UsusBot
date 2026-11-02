'use strict';

/**
 * Reverse prize lookup: item -> leagues/encounters that award it.
 *
 * The forward commands only know "what can this league award?". This index
 * reads prizes.tok plus the league files and builds the inverse. It uses the
 * shared item index so raw names (ITEMCREATE) and display names both resolve.
 */

const fs = require('fs');
const path = require('path');
const helpers = require('./functions');
const { buildItemIndex, normalize } = require('./item_index');

const cache = new Map();

function unquote(value) {
    return `${value || ''}`.trim().replace(/^"|"$/g, '').trim();
}

function parseGameRecord(chunk) {
    const data = {};
    for (const line of chunk.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//')) continue;
        const match = trimmed.match(/^([A-Z0-9_]+)(?::|\s)\s*(.*)$/);
        if (!match) continue;
        const key = match[1];
        if (!data[key]) data[key] = [];
        data[key].push(match[2].trim());
    }
    return data;
}

function tierName(tier) {
    switch (tier) {
        case 0: return 'Amateur';
        case 1: return 'Semi-Pro';
        case 2: return 'Pro';
        default: return `Tier ${tier}`;
    }
}

function parseReference(value) {
    const text = `${value || ''}`.trim();
    const quoted = text.match(/^"([^"]+)"\s+(\d+)/);
    const plain = text.match(/^(\S+)\s+(\d+)/);
    const match = quoted || plain;
    if (!match) return null;
    return { name: match[1].trim(), tier: Number.parseInt(match[2], 10) };
}

function parsePrizeItem(value) {
    const text = `${value || ''}`.trim();
    const quoted = text.match(/^"([^"]+)"/);
    if (quoted) return unquote(quoted[1]);
    return unquote(text.replace(/"/g, '').split('\t')[0]);
}

function resolvePrize(prizes, reference, bucket) {
    const name = reference.name;
    let candidates = [name];
    if (bucket === 'Mastery') {
        const base = name.replace(/_Mastery$/i, '');
        candidates = name.endsWith('_Mastery') ? [name] : [`${base}_Mastery`, name, base];
    }
    return candidates.find(prizeName => prizes.has(prizeName)) || null;
}

function buildPrizeIndex(modName) {
    const paths = helpers.getModFilePaths(modName);
    const itemIndex = buildItemIndex(modName);

    const prizeStat = fs.statSync(paths.prizesFilePath);
    const leagueFiles = fs.readdirSync(paths.leaguesPath).filter(file => file.endsWith('.tok'));
    const leagueStamps = leagueFiles.map(file => {
        const stat = fs.statSync(path.join(paths.leaguesPath, file));
        return `${file}:${stat.size}:${stat.mtimeMs}`;
    });
    const stamp = [
        prizeStat.size,
        prizeStat.mtimeMs,
        ...leagueStamps
    ].join('|');

    const cached = cache.get(paths.modPath);
    if (cached && cached.stamp === stamp) return cached.index;

    const prizes = new Map();
    for (const chunk of helpers.splitContentIntoChunks(helpers.readTextFile(paths.prizesFilePath))) {
        if (!chunk.includes('PRIZE')) continue;
        const data = parseGameRecord(chunk);
        const rawName = data.PRIZE?.[0];
        if (!rawName) continue;
        const name = unquote(rawName);
        prizes.set(name, {
            name,
            items: (data.PRIZEITEM || []).map(parsePrizeItem).filter(Boolean)
        });
    }

    const sourceItems = new Map(); // itemKey -> Map<sourceKey, source>
    const autocomplete = new Set();
    const idToName = itemIndex.idToName;

    for (const file of leagueFiles) {
        const content = helpers.readTextFile(path.join(paths.leaguesPath, file));
        const office = content.match(/OFFICENAME\s+"[^"]*",\s*(\d+)/);
        const arena = office && idToName.get(Number.parseInt(office[1], 10))
            ? idToName.get(Number.parseInt(office[1], 10))
            : file.replace(/_leagues\.tok$/i, '').replace(/\.tok$/i, '');

        for (const chunk of helpers.splitContentIntoChunks(content)) {
            const data = parseGameRecord(chunk);
            const leagueName = data.LEAGUE?.[0];
            const encounterName = data.ENCOUNTER?.[0];
            if (!leagueName && !encounterName) continue;

            const isLeague = Boolean(leagueName);
            const head = isLeague ? leagueName : encounterName;
            const headMatch = `${head}`.match(/^"([^"]+)",\s*(\d+)/);
            if (!headMatch) continue;
            const sourceName = idToName.get(Number.parseInt(headMatch[2], 10)) || headMatch[1];
            const sourceType = isLeague ? 'League' : 'Encounter';

            const refs = [];
            if (isLeague) {
                for (const value of data.PRIZECOMPLETION || []) {
                    const ref = parseReference(value);
                    if (ref) refs.push({ ...ref, bucket: 'Completion' });
                }
                for (const value of data.PRIZEMASTERY || []) {
                    const ref = parseReference(value);
                    if (ref) refs.push({ ...ref, bucket: 'Mastery' });
                }
            } else {
                for (const value of data.PRIZETIER || []) {
                    const ref = parseReference(value);
                    if (ref) refs.push({ ...ref, bucket: 'Tier' });
                }
            }

            for (const reference of refs) {
                const prizeName = resolvePrize(prizes, reference, reference.bucket);
                if (!prizeName) continue;
                const prize = prizes.get(prizeName);
                for (const rawItem of prize.items) {
                    autocomplete.add(rawItem);
                    const resolved = itemIndex.byAlias.get(normalize(rawItem));
                    const itemKey = normalize(resolved ? resolved.rawName : rawItem);
                    if (!sourceItems.has(itemKey)) sourceItems.set(itemKey, new Map());
                    const sources = sourceItems.get(itemKey);
                    const sourceKey = `${sourceType}|${arena}|${sourceName}`;
                    if (!sources.has(sourceKey)) {
                        sources.set(sourceKey, {
                            type: sourceType,
                            name: sourceName,
                            arena,
                            buckets: new Map()
                        });
                    }
                    const source = sources.get(sourceKey);
                    if (!source.buckets.has(reference.bucket)) source.buckets.set(reference.bucket, new Set());
                    source.buckets.get(reference.bucket).add(reference.tier);
                }
            }
        }
    }

    const sourcesByItem = new Map();
    for (const [itemKey, sourceMap] of sourceItems) {
        const sources = [...sourceMap.values()]
            .map(source => ({
                type: source.type,
                name: source.name,
                arena: source.arena,
                buckets: [...source.buckets.entries()]
                    .map(([bucket, tiers]) => ({
                        bucket,
                        tiers: [...tiers].sort((a, b) => a - b)
                    }))
                    .sort((a, b) => a.bucket.localeCompare(b.bucket))
            }))
            .sort((a, b) => {
                const arenaCmp = a.arena.localeCompare(b.arena, undefined, { sensitivity: 'base' });
                if (arenaCmp !== 0) return arenaCmp;
                const typeCmp = a.type.localeCompare(b.type, undefined, { sensitivity: 'base' });
                if (typeCmp !== 0) return typeCmp;
                return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
            });
        sourcesByItem.set(itemKey, sources);
    }

    const index = {
        modName,
        itemNames: [...autocomplete].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
        sourcesByItem,
        findItem(query) {
            const key = normalize(query);
            if (!key) return null;
            const exact = itemIndex.byAlias.get(key);
            if (exact) return exact;
            // Prize pools occasionally contain an item name that is absent from
            // items.tok (stale data or a renamed variant). Keep those searchable
            // by their prize-pool name instead of hiding the source.
            if (sourcesByItem.has(key)) {
                return {
                    displayName: query.trim(),
                    rawName: query.trim(),
                    aliases: [key],
                    synthetic: true
                };
            }
            const match = itemIndex.records.find(record =>
                record.aliases.some(alias => alias.includes(key))
            ) || [...sourcesByItem.keys()].find(candidate => candidate.includes(key));
            if (!match) return null;
            if (typeof match === 'string') {
                return {
                    displayName: match,
                    rawName: match,
                    aliases: [match],
                    synthetic: true
                };
            }
            return match;
        },
        getSources(query) {
            const item = this.findItem(query);
            if (!item) return null;
            return {
                item,
                sources: sourcesByItem.get(normalize(item.rawName || item.displayName)) || []
            };
        }
    };

    cache.set(paths.modPath, { stamp, index });
    return index;
}

function clearPrizeIndexCache() {
    cache.clear();
}

module.exports = {
    buildPrizeIndex,
    clearPrizeIndexCache,
    tierName
};
