'use strict';

/**
 * Boot preflight: keeps node_modules in lockstep with package-lock.json.
 *
 * The deploy webhook only runs `git pull` and restarts the unit -- it never
 * touches node_modules. That is the drift vector: a pushed package.json would
 * ship to disk while the bot kept loading the packages it already had, and a
 * hand-installed package on the server would never reach the repo.
 *
 * This runs before any third-party require() and does three things:
 *
 *   1. Verifies every locked package is installed at the locked version.
 *   2. If node_modules is absent or drifted, installs from the lock into a
 *      staging directory and swaps it in, so a failed install leaves the
 *      working tree untouched instead of half-deleted.
 *   3. Records a marker so later boots skip the work, and reports packages
 *      that are installed but absent from the lock (the `npm i` hotfix path).
 *
 * Failures are fail-closed: the boot aborts with a log line in
 * logs/preflight.log, on stdout (captured by the unit's redirect) and as a
 * Discord alert via dsh-notify.
 *
 * Env:
 *   USUSBOT_SKIP_DEP_SYNC=1     -- skip verification and installation entirely
 *   USUSBOT_FORCE_DEP_INSTALL=1 -- reinstall even when the tree already matches
 *
 * CLI:
 *   node tools/preflight.js --check   -- verify only, exit 1 on drift
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LOCK_PATH = path.join(ROOT, 'package-lock.json');
const PKG_PATH = path.join(ROOT, 'package.json');
const NM = path.join(ROOT, 'node_modules');
const MARKER = path.join(NM, '.ususbot-installed');
const STAGING = path.join(ROOT, 'deps-staging');
const PREV = path.join(ROOT, 'node_modules.prev');
const LOG_PATH = path.join(ROOT, 'logs', 'preflight.log');
const NOTIFY = '/usr/local/bin/dsh-notify';
const MAX_LOG_BYTES = 512 * 1024;

function log(level, message) {
    const line = `[${new Date().toISOString()}] ${level} ${message}`;
    if (level === 'ERROR' || level === 'WARN') {
        console.error(line);
    } else {
        console.log(line);
    }
    try {
        fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
        const size = fs.existsSync(LOG_PATH) ? fs.statSync(LOG_PATH).size : 0;
        if (size > MAX_LOG_BYTES) fs.renameSync(LOG_PATH, LOG_PATH + '.1');
        fs.appendFileSync(LOG_PATH, line + '\n');
    } catch (_) {
        /* logging must never be the reason a boot fails */
    }
}

/** Cap a problem list so one broken install cannot flood the log. */
function summarize(problems) {
    const shown = problems.slice(0, 8).join('\n  ');
    return problems.length > 8 ? `${shown}\n  ... and ${problems.length - 8} more` : shown;
}

function notify(subject, detail) {    if (process.platform === 'win32') return;
    try {
        if (!fs.existsSync(NOTIFY)) return;
        spawnSync(NOTIFY, ['error', subject, String(detail).slice(0, 1500)], { timeout: 8000 });
    } catch (_) {
        /* the alert is best-effort */
    }
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Lock entries for top-level packages only (nested copies resolve themselves). */
function lockedTopLevel(lock) {
    const out = new Map();
    for (const [rel, meta] of Object.entries(lock.packages || {})) {
        if (!rel.startsWith('node_modules/')) continue;
        const name = rel.slice('node_modules/'.length);
        if (name.includes('/node_modules/')) continue;
        if (!meta || typeof meta.version !== 'string') continue;
        out.set(name, meta);
    }
    return out;
}

function installedVersion(name) {
    try {
        return readJson(path.join(NM, name, 'package.json')).version || null;
    } catch (_) {
        return null;
    }
}

function verify(lock) {
    const problems = [];
    const locked = lockedTopLevel(lock);

    for (const [name, meta] of locked) {
        // optional deps are filtered by os/cpu at install time; dev deps are
        // omitted on purpose (--omit=dev), so neither is a drift signal.
        if (meta.optional === true || meta.dev === true) continue;
        const have = installedVersion(name);
        if (have === null) {
            problems.push(`${name}@${meta.version} is not installed`);
        } else if (have !== meta.version) {
            problems.push(`${name}: ${have} installed, ${meta.version} locked`);
        }
    }

    let declared = {};
    try {
        declared = readJson(PKG_PATH).dependencies || {};
    } catch (_) {
        /* a missing/invalid package.json is caught by the lock read */
    }
    for (const name of Object.keys(declared)) {
        if (!locked.has(name)) problems.push(`${name} is declared but absent from the lock`);
    }

    return problems;
}

/** Packages present in node_modules that the lock knows nothing about. */
function unlockedPackages(lock) {
    const locked = lockedTopLevel(lock);
    const extras = [];
    let entries;
    try {
        entries = fs.readdirSync(NM, { withFileTypes: true });
    } catch (_) {
        return extras;
    }
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (entry.name.startsWith('@')) {
            let scoped = [];
            try {
                scoped = fs.readdirSync(path.join(NM, entry.name));
            } catch (_) { /* unreadable scope dir */ }
            for (const name of scoped) {
                const full = `${entry.name}/${name}`;
                if (!locked.has(full)) extras.push(full);
            }
            continue;
        }
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        if (!locked.has(entry.name)) extras.push(entry.name);
    }
    return extras;
}

function reportUnlocked(lock) {
    const extras = unlockedPackages(lock);
    if (!extras.length) return;
    const shown = extras.slice(0, 10).join(', ');
    log('WARN', `${extras.length} package(s) installed but absent from package-lock.json: `
        + shown + (extras.length > 10 ? ' ...' : '')
        + ' (server-side `npm i` is not durable -- add it to package.json and push)');
}

function readMarker() {
    try {
        return fs.readFileSync(MARKER, 'utf8').trim();
    } catch (_) {
        return null;
    }
}

function writeMarker(hash) {
    try {
        fs.mkdirSync(NM, { recursive: true });
        fs.writeFileSync(MARKER, hash + '\n');
    } catch (error) {
        log('WARN', `could not write install marker: ${error.message}`);
    }
}

function npmCommand() {
    const suffix = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const bundled = path.join(path.dirname(process.execPath), suffix);
    return fs.existsSync(bundled) ? bundled : 'npm';
}

function install(lockHash) {
    log('INFO', 'installing node_modules from package-lock.json');
    fs.rmSync(STAGING, { recursive: true, force: true });
    fs.mkdirSync(STAGING, { recursive: true });
    fs.copyFileSync(PKG_PATH, path.join(STAGING, 'package.json'));
    fs.copyFileSync(LOCK_PATH, path.join(STAGING, 'package-lock.json'));

    const result = spawnSync(
        npmCommand(),
        ['ci', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'],
        { cwd: STAGING, encoding: 'utf8', timeout: 10 * 60 * 1000, env: process.env },
    );

    const staged = path.join(STAGING, 'node_modules');
    if (result.error || result.status !== 0 || !fs.existsSync(staged)) {
        const output = String(result.stderr || result.stdout || '').trim().slice(-1200);
        const detail = result.error ? result.error.message : `exit ${result.status}: ${output}`;
        log('ERROR', `npm ci failed: ${detail}`);
        fs.rmSync(STAGING, { recursive: true, force: true });
        throw new Error(`npm ci failed (${detail})`);
    }

    // Swap only once the staged tree exists; the live tree is restored if the
    // rename fails, so a boot can never be left without node_modules.
    fs.rmSync(PREV, { recursive: true, force: true });
    try {
        if (fs.existsSync(NM)) fs.renameSync(NM, PREV);
        fs.renameSync(staged, NM);
    } catch (error) {
        log('ERROR', `could not swap in the staged tree: ${error.message}`);
        if (!fs.existsSync(NM) && fs.existsSync(PREV)) {
            try {
                fs.renameSync(PREV, NM);
            } catch (restoreError) {
                log('ERROR', `could not restore the previous tree: ${restoreError.message}`);
            }
        }
        fs.rmSync(STAGING, { recursive: true, force: true });
        throw error;
    }

    fs.rmSync(PREV, { recursive: true, force: true });
    fs.rmSync(STAGING, { recursive: true, force: true });
    writeMarker(lockHash);
}

function run(options = {}) {
    if (process.env.USUSBOT_SKIP_DEP_SYNC === '1') {
        log('INFO', 'dependency sync skipped (USUSBOT_SKIP_DEP_SYNC=1)');
        return;
    }

    let lock;
    let lockHash;
    try {
        const raw = fs.readFileSync(LOCK_PATH);
        lockHash = crypto.createHash('sha256').update(raw).digest('hex');
        lock = JSON.parse(raw.toString('utf8'));
    } catch (error) {
        log('ERROR', `cannot read package-lock.json: ${error.message}`);
        if (options.checkOnly) return;
        process.exit(1);
    }

    const problems = verify(lock);

    if (options.checkOnly) {
        if (problems.length) {
            log('ERROR', `dependency check failed:\n  ${summarize(problems)}`);
            process.exit(1);
        }
        log('INFO', `dependency check passed (${lockedTopLevel(lock).size} packages)`);
        return;
    }

    const count = lockedTopLevel(lock).size;
    const marked = readMarker() === lockHash;
    const forced = process.env.USUSBOT_FORCE_DEP_INSTALL === '1';

    if (!problems.length && (marked || !forced)) {
        writeMarker(lockHash);
        log('INFO', marked
            ? `dependencies verified (${count} packages)`
            : `adopted existing install (${count} packages)`);
        reportUnlocked(lock);
        return;
    }

    log('WARN', problems.length
        ? `node_modules drifted from the lock:\n  ${summarize(problems)}`
        : 'forced reinstall requested (USUSBOT_FORCE_DEP_INSTALL=1)');

    try {
        install(lockHash);
    } catch (error) {
        notify('ususbot preflight', `dependency install failed: ${error.message}`);
        process.exit(1);
    }

    const remaining = verify(lock);
    if (remaining.length) {
        log('ERROR', `install did not satisfy the lock:\n  ${summarize(remaining)}`);
        notify('ususbot preflight',
            `node_modules still does not match package-lock.json:\n${remaining.slice(0, 8).join('\n')}`);
        process.exit(1);
    }

    log('INFO', `dependencies installed and verified (${count} packages)`);
    reportUnlocked(lock);
}

if (require.main === module) {
    run({ checkOnly: process.argv.includes('--check') });
}

module.exports = { run };
