#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { DelaywireServer } from './server.js';
import { RuleRegistry } from './rules.js';

const banner = `
  ____       _                                _          
 |  _ \  ___| | __ _ _   ___      _____ _ __ (_)___ _ __ 
 | | | |/ _ \ |/ _\` | | | \ \ /\ / / _ \ '__/| / __| '__|
 | |_| |  __/ | (_| | |_| |\ V  V /  __/ |   | \__ \ |   
 |____/ \___|_|\__,_|\__, | \_/\_/ \___|_|   |_|___/_|   
                     |___/                               
  High-Precision Latency Injection & Microservice Mock Server
`;

function showHelp() {
  console.log(banner);
  console.log(`
Usage: delaywire [options]

Options:
  -p, --port <number>          Port to bind server (default: 8080)
  -h, --host <string>          Host interface (default: 127.0.0.1)
  -c, --config <path>          Path to JSON rules file
  -d, --delay <ms>             Fixed delay in milliseconds (default: 0)
  -m, --mode <type>            Latency distribution: fixed, jitter, normal, pareto (default: fixed)
      --min <ms>               Minimum latency for jitter mode (default: 50)
      --max <ms>               Maximum latency for jitter/pareto mode (default: 500)
      --stddev <ms>            Standard deviation for normal mode (default: 30)
      --pareto-alpha <float>   Shape parameter for Pareto distribution (default: 1.5)
      --chaos-rate <float>     Chaos error rate between 0.0 and 1.0 (default: 0)
      --chaos-action <action>  Chaos type: error_500, error_502, error_504, hang, reset, empty
      --proxy <url>            Upstream proxy URL (transparent proxy with latency injection)
      --tls-key <path>         Path to TLS private key (.pem)
      --tls-cert <path>        Path to TLS certificate (.pem)
  -s, --silent                 Disable stdout request logging
      --help                   Show this help message

Examples:
  # 1. Start mock server with 250ms fixed delay
  delaywire --port 9000 --delay 250

  # 2. Simulate long-tail (Pareto) latency degradation with 10% 504 timeouts
  delaywire -p 8080 -m pareto --delay 100 --max 4000 --chaos-rate 0.1 --chaos-action error_504

  # 3. Transparently proxy to remote microservice, adding normal jitter (mean: 150ms, stddev: 40ms)
  delaywire -p 3000 --proxy http://api.internal.service:8080 -m normal -d 150 --stddev 40

  # 4. Use route configuration file
  delaywire -c ./mocks/routes.json
`);
}

async function main() {
  const options = {
    port: { type: 'string', short: 'p', default: '8080' },
    host: { type: 'string', short: 'h', default: '127.0.0.1' },
    config: { type: 'string', short: 'c' },
    delay: { type: 'string', short: 'd', default: '0' },
    mode: { type: 'string', short: 'm', default: 'fixed' },
    min: { type: 'string', default: '50' },
    max: { type: 'string', default: '500' },
    stddev: { type: 'string', default: '30' },
    'pareto-alpha': { type: 'string', default: '1.5' },
    'chaos-rate': { type: 'string', default: '0' },
    'chaos-action': { type: 'string', default: 'error_500' },
    proxy: { type: 'string' },
    'tls-key': { type: 'string' },
    'tls-cert': { type: 'string' },
    silent: { type: 'boolean', short: 's', default: false },
    help: { type: 'boolean', default: false }
  };

  let parsed;
  try {
    parsed = parseArgs({ options, allowPositionals: false });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    console.error('Run "delaywire --help" for usage details.');
    process.exit(1);
  }

  if (parsed.values.help) {
    showHelp();
    process.exit(0);
  }

  const globalLatency = {
    type: parsed.values.mode,
    baseMs: Number(parsed.values.delay),
    minMs: Number(parsed.values.min),
    maxMs: Number(parsed.values.max),
    stdDev: Number(parsed.values.stddev),
    paretoAlpha: Number(parsed.values['pareto-alpha']),
    chaos: {
      rate: Number(parsed.values['chaos-rate']),
      action: parsed.values['chaos-action']
    }
  };

  let registry;
  try {
    registry = new RuleRegistry(parsed.values.config || null, globalLatency);
  } catch (err) {
    console.error(`Configuration Error: ${err.message}`);
    process.exit(1);
  }

  const server = new DelaywireServer({
    port: Number(parsed.values.port),
    host: parsed.values.host,
    proxy: parsed.values.proxy || null,
    tlsKey: parsed.values['tls-key'] || null,
    tlsCert: parsed.values['tls-cert'] || null,
    silent: parsed.values.silent,
    ruleRegistry: registry,
    globalLatency
  });

  try {
    const info = await server.start();
    if (!parsed.values.silent) {
      console.log(banner);
      console.log(` > Server listening on: ${info.isHttps ? 'https' : 'http'}://${info.host}:${info.port}`);
      console.log(` > Latency Profile:     type=${globalLatency.type}, base=${globalLatency.baseMs}ms`);
      if (globalLatency.chaos.rate > 0) {
        console.log(` > Chaos Injection:     ${(globalLatency.chaos.rate * 100).toFixed(1)}% rate -> ${globalLatency.chaos.action}`);
      }
      if (parsed.values.proxy) {
        console.log(` > Upstream Proxy:      ${parsed.values.proxy}`);
      }
      if (parsed.values.config) {
        console.log(` > Configuration File:  ${parsed.values.config} (${registry.rules.length} custom rules loaded)`);
      }
      console.log('\nReady. Press Ctrl+C to stop.\n');
    }
  } catch (err) {
    console.error(`Failed to start server: ${err.message}`);
    process.exit(1);
  }

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (!parsed.values.silent) {
      console.log('\n[delaywire] Gracefully stopping server...');
    }
    await server.stop();
    if (!parsed.values.silent) {
      console.log(`[delaywire] Summary: ${server.stats.requests} requests served, ${server.stats.faults} faults injected.`);
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
