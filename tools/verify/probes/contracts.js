'use strict';

/**
 * Static contracts: does the declared command surface match the code that runs,
 * and do the pieces that talk to each other agree on names?
 *
 * Everything here is reading source or running a command against a fake
 * interaction; nothing needs Discord.
 */

const fs = require('fs');
const path = require('path');
const lib = require('../lib');
const ctxlib = require('./context');

const TYPE_NAMES = {
  3: 'string',
  4: 'integer',
  5: 'boolean',
  6: 'user',
  7: 'channel',
  8: 'role',
  9: 'mentionable',
  10: 'number',
  11: 'attachment',
};

const NAME_RE = /^[a-z0-9_-]{1,32}$/;

/**
 * Collect every command with the module it belongs to.
 * @param {object} ctx
 * @returns {object[]}
 */
function collectCommands(ctx) {
  const out = [];
  for (const [moduleName, module] of ctx.modules) {
    for (const [name, command] of module.commands) out.push({ moduleName, module, name, command });
  }
  return out;
}

/**
 * Does the command's source mention `extra.api`?
 * @param {object} command
 * @returns {boolean}
 */
function usesApi(command) {
  const source = String(command.execute || '');
  return /extra\.api\b|extra\s*\.\s*api\b/.test(source);
}

/**
 * Option names the code reads with options.getX('name').
 * @param {object} command
 * @returns {Set<string>}
 */
function optionsRead(command) {
  const source = [command.execute, command.autocomplete].filter(Boolean).map(String).join('\n');
  const names = new Set();
  for (const match of source.matchAll(/options\.get(?:String|Integer|Number|Boolean|User|Member|Channel|Role|Mentionable|Attachment)\(\s*['"]([a-z0-9_]+)['"]/g)) {
    names.add(match[1]);
  }
  return names;
}

/**
 * Option names the autocomplete handler branches on.
 * @param {object} command
 * @returns {Set<string>}
 */
function autocompleteBranches(command) {
  const source = String(command.autocomplete || '');
  const names = new Set();
  for (const match of source.matchAll(/focusedOption\.name\s*===?\s*['"]([a-z0-9_]+)['"]/g)) names.add(match[1]);
  for (const match of source.matchAll(/getFocused\([^)]*\)[\s\S]{0,80}?\.name\s*===?\s*['"]([a-z0-9_]+)['"]/g)) names.add(match[1]);
  return names;
}

/**
 * Producers and consumers of component customIds across the module tree.
 * @param {{file: string, text: string}[]} sources
 * @returns {{producers: Map<string,string[]>, consumers: Map<string,string[]>}}
 */
function customIdMap(sources) {
  const producers = new Map();
  const consumers = new Map();

  for (const source of sources) {
    const rel = path.relative(lib.BOT_ROOT, source.file);
    for (const match of source.text.matchAll(/setCustomId\(\s*[`'"]([\w-]+)(?:\||[`'"])/g)) {
      const id = match[1];
      if (!producers.has(id)) producers.set(id, []);
      producers.get(id).push(rel);
    }
    for (const match of source.text.matchAll(/customId\.startsWith\(\s*[`'"]([\w-]+)\|/g)) {
      const id = match[1];
      if (!consumers.has(id)) consumers.set(id, []);
      consumers.get(id).push(rel);
    }
    for (const match of source.text.matchAll(/customId\s*===\s*[`'"]([\w-]+)[`'"]/g)) {
      const id = match[1];
      if (!consumers.has(id)) consumers.set(id, []);
      consumers.get(id).push(rel);
    }
  }

  return { producers, consumers };
}

/**
 * Count definitions of the same helper across the tree.
 * @param {{file: string, text: string}[]} sources
 * @param {RegExp} pattern
 * @returns {{file: string, line: number}[]}
 */
function definitionSites(sources, pattern) {
  const sites = [];
  for (const source of sources) {
    const lines = source.text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (pattern.test(line)) sites.push({ file: path.relative(lib.BOT_ROOT, source.file), line: index + 1 });
    });
  }
  return sites;
}

/**
 * Run every static contract check.
 * @param {object} ctx
 */
async function probeContracts(ctx) {
  const commands = collectCommands(ctx);
  const sources = ctxlib.readSources(path.join(lib.BOT_ROOT, 'modules'))
    .concat(ctxlib.readSources(path.join(lib.BOT_ROOT, 'core', 'js')));

  ctx.stats.contracts = {
    modules: ctx.modules.size,
    disabledModules: ctx.disabled.size,
    commands: commands.length,
    byModule: {},
    autocompleteHandlers: commands.filter((c) => typeof c.command.autocomplete === 'function').length,
  };

  for (const entry of commands) {
    const bucket = ctx.stats.contracts.byModule[entry.moduleName] || (ctx.stats.contracts.byModule[entry.moduleName] = { commands: 0, options: 0 });
    bucket.commands += 1;
    if (entry.command.data) {
      try {
        bucket.options += (entry.command.data.toJSON().options || []).length;
      } catch (error) {
        /* reported below */
      }
    }
  }

  // --- duplicate command names -------------------------------------------------
  const byName = new Map();
  for (const entry of commands) {
    if (!byName.has(entry.name)) byName.set(entry.name, []);
    byName.get(entry.name).push(entry.moduleName);
  }
  for (const [name, owners] of byName) {
    if (owners.length > 1) {
      ctxlib.addFinding(ctx, {
        severity: 'high',
        area: 'contracts',
        subject: `/${name}`,
        expected: 'one command per name across enabled modules',
        actual: `defined in ${owners.join(', ')}`,
        evidence: 'module discovery overwrites by name',
      });
    }
  }

  // --- per-command builder and code contracts ---------------------------------
  for (const entry of commands) {
    const { command, name } = entry;
    const label = `/${name}`;

    if (!command.data) {
      ctxlib.addFinding(ctx, {
        severity: 'low',
        area: 'contracts',
        subject: label,
        expected: 'every command has a SlashCommandBuilder in data',
        actual: 'no data; would fall through the router\'s legacy adapter branch',
        evidence: entry.command.__file,
      });
      continue;
    }

    let json;
    try {
      json = command.data.toJSON();
    } catch (error) {
      ctxlib.addFinding(ctx, {
        severity: 'high',
        area: 'contracts',
        subject: label,
        expected: 'builder serialises to a valid application command',
        actual: String(error.message || error),
        evidence: entry.command.__file,
        repro: 'node --check + toJSON()',
      });
      continue;
    }

    if (!NAME_RE.test(json.name || '')) {
      ctxlib.addFinding(ctx, {
        severity: 'high',
        area: 'contracts',
        subject: label,
        expected: 'lowercase name matching /^[a-z0-9_-]{1,32}$/',
        actual: JSON.stringify(json.name),
        evidence: entry.command.__file,
      });
    }
    if (!json.description || json.description.length > 100) {
      ctxlib.addFinding(ctx, {
        severity: 'high',
        area: 'contracts',
        subject: label,
        expected: 'description of 1-100 characters',
        actual: `${(json.description || '').length} chars`,
        evidence: entry.command.__file,
      });
    }

    if (command.name && json.name !== command.name) {
      ctxlib.addFinding(ctx, {
        severity: 'medium',
        area: 'contracts',
        subject: label,
        expected: 'command.name agrees with data.name',
        actual: `${command.name} vs ${json.name}`,
        evidence: entry.command.__file,
      });
    }

    const options = json.options || [];
    if (options.length > 25) {
      ctxlib.addFinding(ctx, {
        severity: 'high',
        area: 'contracts',
        subject: label,
        expected: 'at most 25 options',
        actual: `${options.length} options`,
        evidence: entry.command.__file,
      });
    }

    let sawOptional = false;
    for (const option of options) {
      if (!option.required) sawOptional = true;
      else if (sawOptional) {
        ctxlib.addFinding(ctx, {
          severity: 'high',
          area: 'contracts',
          subject: `${label} option ${option.name}`,
          expected: 'required options must precede optional ones',
          actual: 'required option follows an optional one',
          evidence: entry.command.__file,
          note: 'Discord rejects the entire guild command registration for this (HTTP 50035 on options[1])',
        });
      }
      if (!NAME_RE.test(option.name || '')) {
        ctxlib.addFinding(ctx, {
          severity: 'high',
          area: 'contracts',
          subject: `${label} option ${option.name}`,
          expected: 'lowercase option name',
          actual: JSON.stringify(option.name),
          evidence: entry.command.__file,
        });
      }
      if (!option.description || option.description.length > 100) {
        ctxlib.addFinding(ctx, {
          severity: 'high',
          area: 'contracts',
          subject: `${label} option ${option.name}`,
          expected: 'option description of 1-100 characters',
          actual: `${(option.description || '').length} chars`,
          evidence: entry.command.__file,
        });
      }
      if (option.autocomplete && option.choices && option.choices.length) {
        ctxlib.addFinding(ctx, {
          severity: 'high',
          area: 'contracts',
          subject: `${label} option ${option.name}`,
          expected: 'an option cannot have both choices and autocomplete',
          actual: 'both set',
          evidence: entry.command.__file,
        });
      }
      if (option.autocomplete && ![3, 4, 10].includes(option.type)) {
        ctxlib.addFinding(ctx, {
          severity: 'high',
          area: 'contracts',
          subject: `${label} option ${option.name}`,
          expected: 'autocomplete only on string/integer/number options',
          actual: `type ${TYPE_NAMES[option.type] || option.type}`,
          evidence: entry.command.__file,
        });
      }
    }

    const declared = new Set(options.map((option) => option.name));
    const read = optionsRead(command);
    for (const optionName of read) {
      if (!declared.has(optionName)) {
        ctxlib.addFinding(ctx, {
          severity: 'high',
          area: 'contracts',
          subject: `${label} reads '${optionName}'`,
          expected: 'every option the code reads is declared in the builder',
          actual: `declared: ${[...declared].join(', ') || '(none)'}`,
          evidence: entry.command.__file,
          repro: `node tools/verify/run.js --command ${name} --opt ${optionName}=x`,
        });
      }
    }
    for (const optionName of declared) {
      if (!read.has(optionName)) {
        ctxlib.addFinding(ctx, {
          severity: 'low',
          area: 'contracts',
          subject: `${label} declares '${optionName}'`,
          expected: 'declared options are used',
          actual: 'never read by execute/autocomplete',
          evidence: entry.command.__file,
        });
      }
    }

    if (typeof command.autocomplete === 'function') {
      const autoDeclared = options.filter((option) => option.autocomplete).map((option) => option.name);
      const branches = autocompleteBranches(command);
      // With a single autocomplete option a handler does not need to branch on
      // the name; it can answer unconditionally.
      for (const optionName of autoDeclared.length > 1 ? autoDeclared : []) {
        if (!branches.has(optionName)) {
          ctxlib.addFinding(ctx, {
            severity: 'medium',
            area: 'contracts',
            subject: `${label} autocomplete '${optionName}'`,
            expected: 'handler responds for every autocomplete option',
            actual: `branches on: ${[...branches].join(', ') || '(none recognised)'}`,
            evidence: entry.command.__file,
          });
        }
      }
    }

    const apiUsed = usesApi(command);
    if (apiUsed && !command.needs_api) {
      ctxlib.addFinding(ctx, {
        severity: 'high',
        area: 'contracts',
        subject: label,
        expected: 'needs_api: true when execute uses extra.api',
        actual: 'uses extra.api but needs_api is falsy; router passes no API client',
        evidence: entry.command.__file,
      });
    }
    if (!apiUsed && command.needs_api) {
      ctxlib.addFinding(ctx, {
        severity: 'info',
        area: 'contracts',
        subject: label,
        expected: 'needs_api only when the API client is used',
        actual: 'declares needs_api but never touches extra.api',
        evidence: entry.command.__file,
      });
    }
  }

  // --- component ids ----------------------------------------------------------
  const { producers, consumers } = customIdMap(sources);
  ctx.stats.contracts.customIds = {
    producers: [...producers.keys()].sort(),
    consumers: [...consumers.keys()].sort(),
  };
  for (const [id, files] of producers) {
    if (!consumers.has(id)) {
      ctxlib.addFinding(ctx, {
        severity: 'high',
        area: 'contracts',
        subject: `customId '${id}'`,
        expected: 'a handler exists for every button/select a command sends',
        actual: 'no handler',
        evidence: [...new Set(files)].join(', '),
      });
    }
  }
  for (const [id, files] of consumers) {
    if (!producers.has(id)) {
      ctxlib.addFinding(ctx, {
        severity: 'low',
        area: 'contracts',
        subject: `customId '${id}'`,
        expected: 'every handled customId is produced somewhere',
        actual: 'handler exists but nothing emits it',
        evidence: [...new Set(files)].join(', '),
      });
    }
  }

  // --- help coverage ----------------------------------------------------------
  const help = await ctxlib.run(ctx, 'help');
  const helpFields = (help.payloads[0] && help.payloads[0].payload.embeds && help.payloads[0].payload.embeds[0]
    && help.payloads[0].payload.embeds[0].fields) || [];
  const listed = helpFields
    .map((field) => String(field.name || '').replace(/\*/g, ''))
    .filter((name) => name && !name.startsWith('…'));
  const gladius = ctx.modules.get('gladius');
  const visible = gladius
    ? [...gladius.commands.keys()].filter((name) => !name.startsWith('h-'))
    : [];
  ctx.stats.contracts.help = { listed: listed.length, visibleGladius: visible.length, totalCommands: commands.length };
  const missing = visible.filter((name) => !listed.includes(name));
  for (const name of missing) {
    ctxlib.addFinding(ctx, {
      severity: 'medium',
      area: 'contracts',
      subject: `/help omits /${name}`,
      expected: 'help lists the commands a user can run',
      actual: `${listed.length} listed of ${visible.length} gladius commands`,
      evidence: 'modules/core/commands/help.js',
    });
  }
  // /help deliberately lists only the user-facing gladius commands; core/admin
  // are system modules and are not advertised.
  if (/current_command\.module/.test(fs.readFileSync(path.join(lib.BOT_ROOT, 'modules', 'core', 'commands', 'help.js'), 'utf8'))) {
    ctxlib.addFinding(ctx, {
      severity: 'low',
      area: 'contracts',
      subject: '/help filters on a property nothing sets',
      expected: 'module filtering reflects reality',
      actual: 'filters on command.module; no command defines it, so the branch never runs',
      evidence: 'modules/core/commands/help.js',
    });
  }

  // --- duplicated helpers ------------------------------------------------------
  const duplicates = [
    { name: 'parseSkillChunk', pattern: /(?:function\s+parseSkillChunk|const\s+parseSkillChunk\s*=)/ },
    { name: 'parseClassChunk', pattern: /(?:function\s+parseClassChunk|const\s+parseClassChunk\s*=)/ },
    { name: 'createClassEmbed', pattern: /(?:function\s+createClassEmbed|const\s+createClassEmbed\s*=)/ },
    { name: 'sanitizeInput', pattern: /(?:function\s+sanitizeInput|const\s+sanitizeInput\s*=)/ },
    { name: 'splitMessage', pattern: /(?:function\s+splitMessage|const\s+splitMessage\s*=)/ },
  ];
  for (const duplicate of duplicates) {
    const sites = definitionSites(sources, duplicate.pattern);
    if (sites.length > 1) {
      ctxlib.addFinding(ctx, {
        severity: 'low',
        area: 'contracts',
        subject: `${duplicate.name} is defined ${sites.length} times`,
        expected: 'one implementation per behaviour',
        actual: sites.map((site) => `${site.file}:${site.line}`).join(', '),
        evidence: 'copies can drift; a fix in one does not reach the other',
      });
    }
  }

  // --- manifests ----------------------------------------------------------------
  for (const [moduleName, module] of ctx.modules) {
    const manifestPath = path.join(module.location, 'bot_module.json');
    const config = module.config;
    if (!fs.existsSync(path.join(module.location, config.commands_directory))) {
      ctxlib.addFinding(ctx, {
        severity: 'high',
        area: 'contracts',
        subject: `module ${moduleName}`,
        expected: 'commands_directory exists',
        actual: config.commands_directory,
        evidence: manifestPath,
      });
    }
    if (config.event_handler && !fs.existsSync(path.join(module.location, config.event_handler))) {
      ctxlib.addFinding(ctx, {
        severity: 'high',
        area: 'contracts',
        subject: `module ${moduleName}`,
        expected: 'event_handler file exists',
        actual: config.event_handler,
        evidence: manifestPath,
      });
    }
    if (!config.command_prefix) {
      ctxlib.addFinding(ctx, {
        severity: 'low',
        area: 'contracts',
        subject: `module ${moduleName}`,
        expected: 'command_prefix is set (used by the legacy ;hint)',
        actual: 'missing',
        evidence: manifestPath,
      });
    }
  }

  // --- inert legacy fields ------------------------------------------------------
  const hasState = commands.filter((entry) => 'has_state' in entry.command);
  const stateReaders = ctxlib.readSources(lib.BOT_ROOT).filter((source) => /has_state/.test(source.text) && !/commands[\\/]/.test(source.file));
  ctx.stats.contracts.hasState = hasState.length;
  if (hasState.length && stateReaders.length === 0) {
    ctxlib.addFinding(ctx, {
      severity: 'low',
      area: 'contracts',
      subject: 'has_state is inert',
      expected: 'metadata reflects behaviour',
      actual: `set on ${hasState.length} commands, read nowhere`,
      evidence: 'no non-command source mentions has_state',
    });
  }

  const legacy = commands.filter((entry) => entry.command.num_args !== undefined || entry.command.syntax !== undefined || entry.command.args_to_lower !== undefined);
  if (legacy.length) {
    ctxlib.addFinding(ctx, {
      severity: 'low',
      area: 'contracts',
      subject: 'legacy command fields remain',
      expected: 'slash-only commands carry no message-router metadata',
      actual: `${legacy.length} commands with num_args/syntax/args_to_lower`,
      evidence: legacy.map((entry) => entry.command.__file).join(', '),
    });
  }
}

module.exports = { probeContracts };

