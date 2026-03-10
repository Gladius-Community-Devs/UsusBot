const fs = require('fs');
const path = require('path');

function getModdersFilePath() {
    const configured = process.env.ALLOWED_MODDERS_FILE;
    if (!configured || !configured.trim()) {
        throw new Error('ALLOWED_MODDERS_FILE is not set. Configure it in the bot environment.');
    }

    if (process.platform !== 'win32' && configured.startsWith('\\\\')) {
        throw new Error(`ALLOWED_MODDERS_FILE appears to be a Windows UNC path (${configured}) but the bot is running on Linux. Use an absolute Linux path such as /var/www/gladiuscommunity/config/allowed_modders.json.`);
    }

    return path.resolve(configured);
}

function normalizeModNames(value) {
    if (Array.isArray(value)) {
        return [...new Set(value.map(v => `${v}`.trim()).filter(Boolean))];
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? [trimmed] : [];
    }

    return [];
}

function readModders() {
    const filePath = getModdersFilePath();
    if (!fs.existsSync(filePath)) {
        throw new Error(`Shared modders file does not exist at ${filePath}`);
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Invalid modders format in ${filePath}. Expected object mapping Discord IDs to mod name(s).`);
    }

    return parsed;
}

function writeModders(modders) {
    const filePath = getModdersFilePath();
    fs.writeFileSync(filePath, JSON.stringify(modders, null, 4));
}

function getModNamesForDiscordId(modders, discordId) {
    return normalizeModNames(modders[discordId]);
}

module.exports = {
    getModdersFilePath,
    normalizeModNames,
    readModders,
    writeModders,
    getModNamesForDiscordId
};