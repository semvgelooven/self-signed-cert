#!/usr/bin/env node
import { readCa, describeCa } from '../src/ca.mjs';
import { loadConfig, DEFAULTS } from '../src/config.mjs';
import { installPage } from '../src/page.mjs';
import { detectProviders, selectProvider, PROVIDER_IDS } from '../src/providers.mjs';
import { startServer } from '../src/server.mjs';
import { securedDomains } from '../src/sites.mjs';
import { pickDevice, ensureBooted, openUrl, addRootCert, resolves } from '../src/simulator.mjs';

const USAGE = `simcert: trust your local dev root CA in the iOS Simulator

Usage
  simcert                 Serve the CA and open the install page in the Simulator
  simcert --trust         Inject the CA straight into the Simulator's trust store
  simcert --info          Show what was detected, then exit

Options
  --provider <id>   ${PROVIDER_IDS.join(' | ')} (default: whichever is installed)
  --ca <path>       Root certificate to serve
  --certs <dir>     Directory of <domain>.crt files to list sites from (repeatable)
  --domains <list>  Extra comma-separated domains to list
  --device <name>   Simulator name or UDID (default: the booted one, else newest iPhone)
  --port <number>   Port to serve on (default: ${DEFAULTS.port}, walks forward if taken)
  --host <addr>     Address to bind (default: ${DEFAULTS.host})
  --config <path>   Config file to read (default: ./simcert.config.json, then ~/.config/simcert/config.json)
  --no-open         Don't touch the Simulator, just serve the page

Anything above can also live in simcert.config.json or in SIMCERT_* environment
variables. Flags win over the environment, which wins over the config file.
`;

function parseArgs(argv) {
  const flags = {};
  const certs = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };

    switch (arg) {
      case '--help': case '-h': flags.help = true; break;
      case '--info': flags.info = true; break;
      case '--trust': flags.trust = true; break;
      case '--no-open': flags.open = false; break;
      case '--provider': flags.provider = value(); break;
      case '--ca': flags.ca = value(); break;
      case '--certs': certs.push(value()); break;
      case '--domains': flags.domains = value().split(',').map((d) => d.trim()).filter(Boolean); break;
      case '--device': flags.device = value(); break;
      case '--host': flags.host = value(); break;
      case '--config': flags.config = value(); break;
      case '--port': {
        const port = Number(value());
        if (!Number.isInteger(port)) throw new Error('--port needs a whole number');
        flags.port = port;
        break;
      }
      default: throw new Error(`Unknown option: ${arg}\n\n${USAGE}`);
    }
  }

  if (certs.length > 0) flags.certificateDirs = certs;
  return flags;
}

// Config decides where things come from; the provider only fills in the blanks.
function resolveSetup(config) {
  const provider = config.ca && !config.provider
    ? { id: 'custom', label: 'custom', caPath: config.ca, certificateDirs: [] }
    : selectProvider(config.provider);

  const caPath = config.ca ?? provider.caPath;
  const certificateDirs = config.certificateDirs.length > 0 ? config.certificateDirs : provider.certificateDirs;

  return {
    ca: { id: provider.id, label: provider.label, path: caPath },
    certificateDirs,
    sites: securedDomains({ certificateDirs, extraDomains: config.domains }),
  };
}

function printInfo(config, setup) {
  const detected = detectProviders().map((p) => p.label).join(', ') || 'none';
  console.log(`Config file      ${config.configFile ?? '(none)'}`);
  console.log(`Detected         ${detected}`);
  console.log(`Using            ${setup.ca.label}`);
  console.log(`Certificate      ${setup.ca.path}`);
  console.log(`Certificate dirs ${setup.certificateDirs.join(', ') || '(none)'}`);
  console.log(`Sites            ${setup.sites.map((s) => s.domain).join(', ') || '(none)'}`);
  console.log(`Serve on         http://${config.host}:${config.port}/`);
  console.log(`Device           ${config.device ?? '(booted, else newest iPhone)'}`);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    process.stdout.write(USAGE);
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('simcert drives the iOS Simulator, which only exists on macOS.');
  }

  const config = loadConfig(flags);
  const setup = resolveSetup(config);

  if (config.info) {
    printInfo(config, setup);
    return;
  }

  const info = describeCa(setup.ca.path);
  console.log(`Certificate  ${info.commonName ?? setup.ca.path} (${setup.ca.label})`);
  console.log(`             ${setup.ca.path}`);

  if (config.trust) {
    const device = await ensureBooted(pickDevice(config.device));
    await addRootCert(device, setup.ca.path);
    console.log(`\nTrusted on ${device.name}. No profile install needed. Open one of your https sites.`);
    await reportDns(device, setup.sites);
    return;
  }

  const { server, url } = await startServer({
    ca: { ...setup.ca, contents: readCa(setup.ca.path) },
    info,
    sites: setup.sites,
    host: config.host,
    port: config.port,
    renderPage: installPage,
  });
  console.log(`Serving      ${url}`);

  if (config.open !== false) {
    const device = await ensureBooted(pickDevice(config.device));
    await openUrl(device, url);
    console.log(`Opened in    ${device.name}`);
    await reportDns(device, setup.sites);
  }

  console.log(`
In the Simulator:
  1. Tap "Download certificate profile"
  2. Settings > General > VPN & Device Management > install it
  3. Settings > General > About > Certificate Trust Settings > switch it on

Ctrl-C when you're done.`);

  const stop = () => { server.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

// Trusting the CA is pointless if the simulator can't resolve the domain at all,
// so say so up front rather than letting it look like a certificate problem.
async function reportDns(device, sites) {
  const [site] = sites;
  if (!site) return;
  if (await resolves(device, site.domain) !== false) return;
  console.log(`\n! ${site.domain} does not resolve in the Simulator. Check DNS on the host first.`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
