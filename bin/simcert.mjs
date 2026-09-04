#!/usr/bin/env node
import { readCa, describeCa } from '../src/ca.mjs';
import { loadConfig, DEFAULTS } from '../src/config.mjs';
import { installPage } from '../src/page.mjs';
import { detectProviders, selectProvider, PROVIDER_IDS } from '../src/providers.mjs';
import { startServer } from '../src/server.mjs';
import { securedDomains } from '../src/sites.mjs';
import { detectTargets, resolveTargets, targetLabel } from '../src/targets.mjs';
import * as ios from '../src/simulator.mjs';
import * as android from '../src/emulator.mjs';

const USAGE = `simcert: trust your local dev root CA in the iOS Simulator or Android emulator

Usage
  simcert                    Serve the CA and open the install page on your device
  simcert --trust            Put the CA straight into the device's trust store
  simcert --settings         Just open the certificate install screen, then exit
  simcert --info             Show what was detected, then exit

Targets
  --ios             iOS Simulator
  --android         Android emulator
  --both            Both at once
  (with none of these, simcert uses whichever is running, and asks if both are)

Options
  --provider <id>   ${PROVIDER_IDS.join(' | ')} (default: whichever is installed)
  --ca <path>       Root certificate to serve
  --certs <dir>     Directory of <domain>.crt files to list sites from (repeatable)
  --domains <list>  Extra comma-separated domains to list
  --device <name>   Simulator name/UDID, or emulator serial/AVD name
  --port <number>   Port to serve on (default: ${DEFAULTS.port}, walks forward if taken)
  --host <addr>     Address to bind (default: ${DEFAULTS.host})
  --config <path>   Config file to read (default: ./simcert.config.json, then ~/.config/simcert/config.json)
  --no-open         Don't touch the device, just serve the page

Android only
  --host-ip <addr>  Address the emulator reaches this machine on (default: ${android.HOST_LOOPBACK})
  --no-hosts        Skip pointing your domains at this machine in the emulator

Anything above can also live in simcert.config.json or in SIMCERT_* environment
variables. Flags win over the environment, which wins over the config file.
`;

function parseArgs(argv) {
  const flags = {};
  const certs = [];
  const targets = new Set();

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
      case '--settings': flags.settings = true; break;
      case '--no-open': flags.open = false; break;
      case '--ios': targets.add('ios'); break;
      case '--android': targets.add('android'); break;
      case '--both': case '--all': targets.add('ios'); targets.add('android'); break;
      case '--no-hosts': flags.hosts = false; break;
      case '--host-ip': flags.hostIp = value(); break;
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
  if (targets.size > 0) flags.targets = [...targets];
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

async function printInfo(config, setup) {
  const detected = detectProviders().map((p) => p.label).join(', ') || 'none';
  console.log(`Config file      ${config.configFile ?? '(none)'}`);
  console.log(`Detected         ${detected}`);
  console.log(`Using            ${setup.ca.label}`);
  console.log(`Certificate      ${setup.ca.path}`);
  console.log(`Certificate dirs ${setup.certificateDirs.join(', ') || '(none)'}`);
  console.log(`Sites            ${setup.sites.map((s) => s.domain).join(', ') || '(none)'}`);
  console.log(`Serve on         http://${config.host}:${config.port}/`);

  const running = await detectTargets();
  console.log(`Running          ${running.map(targetLabel).join(', ') || 'nothing'}`);
  console.log(`Target           ${(config.targets ?? running).map(targetLabel).join(', ') || '(none)'}`);
  console.log(`Device           ${config.device ?? '(the running one)'}`);

  if ((config.targets ?? running).includes('android')) {
    console.log(`Host address     ${config.hostIp ?? android.HOST_LOOPBACK}`);
    console.log(`Hosts file       ${config.hosts === false ? 'skipped' : 'will map the sites above'}`);
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    process.stdout.write(USAGE);
    return;
  }

  const config = loadConfig(flags);
  const setup = resolveSetup(config);

  if (config.info) {
    await printInfo(config, setup);
    return;
  }

  const targets = await resolveTargets({ requested: config.targets });

  // One name cannot mean two different devices, and silently applying it to the
  // wrong one is worse than asking.
  if (config.device && targets.length > 1) {
    throw new Error('--device names a single device, so pick one of --ios or --android with it.');
  }

  const info = describeCa(setup.ca.path);
  console.log(`Certificate  ${info.commonName ?? setup.ca.path} (${setup.ca.label})`);
  console.log(`             ${setup.ca.path}`);

  // Resolve every device up front so a missing emulator fails before we have
  // half-installed the certificate on the other target.
  const devices = await openDevices(targets, config);

  if (config.settings) {
    for (const device of devices) await device.openInstallScreen();
    return;
  }

  if (config.trust) {
    for (const device of devices) await device.trust(setup);
    return;
  }

  await serve(devices, config, setup, info);
}

/**
 * Bind each chosen target to the device it will drive.
 *
 * Both platforms answer the same four questions — how to name themselves, how to
 * show the page, how to trust the CA outright, and how to reach the install
 * screen — so the rest of the CLI can treat them as one kind of thing.
 */
async function openDevices(targets, config) {
  const devices = [];

  for (const target of targets) {
    devices.push(target === 'ios' ? await iosDevice(config) : await androidDevice(config));
  }

  return devices;
}

async function iosDevice(config) {
  if (process.platform !== 'darwin') {
    throw new Error('The iOS Simulator only exists on macOS. Use --android.');
  }

  const device = await ios.ensureBooted(ios.pickDevice(config.device));

  return {
    target: 'ios',
    label: device.name,
    urlFor: (url) => url,

    async show(url, sites) {
      await ios.openUrl(device, url);
      await reportIosDns(device, sites);
    },

    async trust(setup) {
      await ios.addRootCert(device, setup.ca.path);
      console.log(`Trusted      ${device.name}, no profile install needed`);
      await reportIosDns(device, setup.sites);
    },

    async openInstallScreen() {
      await ios.openSettings(device);
      console.log(`Settings     opened on ${device.name} — tap "Profile Downloaded" at the top`);
    },

    steps: [
      'Tap "Download certificate profile", then Allow',
      'Settings > General > VPN & Device Management > install it',
      'Settings > General > About > Certificate Trust Settings > switch it on',
    ],
    note: 'Step 3 is the one people miss: installing the profile alone does not make iOS\ntrust it for HTTPS. "simcert --ios --trust" does all three in one go.',
  };
}

async function androidDevice(config) {
  const device = await android.pickDevice(config.device);
  const label = android.deviceLabel(device);

  return {
    target: 'android',
    label,
    urlFor: (url) => android.deviceUrl(url),

    async show(url, sites) {
      const domains = sites.map((site) => site.domain);
      if (config.hosts !== false) await mapHosts(device, domains, config.hostIp ?? android.HOST_LOOPBACK);
      await android.openUrl(device, url);
      await reportAndroidDns(device, domains);
    },

    async trust(setup) {
      const domains = setup.sites.map((site) => site.domain);
      if (config.hosts !== false) await mapHosts(device, domains, config.hostIp ?? android.HOST_LOOPBACK);

      await android.ensureRoot(device);
      await android.remountSystem(device);
      const result = await android.addRootCert(device, setup.ca.path);
      console.log(`Trusted      ${result.name} in ${label}'s system store`);

      if (result.overlaid) {
        console.log('             (Android 14+ reads the Conscrypt store, so this is a bind mount:');
        console.log('              it is lost on reboot. Re-run simcert after restarting the emulator.)');
      }

      await reportAndroidDns(device, domains);
    },

    async openInstallScreen() {
      await android.openCertInstaller(device);
      console.log(`Installer    opened on ${label} — pick the .crt at the top of Recents`);
    },

    steps: [
      'Tap "Download certificate"',
      'Press s here, or find Settings > Security & privacy > More security & privacy >\n     Encryption & credentials > Install a certificate > CA certificate',
      'Pick the downloaded file and give it any name',
    ],
    note: 'That installs a user certificate, which the browser trusts but apps do not. For\nyour own app, trust user certificates in its network security config, or run\n"simcert --android --trust" to write it into the system store over adb.',
  };
}

async function serve(devices, config, setup, info) {
  const { server, url } = await startServer({
    ca: { ...setup.ca, contents: readCa(setup.ca.path) },
    info,
    sites: setup.sites,
    host: config.host,
    port: config.port,
    renderPage: installPage,
    platform: devices[0].target,

    // The button on the page reaches the device it was tapped on. With one
    // target the match is trivial; with both it is what keeps a tap in the
    // emulator from also opening Settings on the Simulator.
    onOpenSettings: config.open === false ? null : async (platform) => {
      const device = devices.find((d) => d.target === platform) ?? devices[0];
      await device.openInstallScreen();
      return device.label;
    },
  });

  console.log(`Serving      ${url}`);

  if (config.open !== false) {
    for (const device of devices) {
      const deviceUrl = device.urlFor(url);
      await device.show(deviceUrl, setup.sites);
      console.log(`Opened in    ${device.label}${deviceUrl === url ? '' : `  (${deviceUrl})`}`);
    }
  }

  for (const device of devices) {
    console.log(`\nOn ${device.label} (${targetLabel(device.target)}):`);
    device.steps.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
    console.log(`\n${device.note}`);
  }

  const stop = () => { server.close(); process.exit(0); };
  process.on('SIGTERM', stop);
  listenForKeys(devices, stop);
}

/**
 * Watch the terminal while the server runs.
 *
 * The install screen is only worth opening once the file has actually been
 * downloaded, which is a moment only the person holding the device knows about —
 * so it is a keypress rather than something we fire on a timer.
 */
function listenForKeys(devices, stop) {
  if (!process.stdin.isTTY) {
    console.log('\nCtrl-C when you are done.');
    process.on('SIGINT', stop);
    return;
  }

  console.log('\nPress s once the file has downloaded to jump to the install screen, q to quit.');

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', async (key) => {
    // Raw mode swallows SIGINT, so Ctrl-C has to be recognised by hand.
    if (key === '' || key.toLowerCase() === 'q') {
      process.stdin.setRawMode(false);
      stop();
      return;
    }

    if (key.toLowerCase() !== 's') return;

    for (const device of devices) {
      await device.openInstallScreen().catch((error) => {
        console.log(`\n! Could not open the install screen on ${device.label}: ${error.message}`);
      });
    }
  });
}

// Writing the hosts file needs the same root the system store does, but the page
// route is still useful without it, so a refusal here is a warning not an error.
async function mapHosts(device, domains, ip) {
  if (!domains || domains.length === 0) return;

  if (!(await android.tryRoot(device))) {
    console.log(`\n! Cannot write the emulator's hosts file without adb root, so ${domains[0]} will`);
    console.log(`  not resolve inside it.\n\n${android.ROOT_HELP}\n`);
    return;
  }

  try {
    await android.remountSystem(device);
    const { written } = await android.setHosts(device, domains, ip);
    console.log(`Hosts        ${written.length} domain${written.length === 1 ? '' : 's'} -> ${ip}`);
  } catch (error) {
    console.log(`\n! Could not write the hosts file: ${error.message}\n`);
  }
}

async function reportAndroidDns(device, domains) {
  const [domain] = domains ?? [];
  if (!domain) return;

  const address = await android.resolves(device, domain);
  if (address === null) return;
  if (address === false) {
    console.log(`\n! ${domain} does not resolve in the emulator. Re-run without --no-hosts.`);
    return;
  }
  console.log(`Resolves     ${domain} -> ${address}`);
}

// Trusting the CA is pointless if the simulator can't resolve the domain at all,
// so say so up front rather than letting it look like a certificate problem.
async function reportIosDns(device, sites) {
  const [site] = sites ?? [];
  if (!site) return;
  if (await ios.resolves(device, site.domain) !== false) return;
  console.log(`\n! ${site.domain} does not resolve in the Simulator. Check DNS on the host first.`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
