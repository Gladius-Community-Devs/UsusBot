'use strict';

/**
 * Verification harness primitives.
 *
 * The bot's commands are plain objects: they take a discord.js interaction and
 * send replies. This module fakes the interaction (and enforces the same
 * "you may only respond once" rules Discord does), captures every payload a
 * command produces, and validates those payloads against Discord's documented
 * limits. Nothing here talks to Discord.
 *
 * Runs with `NODE_PATH` pointing at a discord.js install (see README).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { Collection, InteractionType } = require('discord.js');

const BOT_ROOT = path.resolve(__dirname, '..', '..');

/** Discord's documented limits, as validation bounds. */
const LIMITS = Object.freeze({
  content: 2000,
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  author: 256,
  fields: 25,
  embeds: 10,
  embedTotal: 6000,
  rows: 5,
  buttonsPerRow: 5,
  selectOptions: 25,
  customId: 100,
  buttonLabel: 80,
  optionLabel: 100,
  optionValue: 100,
  optionDescription: 100,
});

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

/**
 * Collects log calls instead of printing them, so a probe can report which
 * errors a command swallowed.
 * @returns {{entries: object[], info: Function, debug: Function, warn: Function, error: Function, end: Function}}
 */
function createLogger() {
  const entries = [];
  const push = (level) => (...args) => entries.push({
    level,
    message: args.map((a) => (a && a.stack ? a.stack : String(a))).join(' '),
  });
  return {
    entries,
    info: push('info'),
    debug: push('debug'),
    warn: push('warn'),
    error: push('error'),
    end: (callback) => { if (callback) callback(); },
  };
}

// ---------------------------------------------------------------------------
// Payload capture and validation
// ---------------------------------------------------------------------------

/**
 * Convert an EmbedBuilder (or plain object) to its wire JSON.
 * @param {*} embed
 * @returns {object}
 */
function toJsonEmbed(embed) {
  if (!embed) return {};
  if (typeof embed.toJSON === 'function') return embed.toJSON();
  return embed;
}

/**
 * Convert an ActionRowBuilder (or plain object) to its wire JSON.
 * @param {*} row
 * @returns {object}
 */
function toJsonRow(row) {
  if (!row) return {};
  if (typeof row.toJSON === 'function') return row.toJSON();
  return row;
}

/**
 * Normalise anything a command can pass to reply/editReply/followUp/update.
 * @param {*} payload
 * @returns {object}
 */
function payloadJson(payload) {
  if (payload === undefined || payload === null) return {};
  if (typeof payload === 'string') return { content: payload };
  const out = {};
  if (payload.content !== undefined) out.content = payload.content;
  if (payload.embeds) out.embeds = payload.embeds.map(toJsonEmbed);
  if (payload.components) out.components = payload.components.map(toJsonRow);
  if (payload.files) out.files = payload.files;
  if (payload.ephemeral !== undefined) out.ephemeral = payload.ephemeral;
  if (payload.allowedMentions !== undefined) out.allowedMentions = payload.allowedMentions;
  return out;
}

/**
 * Approximate the character weight Discord counts for one embed.
 * @param {object} embed
 * @returns {number}
 */
function embedLength(embed) {
  let total = 0;
  if (embed.title) total += String(embed.title).length;
  if (embed.description) total += String(embed.description).length;
  if (embed.footer && embed.footer.text) total += String(embed.footer.text).length;
  if (embed.author && embed.author.name) total += String(embed.author.name).length;
  for (const field of embed.fields || []) {
    total += String(field.name || '').length + String(field.value || '').length;
  }
  return total;
}

/**
 * Validate one captured payload against Discord's limits.
 * @param {object} payload
 * @returns {string[]} Human-readable problems; empty means the payload is sendable.
 */
function validatePayload(payload) {
  const errors = [];

  if (payload.content !== undefined && payload.content !== null) {
    if (typeof payload.content !== 'string') errors.push('content is not a string');
    else if (payload.content.length > LIMITS.content) {
      errors.push(`content is ${payload.content.length} chars (max ${LIMITS.content})`);
    }
  }

  const embeds = payload.embeds || [];
  if (embeds.length > LIMITS.embeds) errors.push(`${embeds.length} embeds (max ${LIMITS.embeds})`);

  let total = (payload.content || '').length;
  embeds.forEach((embed, i) => {
    const where = `embed[${i}]`;
    total += embedLength(embed);
    if (embed.title !== undefined && String(embed.title).length > LIMITS.title) {
      errors.push(`${where} title is ${String(embed.title).length} chars (max ${LIMITS.title})`);
    }
    if (embed.description !== undefined && String(embed.description).length > LIMITS.description) {
      errors.push(`${where} description is ${String(embed.description).length} chars (max ${LIMITS.description})`);
    }
    if (embed.footer && embed.footer.text && String(embed.footer.text).length > LIMITS.footer) {
      errors.push(`${where} footer is ${String(embed.footer.text).length} chars (max ${LIMITS.footer})`);
    }
    if (embed.author && embed.author.name && String(embed.author.name).length > LIMITS.author) {
      errors.push(`${where} author name is ${String(embed.author.name).length} chars (max ${LIMITS.author})`);
    }
    const fields = embed.fields || [];
    if (fields.length > LIMITS.fields) errors.push(`${where} has ${fields.length} fields (max ${LIMITS.fields})`);
    fields.forEach((field, j) => {
      const fw = `${where}.field[${j}]`;
      const name = String(field.name === undefined ? '' : field.name);
      const value = String(field.value === undefined ? '' : field.value);
      if (name.length === 0) errors.push(`${fw} has an empty name`);
      if (value.length === 0) errors.push(`${fw} has an empty value`);
      if (name.length > LIMITS.fieldName) errors.push(`${fw} name is ${name.length} chars (max ${LIMITS.fieldName})`);
      if (value.length > LIMITS.fieldValue) errors.push(`${fw} value is ${value.length} chars (max ${LIMITS.fieldValue})`);
    });
  });

  if (total > LIMITS.embedTotal) errors.push(`content+embeds total ${total} chars (max ${LIMITS.embedTotal})`);

  const rows = payload.components || [];
  if (rows.length > LIMITS.rows) errors.push(`${rows.length} component rows (max ${LIMITS.rows})`);
  rows.forEach((row, i) => {
    const where = `components[${i}]`;
    const comps = row.components || [];
    if (comps.length === 0) errors.push(`${where} is empty`);
    if (row.type !== undefined && row.type !== 1) errors.push(`${where} type is ${row.type}, expected 1`);
    const hasSelect = comps.some((c) => [3, 5, 6, 7, 8].includes(c.type));
    if (hasSelect && comps.length !== 1) errors.push(`${where} mixes a select with other components`);
    if (!hasSelect && comps.length > LIMITS.buttonsPerRow) {
      errors.push(`${where} has ${comps.length} buttons (max ${LIMITS.buttonsPerRow})`);
    }
    comps.forEach((component, j) => {
      const cw = `${where}.component[${j}]`;
      if (!component.custom_id && !component.customId) errors.push(`${cw} has no custom_id`);
      const id = component.custom_id || component.customId || '';
      if (String(id).length > LIMITS.customId) errors.push(`${cw} custom_id is ${String(id).length} chars (max ${LIMITS.customId})`);
      if (component.type === 2) {
        const label = String(component.label || '');
        if (label.length > LIMITS.buttonLabel) errors.push(`${cw} label is ${label.length} chars (max ${LIMITS.buttonLabel})`);
      }
      if (component.type === 3) {
        const options = component.options || [];
        if (options.length === 0) errors.push(`${cw} select has no options`);
        if (options.length > LIMITS.selectOptions) errors.push(`${cw} has ${options.length} options (max ${LIMITS.selectOptions})`);
        options.forEach((option, k) => {
          const ow = `${cw}.option[${k}]`;
          const label = String(option.label || '');
          const value = String(option.value || '');
          if (!label) errors.push(`${ow} has an empty label`);
          if (!value) errors.push(`${ow} has an empty value`);
          if (label.length > LIMITS.optionLabel) errors.push(`${ow} label is ${label.length} chars (max ${LIMITS.optionLabel})`);
          if (value.length > LIMITS.optionValue) errors.push(`${ow} value is ${value.length} chars (max ${LIMITS.optionValue})`);
          if (option.description && String(option.description).length > LIMITS.optionDescription) {
            errors.push(`${ow} description is too long`);
          }
        });
      }
    });
  });

  const empty = !payload.content && embeds.length === 0 && !payload.files;
  if (empty) errors.push('payload has no content, embeds or files');

  return errors;
}

/**
 * Flatten a payload into searchable text, for "does the reply mention X" checks.
 * @param {object} payload
 * @returns {string}
 */
function payloadText(payload) {
  const parts = [];
  if (payload.content) parts.push(payload.content);
  for (const embed of payload.embeds || []) {
    if (embed.title) parts.push(embed.title);
    if (embed.description) parts.push(embed.description);
    for (const field of embed.fields || []) parts.push(String(field.name || ''), String(field.value || ''));
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Fake interactions
// ---------------------------------------------------------------------------

const OPTION_TYPES = Object.freeze({
  STRING: 3,
  INTEGER: 4,
  BOOLEAN: 5,
  USER: 6,
  CHANNEL: 7,
  ROLE: 8,
  MENTIONABLE: 9,
  NUMBER: 10,
  ATTACHMENT: 11,
});

/**
 * Build the option resolver shape commands use.
 * @param {object} values - name -> {type, value}
 * @param {?string} focused - the option being autocompleted
 * @returns {object}
 */
function optionResolver(values, focused) {
  const entries = Object.entries(values || {});
  const valueOf = (name) => (values && name in values ? values[name].value : null);

  const resolver = {
    data: entries.map(([name, entry]) => ({ name, type: entry.type, value: entry.value })),
    getString: (name) => valueOf(name),
    getInteger: (name) => valueOf(name),
    getNumber: (name) => valueOf(name),
    getBoolean: (name) => valueOf(name),
    getUser: (name) => valueOf(name),
    getMember: (name) => valueOf(name),
    getChannel: (name) => valueOf(name),
    getRole: (name) => valueOf(name),
    getMentionable: (name) => valueOf(name),
    getAttachment: (name) => valueOf(name),
  };

  resolver.getFocused = (full) => {
    if (focused === undefined || focused === null) {
      return full ? { name: null, value: '', type: OPTION_TYPES.STRING } : '';
    }
    const entry = (values && values[focused]) || { type: OPTION_TYPES.STRING, value: '' };
    return full ? { name: focused, value: entry.value, type: entry.type } : entry.value;
  };

  return resolver;
}

/**
 * Fake a slash-command interaction, enforcing Discord's single-response rules.
 *
 * `editReply` before `deferReply`, a second `reply`, `reply` after `deferReply`
 * and `followUp` before any response all throw here exactly as they would in
 * discord.js; a command that hits one is a real bug, not a harness artefact.
 *
 * @param {object} options
 * @param {string} options.commandName
 * @param {object} [options.values] - option name -> {type, value}
 * @param {string[]} [options.roles] - role names the caller holds
 * @param {string} [options.guildId]
 * @param {?string} [options.focused] - option being autocompleted
 * @param {boolean} [options.autocomplete]
 * @returns {{interaction: object, state: object}}
 */
function createCommandInteraction(options) {
  const {
    commandName,
    values = {},
    roles = [],
    guildId = '880888471487672341',
    userId = '100000000000000001',
    focused = null,
    autocomplete = false,
  } = options;

  const state = {
    deferred: false,
    replied: false,
    deferOptions: null,
    payloads: [],
    autocompleteChoices: null,
    violations: [],
  };

  const record = (kind, payload) => {
    state.payloads.push({ kind, payload: payloadJson(payload) });
  };

  const fail = (message) => {
    state.violations.push(message);
    throw new Error(message);
  };

  const interaction = {
    commandName,
    commandId: '1',
    guildId,
    channelId: '200000000000000001',
    applicationId: '300000000000000001',
    guild: {
      id: guildId,
      members: {
        fetch: async (id) => ({
          id,
          displayName: `member-${id}`,
          user: { id, username: `user-${id}` },
        }),
      },
    },
    user: { id: userId, username: 'verify-user', globalName: 'Verify User' },
    member: {
      id: userId,
      roles: { cache: roles.map((name) => ({ name })) },
      permissions: { has: () => true },
    },
    options: optionResolver(values, focused),
    isChatInputCommand: () => true,
    isAutocomplete: () => autocomplete,

    get deferred() { return state.deferred; },
    get replied() { return state.replied; },
    get repliedOrDeferred() { return state.deferred || state.replied; },

    async deferReply(opts) {
      if (state.deferred || state.replied) return fail('deferReply after a response');
      state.deferred = true;
      state.deferOptions = opts || null;
    },
    async editReply(payload) {
      if (!state.deferred && !state.replied) return fail('editReply before deferReply');
      record('editReply', payload);
    },
    async reply(payload) {
      if (state.deferred || state.replied) return fail('reply after deferReply/reply');
      state.replied = true;
      record('reply', payload);
    },
    async followUp(payload) {
      if (!state.deferred && !state.replied) return fail('followUp before any response');
      record('followUp', payload);
    },
    async respond(choices) {
      state.autocompleteChoices = choices;
    },
  };

  return { interaction, state };
}

/**
 * Fake a button/select interaction and dispatch it the way the bot's event
 * handler does.
 *
 * @param {object} options
 * @param {string} options.customId
 * @param {string[]} [options.valueList] - selected values for a select menu
 * @param {string[]} [options.roles]
 * @param {string} [options.guildId]
 * @returns {{interaction: object, state: object}}
 */
function createComponentInteraction(options) {
  const {
    customId,
    valueList = [],
    roles = [],
    guildId = '880888471487672341',
    userId = '100000000000000001',
  } = options;

  const state = {
    deferred: false,
    replied: false,
    payloads: [],
    violations: [],
  };

  const record = (kind, payload) => state.payloads.push({ kind, payload: payloadJson(payload) });
  const fail = (message) => {
    state.violations.push(message);
    throw new Error(message);
  };

  const interaction = {
    type: InteractionType.MessageComponent,
    customId,
    values: valueList,
    guildId,
    channelId: '200000000000000001',
    user: { id: userId, username: 'verify-user' },
    member: { id: userId, roles: { cache: roles.map((name) => ({ name })) } },
    message: {
      id: '400000000000000001',
      embeds: [],
      components: [],
    },
    isButton: () => true,
    isStringSelectMenu: () => valueList.length > 0,
    isChatInputCommand: () => false,
    isAutocomplete: () => false,

    get deferred() { return state.deferred; },
    get replied() { return state.replied; },
    get repliedOrDeferred() { return state.deferred || state.replied; },

    async deferUpdate() {
      if (state.deferred || state.replied) return fail('deferUpdate after a response');
      state.deferred = true;
    },
    async update(payload) {
      if (state.deferred || state.replied) return fail('update after a response');
      state.replied = true;
      record('update', payload);
    },
    async editReply(payload) {
      if (!state.deferred && !state.replied) return fail('editReply before deferUpdate');
      record('editReply', payload);
    },
    async reply(payload) {
      if (state.deferred || state.replied) return fail('reply after deferUpdate/update');
      state.replied = true;
      record('reply', payload);
    },
    async followUp(payload) {
      if (!state.deferred && !state.replied) return fail('followUp before any response');
      record('followUp', payload);
    },
  };

  return { interaction, state };
}

// ---------------------------------------------------------------------------
// Module and command discovery
// ---------------------------------------------------------------------------

/**
 * Load every enabled module and its commands, exactly as module_handler does.
 * @param {object} logger
 * @returns {{modules: Collection, disabled: Collection, handler: object}}
 */
function discoverModules(logger) {
  const modulesRoot = path.join(BOT_ROOT, 'modules');
  const modules = new Collection();
  const disabled = new Collection();

  for (const dir of fs.readdirSync(modulesRoot, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const manifestPath = path.join(modulesRoot, dir.name, 'bot_module.json');
    if (!fs.existsSync(manifestPath)) continue;

    const config = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const location = path.join(modulesRoot, dir.name) + path.sep;
    const entry = { config, location, commands: new Map() };

    if (!config.enabled) {
      disabled.set(config.name, entry);
      continue;
    }

    const commandsDir = path.join(location, config.commands_directory);
    for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js')).sort()) {
      const command = require(path.join(commandsDir, file));
      command.logger = logger;
      command.__file = path.join(config.name, 'commands', file);
      command.__module = config;
      const name = command.data ? command.data.name : command.name;
      if (name) entry.commands.set(name, command);
    }

    modules.set(config.name, entry);
  }

  const handler = {
    modules,
    disabled_modules: disabled,
    logger,
  };

  return { modules, disabled, handler };
}

/**
 * Locate a command by name across modules.
 * @param {Collection} modules
 * @param {string} name
 * @returns {?{command: object, module: object}}
 */
function findCommand(modules, name) {
  for (const module of modules.values()) {
    if (module.commands.has(name)) {
      return { command: module.commands.get(name), module };
    }
  }
  return null;
}

/**
 * Build the `extra` object the router would pass to a command.
 * @param {object} module
 * @param {object} command
 * @param {object} handler
 * @param {?object} api
 * @returns {object}
 */
function buildExtra(module, command, handler, api) {
  const extra = {};
  if (module.config.is_core) extra.module_handler = handler;
  if (command.needs_api) extra.api = api;
  return extra;
}

/**
 * Run one slash command against a fake interaction.
 *
 * @param {Collection} modules
 * @param {string} name
 * @param {object} [options] - passed to createCommandInteraction
 * @param {object} [context]
 * @param {?object} [context.api]
 * @returns {Promise<object>}
 */
async function runCommand(modules, name, options = {}, context = {}) {
  const found = findCommand(modules, name);
  if (!found) throw new Error(`no command named ${name}`);
  const { interaction, state } = createCommandInteraction({ commandName: name, ...options });
  const extra = buildExtra(found.module, found.command, context.handler, context.api);
  const started = Date.now();
  let thrown = null;
  try {
    await found.command.execute(interaction, extra);
  } catch (error) {
    thrown = error;
  }
  return {
    command: name,
    module: found.module.config.name,
    source: found.command.__file,
    interaction,
    state,
    thrown,
    durationMs: Date.now() - started,
  };
}

/**
 * Load the gladius component handler.
 * @param {object} logger
 * @returns {Function} the `interactionCreate` handler
 */
function loadComponentHandler(logger) {
  const handlerPath = path.join(BOT_ROOT, 'modules', 'gladius', 'events.js');
  const register = require(handlerPath);
  const handlers = {};
  register({ logger, register: (event, fn) => { handlers[event] = fn; } });
  if (!handlers.interactionCreate) throw new Error('events.js did not register interactionCreate');
  return handlers.interactionCreate;
}

// ---------------------------------------------------------------------------
// Fake API client
// ---------------------------------------------------------------------------

/**
 * Stand-in for APIClient that records calls and returns canned data.
 * @param {Function} responder - (method, resource, payload) => data
 * @returns {object}
 */
function createFakeApi(responder) {
  const calls = [];
  const make = (method) => async (resource, payload) => {
    calls.push({ method, resource, payload });
    return responder(method, resource, payload);
  };
  return {
    calls,
    get: make('get'),
    post: make('post'),
    put: make('put'),
    delete: make('delete'),
  };
}

/**
 * Default LabsAPI responder: two modules, gladius enabled, others not.
 * @param {string} method
 * @param {string} resource
 * @param {object} payload
 * @returns {object}
 */
function defaultApiResponder(method, resource, payload) {
  if (resource === 'module') {
    const name = (payload && payload.name) || 'gladius';
    return { modules: [{ module_id: name === 'gladius' ? 1 : 2, name, display_name: name }] };
  }
  if (resource === 'enabled_module') {
    if (method === 'get') {
      const list = payload && payload.server_id ? [{ link_id: 10, module_id: 1 }] : [];
      return { enabled_modules: list };
    }
    return { success: true };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/**
 * Short, stable digest of a payload, for golden-file comparisons.
 * @param {*} payload
 * @returns {string}
 */
function payloadHash(payload) {
  return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
}

/**
 * One-line summary of what a command sent.
 * @param {object} result
 * @returns {object}
 */
function summarize(result) {
  const payloads = result.state.payloads;
  const text = payloads.map((p) => payloadText(p.payload)).join('\n');
  const problems = payloads.flatMap((p) => validatePayload(p.payload).map((e) => `${p.kind}: ${e}`));
  return {
    command: result.command,
    module: result.module,
    messages: payloads.length,
    kinds: payloads.map((p) => p.kind),
    chars: text.length,
    embeds: payloads.reduce((n, p) => n + (p.payload.embeds ? p.payload.embeds.length : 0), 0),
    components: payloads.reduce((n, p) => n + (p.payload.components ? p.payload.components.length : 0), 0),
    problems,
    violations: result.state.violations,
    thrown: result.thrown ? String(result.thrown && result.thrown.message ? result.thrown.message : result.thrown) : null,
    durationMs: result.durationMs,
    hash: payloadHash(payloads.map((p) => p.payload)),
  };
}

module.exports = {
  BOT_ROOT,
  LIMITS,
  OPTION_TYPES,
  createLogger,
  payloadJson,
  payloadText,
  payloadHash,
  validatePayload,
  embedLength,
  createCommandInteraction,
  createComponentInteraction,
  discoverModules,
  findCommand,
  buildExtra,
  runCommand,
  loadComponentHandler,
  createFakeApi,
  defaultApiResponder,
  summarize,
};
