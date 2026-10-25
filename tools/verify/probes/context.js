'use strict';

/**
 * Shared state for the verification probes: module discovery, the finding
 * collector, and small helpers every probe uses.
 */

const fs = require('fs');
const path = require('path');
const lib = require('../lib');
const data = require('../data');

/**
 * @param {object} options
 * @param {string} options.dataRoot
 * @returns {object}
 */
function createContext(options) {
  const dataRoot = options.dataRoot;
  const logger = lib.createLogger();
  const { modules, disabled, handler } = lib.discoverModules(logger);
  const api = lib.createFakeApi(lib.defaultApiResponder);
  const mods = data.discoverMods(dataRoot);
  const indexes = new Map();
  for (const mod of mods) indexes.set(mod, data.loadMod(dataRoot, mod));

  return {
    dataRoot,
    logger,
    modules,
    disabled,
    handler,
    api,
    mods,
    indexes,
    findings: [],
    stats: {},
    startTime: Date.now(),
  };
}

/**
 * Record one finding.
 * @param {object} ctx
 * @param {object} finding
 * @returns {object} the stored finding
 */
function addFinding(ctx, finding) {
  const id = `F${String(ctx.findings.length + 1).padStart(3, '0')}`;
  const stored = {
    id,
    severity: 'medium',
    area: 'general',
    subject: '',
    expected: '',
    actual: '',
    evidence: '',
    repro: '',
    ownerQuestion: null,
    ...finding,
  };
  ctx.findings.push(stored);
  return stored;
}

/**
 * Read every .js file under a directory.
 * @param {string} dir
 * @param {string[]} [skip]
 * @returns {{file: string, text: string}[]}
 */
function readSources(dir, skip = []) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || skip.includes(entry.name)) continue;
        walk(full);
        continue;
      }
      if (entry.name.endsWith('.js')) {
        out.push({ file: full, text: fs.readFileSync(full, 'utf8') });
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * Run a slash command and validate everything it sent.
 * @param {object} ctx
 * @param {string} name
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function run(ctx, name, options = {}) {
  const result = await lib.runCommand(ctx.modules, name, options, {
    handler: ctx.handler,
    api: ctx.api,
  });
  const payloads = result.state.payloads;
  const problems = [];
  for (const entry of payloads) {
    for (const problem of lib.validatePayload(entry.payload)) {
      problems.push(`${entry.kind}: ${problem}`);
    }
  }
  return {
    name,
    result,
    payloads,
    text: payloads.map((p) => lib.payloadText(p.payload)).join('\n'),
    problems,
    violations: result.state.violations,
    thrown: result.thrown,
    durationMs: result.durationMs,
  };
}

/**
 * Dispatch a component interaction through the gladius event handler.
 * @param {object} ctx
 * @param {string} customId
 * @param {string[]} [valueList]
 * @returns {Promise<object>}
 */
async function component(ctx, customId, valueList = []) {
  if (!ctx.componentHandler) {
    ctx.componentHandler = lib.loadComponentHandler(ctx.logger);
  }
  const { interaction, state } = lib.createComponentInteraction({ customId, valueList });
  const started = Date.now();
  let thrown = null;
  try {
    await ctx.componentHandler(interaction);
  } catch (error) {
    thrown = error;
  }
  const payloads = state.payloads;
  const problems = [];
  for (const entry of payloads) {
    for (const problem of lib.validatePayload(entry.payload)) {
      problems.push(`${entry.kind}: ${problem}`);
    }
  }
  return {
    customId,
    payloads,
    text: payloads.map((p) => lib.payloadText(p.payload)).join('\n'),
    problems,
    violations: state.violations,
    thrown,
    durationMs: Date.now() - started,
    replied: state.replied,
  };
}

/**
 * Deterministic sample: first `count` items plus every `every`-th item after.
 * @template T
 * @param {T[]} items
 * @param {number} count
 * @param {number} every
 * @returns {T[]}
 */
function sample(items, count = 10, every = 37) {
  const picked = [];
  const seen = new Set();
  const push = (item) => {
    const key = typeof item === 'string' ? item : JSON.stringify(item);
    if (seen.has(key)) return;
    seen.add(key);
    picked.push(item);
  };
  for (let i = 0; i < Math.min(count, items.length); i++) push(items[i]);
  for (let i = count; i < items.length; i += every) push(items[i]);
  return picked;
}

/**
 * Was the command's own error message sent (rather than a result)?
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeError(text) {
  return /an error occurred|there was an error|error while executing|something went wrong/i.test(text || '');
}

/**
 * Run a command's autocomplete handler.
 * @param {object} ctx
 * @param {string} name
 * @param {string} option - the option being typed
 * @param {string} value - what the user has typed so far
 * @param {object} [other] - other option values (e.g. mod_name)
 * @returns {Promise<object>}
 */
async function autocomplete(ctx, name, option, value, other = {}) {
  const found = lib.findCommand(ctx.modules, name);
  if (!found) throw new Error(`no command ${name}`);
  const types = {};
  if (found.command.data) {
    for (const declared of found.command.data.toJSON().options || []) types[declared.name] = declared.type;
  }
  const values = {};
  for (const [key, raw] of Object.entries(other)) values[key] = { type: types[key] || 3, value: raw };
  values[option] = { type: types[option] || 3, value };

  const { interaction, state } = lib.createCommandInteraction({
    commandName: name,
    values,
    autocomplete: true,
    focused: option,
  });
  const started = Date.now();
  let thrown = null;
  try {
    if (typeof found.command.autocomplete !== 'function') throw new Error('no autocomplete handler');
    await found.command.autocomplete(interaction);
  } catch (error) {
    thrown = error;
  }
  return {
    name,
    option,
    value,
    choices: state.autocompleteChoices,
    thrown,
    durationMs: Date.now() - started,
  };
}

module.exports = {
  createContext,
  addFinding,
  readSources,
  run,
  component,
  autocomplete,
  sample,
  looksLikeError,
};
