import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

function simctlJson(args) {
  let out;
  try {
    out = execFileSync('xcrun', ['simctl', ...args, '-j'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    throw new Error(
      'Could not run "xcrun simctl". Install Xcode from the App Store, open it once to ' +
        'finish setup, then add an iOS runtime under Xcode > Settings > Components.',
    );
  }
  return JSON.parse(out);
}

function runtimeVersion(runtimeId) {
  const m = runtimeId.match(/iOS-(\d+)(?:-(\d+))?/);
  if (!m) return -1;
  return Number(m[1]) * 1000 + Number(m[2] ?? 0);
}

function allDevices() {
  const { devices } = simctlJson(['list', 'devices', 'available']);
  return Object.entries(devices)
    .filter(([runtime]) => runtime.includes('iOS'))
    .flatMap(([runtime, list]) =>
      list
        .filter((d) => d.isAvailable !== false)
        .map((d) => ({ udid: d.udid, name: d.name, state: d.state, runtime, version: runtimeVersion(runtime) })),
    );
}

export function pickDevice(wanted) {
  const devices = allDevices();
  if (devices.length === 0) throw new Error('No available iOS simulators found. Install a runtime via Xcode > Settings > Components.');

  if (wanted) {
    const match = devices.find((d) => d.udid === wanted || d.name.toLowerCase() === wanted.toLowerCase());
    if (!match) throw new Error(`No simulator matching "${wanted}". Run: xcrun simctl list devices available`);
    return match;
  }

  const booted = devices.find((d) => d.state === 'Booted');
  if (booted) return booted;

  // Nothing running: prefer the newest iPhone so the flow works from a cold start.
  const iphones = devices.filter((d) => d.name.startsWith('iPhone'));
  const pool = iphones.length > 0 ? iphones : devices;
  return pool.sort((a, b) => b.version - a.version)[0];
}

export async function ensureBooted(device) {
  if (device.state === 'Booted') {
    await run('open', ['-a', 'Simulator']);
    return device;
  }
  await run('xcrun', ['simctl', 'boot', device.udid]);
  await run('open', ['-a', 'Simulator']);
  await run('xcrun', ['simctl', 'bootstatus', device.udid, '-b']);
  return { ...device, state: 'Booted' };
}

export async function openUrl(device, url) {
  await run('xcrun', ['simctl', 'openurl', device.udid, url]);
}

export async function addRootCert(device, certPath) {
  await run('xcrun', ['simctl', 'keychain', device.udid, 'add-root-cert', certPath]);
}

// getaddrinfo inside the simulator goes through the host's resolver, so this is
// the same lookup Safari will do. Returns null when the check itself couldn't
// run, so a missing tool in an old runtime never reads as a DNS failure.
export async function resolves(device, host) {
  try {
    const { stdout } = await run('xcrun', ['simctl', 'spawn', device.udid, '/usr/bin/dscacheutil', '-q', 'host', '-a', 'name', host]);
    return /ip(v6)?_address:/.test(stdout);
  } catch {
    return null;
  }
}
