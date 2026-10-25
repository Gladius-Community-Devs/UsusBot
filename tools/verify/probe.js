'use strict';

/**
 * Run one probe and print its findings as JSON. Used during development and for
 * reproducing a single section of the report.
 *
 *   node tools/verify/probe.js contracts
 *   node tools/verify/probe.js conformance
 *   node tools/verify/probe.js commands
 *   node tools/verify/probe.js components
 *   node tools/verify/probe.js sweep
 */

const path = require('path');
const ctxlib = require('./probes/context');

const DATA_ROOT = process.env.GLADIUS_DATA_ROOT || path.join(__dirname, '..', '..', '.verify');

const PROBES = {
  contracts: () => require('./probes/contracts').probeContracts,
  conformance: () => require('./probes/conformance').probeConformance,
  commands: () => require('./probes/commands').probeCommands,
  components: () => require('./probes/components').probeComponents,
  sweep: () => require('./probes/sweep').probeSweep,
};

async function main() {
  const which = process.argv[2] || 'contracts';
  if (!PROBES[which]) {
    console.error(`unknown probe: ${which}. Known: ${Object.keys(PROBES).join(', ')}`);
    process.exit(2);
  }

  process.env.GLADIUS_DATA_ROOT = DATA_ROOT;
  if (!process.env.ALLOWED_MODDERS_FILE) {
    process.env.ALLOWED_MODDERS_FILE = path.join(__dirname, '..', '..', '.verify', 'modders.json');
  }

  const ctx = ctxlib.createContext({ dataRoot: DATA_ROOT, moddersFile: process.env.ALLOWED_MODDERS_FILE });
  const started = Date.now();
  await PROBES[which]()(ctx);
  const elapsed = Date.now() - started;

  const summary = {
    probe: which,
    elapsedMs: elapsed,
    dataRoot: DATA_ROOT,
    mods: ctx.mods,
    stats: ctx.stats[which] || ctx.stats,
    findings: ctx.findings,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
