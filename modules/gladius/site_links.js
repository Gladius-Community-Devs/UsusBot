'use strict';

/**
 * Deep links from Discord replies to the community site. The site accepts
 * mod/class/skill/name/level query parameters on the pages built in P0/P1.
 */

const SITE_BASE = (process.env.GLADIUS_SITE_URL || 'https://gladiuscommunity.com').replace(/\/+$/, '');

function pageUrl(pathname, params = {}) {
    const url = new URL(pathname, SITE_BASE + '/');
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || `${value}`.trim() === '') continue;
        url.searchParams.set(key, `${value}`.trim());
    }
    return url.toString();
}

function classUrl(modName, className) {
    return pageUrl('/classes', { mod: modName, class: className });
}

function recruitsUrl(modName, className) {
    return pageUrl('/recruits', { mod: modName, class: className });
}

function statsUrl(modName, className, level) {
    return pageUrl('/stats', { mod: modName, class: className, level });
}

function skillUrl(modName, skillName) {
    return pageUrl('/skills', { mod: modName, q: skillName, mode: 'skill' });
}

function explainUrl(modName, skillName) {
    return pageUrl('/skills', { mod: modName, q: skillName, mode: 'explain' });
}

function prizeUrl(modName, name) {
    return pageUrl('/prizes', { mod: modName, name });
}

function itemSkillUrl(modName, query) {
    return pageUrl('/itemskills', { mod: modName, q: query });
}

function modListUrl() {
    return pageUrl('/modlist');
}

module.exports = {
    SITE_BASE,
    pageUrl,
    classUrl,
    recruitsUrl,
    statsUrl,
    skillUrl,
    explainUrl,
    prizeUrl,
    itemSkillUrl,
    modListUrl
};
