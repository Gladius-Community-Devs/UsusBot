'use strict';

/**
 * Run one slash command against a fake interaction and print what it would send.
 *
 *   node tools/verify/run.js --command skill --opt mod_name=Vanilla --opt skill_name=Chomp
 *   node tools/verify/run.js --command add_modder --role Admin --opt user=123 --opt mod_name=Test
 *   node tools/verify/run.js --command skill --opt mod_name=Vanilla --autocomplete skill_name --focused cho
 *
 * `NODE_PATH` must point at a discord.js install; see README.md.
 */

const fs = require('fs');
const lib = require('./lib');

function parseArgs(argv) {
  const args = { options: [], roles: [], dataRoot: process.env.GLADIUS_DATA_ROOT || '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--command') { args.command = next; i++; }
    else if (arg === '--data-root') { args.dataRoot = next; i++; }
    else if (arg === '--guild') { args.guildId = next; i++; }
    else if (arg === '--role') { args.roles.push(next); i++; }
    else if (arg === '--opt') {
      const eq = next.indexOf('=');
      args.options.push([next.slice(0, eq), next.slice(eq + 1)]);
      i++;
    } else if (arg === '--autocomplete') { args.autocomplete = next; i++; }
    else if (arg === '--focused') { args.focused = next; i++; }
    else if (arg === '--component') { args.component = next; i++; }
    else if (arg === '--value') { (args.values = args.values || []).push(next); i++; }
    else if (arg === '--json') { args.json = true; }
    else if (arg === '--help' || arg === '-h') { args.help = true; }
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function optionTypes(command) {
  const types = {};
  if (!command.data) return types;
  for (const option of command.data.toJSON().options || []) {
    types[option.name] = option.type;
  }
  return types;
}

function castOption(name, value, types) {
  const type = types[name];
  switch (type) {
    case 4: return Number.parseInt(value, 10);
    case 5: return value === 'true' || value === '1';
    case 6: return { id: String(value), username: `user-${value}`, displayName: `User ${value}` };
    case 10: return Number.parseFloat(value);
    default: return value;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.command && !args.component)) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^[\s\S]*?\/\*\*/, ''));
    process.exit(args.help ? 0 : 2);
  }

  if (args.dataRoot) process.env.GLADIUS_DATA_ROOT = args.dataRoot;
  if (!process.env.ALLOWED_MODDERS_FILE) {
    process.env.ALLOWED_MODDERS_FILE = require('path').join(lib.BOT_ROOT, '.verify', 'modders.json');
  }

  const logger = lib.createLogger();
  const { modules, handler } = lib.discoverModules(logger);
  if (args.component) {
    const handler = lib.loadComponentHandler(logger);
    const { interaction, state } = lib.createComponentInteraction({
      customId: args.component,
      valueList: args.values || [],
    });
    let thrown = null;
    const started = Date.now();
    try {
      await handler(interaction);
    } catch (error) {
      thrown = error;
    }
    console.log(JSON.stringify({
      component: args.component,
      values: args.values || [],
      durationMs: Date.now() - started,
      replied: state.replied,
      deferred: state.deferred,
      messages: state.payloads.length,
      violations: state.violations,
      thrown: thrown ? String(thrown.message || thrown) : null,
    }, null, 2));
    for (const [index, entry] of state.payloads.entries()) {
      const problems = lib.validatePayload(entry.payload);
      console.log(`\n--- payload ${index} (${entry.kind}) ${problems.length ? 'INVALID' : 'valid'} ---`);
      for (const problem of problems) console.log(`  ! ${problem}`);
      console.log(args.json ? JSON.stringify(entry.payload, null, 2) : lib.payloadText(entry.payload));
    }
    return;
  }

  const found = args.component ? null : lib.findCommand(modules, args.command);
  if (!args.component && !found) {
    console.error(`No command named ${args.command}. Known: ${[...modules.values()].flatMap((m) => [...m.commands.keys()]).join(', ')}`);
    process.exit(2);
  }

  const types = optionTypes(found.command);
  const values = {};
  for (const [name, value] of args.options) {
    values[name] = { type: types[name] || 3, value: castOption(name, value, types) };
  }

  if (args.autocomplete) {
    // The focus is the option being typed; its current value is what the user
    // has entered so far.
    values[args.autocomplete] = { type: types[args.autocomplete] || 3, value: args.focused || '' };
    const { interaction, state } = lib.createCommandInteraction({
      commandName: args.command,
      values,
      roles: args.roles,
      guildId: args.guildId,
      autocomplete: true,
      focused: args.autocomplete,
    });
    let thrown = null;
    const started = Date.now();
    try {
      if (typeof found.command.autocomplete !== 'function') throw new Error('command has no autocomplete handler');
      await found.command.autocomplete(interaction);
    } catch (error) {
      thrown = error;
    }
    const choices = state.autocompleteChoices;
    console.log(JSON.stringify({
      autocomplete: args.command,
      focused: args.focused || args.autocomplete,
      durationMs: Date.now() - started,
      choices: Array.isArray(choices) ? choices.length : null,
      invalid: Array.isArray(choices) ? choices.filter((c) => !c.name || !c.value || String(c.name).length > 100 || String(c.value).length > 100) : [],
      thrown: thrown ? String(thrown.message || thrown) : null,
    }, null, 2));
    if (Array.isArray(choices)) console.log(JSON.stringify(choices.slice(0, 30), null, 2));
    return;
  }

  const api = lib.createFakeApi(lib.defaultApiResponder);
  const result = await lib.runCommand(modules, args.command, {
    values,
    roles: args.roles,
    guildId: args.guildId,
  }, { handler, api });

  const summary = lib.summarize(result);
  console.log(JSON.stringify({ summary, logEntries: logger.entries.slice(-10) }, null, 2));

  for (const [index, entry] of result.state.payloads.entries()) {
    const problems = lib.validatePayload(entry.payload);
    console.log(`\n--- payload ${index} (${entry.kind}) ${problems.length ? 'INVALID' : 'valid'} ---`);
    for (const problem of problems) console.log(`  ! ${problem}`);
    console.log(args.json ? JSON.stringify(entry.payload, null, 2) : lib.payloadText(entry.payload));
  }

  if (result.thrown) {
    console.error('\nTHREW:', result.thrown && result.thrown.stack ? result.thrown.stack : result.thrown);
  }
  if (result.state.violations.length) {
    console.error('\nINTERACTION VIOLATIONS:', result.state.violations);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

