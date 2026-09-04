import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Where Android keeps the CAs that apps actually consult. Until Android 14 that
// was the /system copy; since then apps read the Conscrypt APEX and the /system
// one is only the seed for it. Writing to /system alone changes nothing.
const SYSTEM_STORE = '/system/etc/security/cacerts';
const APEX_STORE = '/apex/com.android.conscrypt/cacerts';

// The staging directory we bind over APEX_STORE. It has to be a real directory
// we can write, because the APEX itself is mounted read-only.
const STAGE = '/data/local/tmp/simcert-cacerts';

const HOSTS = '/system/etc/hosts';

// The emulator's alias for the host's loopback. 127.0.0.1 inside the guest is
// the guest, so a .test domain pointed there resolves to nothing.
export const HOST_LOOPBACK = '10.0.2.2';

const BEGIN = '# simcert:begin';
const END = '# simcert:end';

function adbPath() {
  const candidates = [
    process.env.ADB,
    ...[process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]
      .filter(Boolean)
      .map((sdk) => join(sdk, 'platform-tools/adb')),
    join(homedir(), 'Library/Android/sdk/platform-tools/adb'),
    '/opt/homebrew/bin/adb',
    '/usr/local/bin/adb',
  ].filter(Boolean);

  const found = candidates.find(existsSync);
  if (found) return found;

  // Not at any known path, but it may still be on PATH.
  try {
    execFileSync('adb', ['version'], { stdio: 'ignore' });
    return 'adb';
  } catch {
    throw new Error(
      'Could not find adb. Install Android Studio, or the platform-tools package, then\n' +
        'either put adb on your PATH or set ANDROID_HOME to your SDK directory.',
    );
  }
}

let cachedAdb = null;
const adbBin = () => (cachedAdb ??= adbPath());

function adb(device, args, options = {}) {
  const serial = device?.serial ? ['-s', device.serial] : [];
  return run(adbBin(), [...serial, ...args], { encoding: 'utf8', ...options });
}

// One shell round trip. Returns stdout even when the script sets a non-zero
// status, because `adb shell` reports the *connection* result, not the command's.
async function sh(device, script) {
  const { stdout } = await adb(device, ['shell', script]);
  return stdout.trim();
}

export async function listDevices() {
  const { stdout } = await adb(null, ['devices', '-l']);
  const devices = [];

  for (const line of stdout.split('\n').slice(1)) {
    const [serial, state] = line.trim().split(/\s+/);
    if (!serial || !state) continue;
    devices.push({ serial, state, emulator: serial.startsWith('emulator-') });
  }

  return devices;
}

// The AVD name is nicer to match on than "emulator-5554", and it is what the
// user sees in Android Studio.
async function avdName(device) {
  if (!device.emulator) return null;
  try {
    const { stdout } = await adb(device, ['emu', 'avd', 'name']);
    return stdout.split('\n')[0].trim() || null;
  } catch {
    return null;
  }
}

export async function pickDevice(wanted) {
  const devices = await listDevices();
  const usable = devices.filter((d) => d.state === 'device');

  if (usable.length === 0) {
    const offline = devices.length > 0 ? '\nSeen but not ready: ' + devices.map((d) => `${d.serial} (${d.state})`).join(', ') : '';
    throw new Error(
      `No running Android emulator.\n\nStart one first, and start it writable:\n` +
        `  emulator -avd <name> -writable-system${offline}`,
    );
  }

  const named = await Promise.all(usable.map(async (d) => ({ ...d, avd: await avdName(d) })));

  if (wanted) {
    const match = named.find((d) => d.serial === wanted || d.avd?.toLowerCase() === wanted.toLowerCase());
    if (!match) {
      const known = named.map((d) => `  - ${d.serial}${d.avd ? ` (${d.avd})` : ''}`).join('\n');
      throw new Error(`No emulator matching "${wanted}". Running:\n${known}`);
    }
    return match;
  }

  // Prefer a real emulator over an attached handset: we are about to remount
  // /system, which is not something to do to someone's phone by accident.
  return named.find((d) => d.emulator) ?? named[0];
}

export const deviceLabel = (device) => (device.avd ? `${device.avd} (${device.serial})` : device.serial);

export async function apiLevel(device) {
  const level = await sh(device, 'getprop ro.build.version.sdk');
  return Number(level) || 0;
}

export const ROOT_HELP =
  'Google Play emulator images are production builds and never allow adb root, so\n' +
  'their certificate store and hosts file cannot be written. Use a "Google APIs"\n' +
  'image instead (same Android, no Play Store):\n' +
  '  sdkmanager "system-images;android-36;google_apis;arm64-v8a"\n' +
  '  avdmanager create avd -n <name> -k "system-images;android-36;google_apis;arm64-v8a"\n' +
  '  emulator -avd <name> -writable-system';

/**
 * Restart adbd as root, reporting whether it worked rather than throwing.
 *
 * Only userdebug images allow it, and the browser-install flow still has value
 * without it, so callers decide whether a refusal is fatal.
 */
export async function tryRoot(device) {
  const { stdout, stderr } = await adb(device, ['root']).catch((e) => ({ stdout: '', stderr: e.message }));
  if (/cannot run as root/i.test(`${stdout}${stderr}`)) return false;

  await adb(device, ['wait-for-device']);
  return true;
}

export async function ensureRoot(device) {
  if (!(await tryRoot(device))) {
    throw new Error(`This emulator will not let adb run as root.\n\n${ROOT_HELP}`);
  }
}

/**
 * Get /system mounted read-write.
 *
 * The first remount usually only disables dm-verity and needs a reboot before it
 * takes; doing it in one call here keeps that off the user's plate.
 */
export async function remountSystem(device) {
  const first = await adb(device, ['remount']).catch((e) => ({ stdout: '', stderr: e.message }));
  if (/remounted .* as RW|remount succeeded/i.test(`${first.stdout}${first.stderr}`)) return;

  await adb(device, ['reboot']);
  await adb(device, ['wait-for-device']);
  await waitForBoot(device);
  await ensureRoot(device);

  const second = await adb(device, ['remount']).catch((e) => ({ stdout: '', stderr: e.message }));
  if (!/remounted .* as RW|remount succeeded/i.test(`${second.stdout}${second.stderr}`)) {
    throw new Error(
      'Could not remount /system as writable. Start the emulator with -writable-system:\n' +
        '  emulator -avd <name> -writable-system',
    );
  }
}

async function waitForBoot(device, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const done = await sh(device, 'getprop sys.boot_completed').catch(() => '');
    if (done === '1') return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('The emulator did not finish booting in time.');
}

/**
 * Android looks a CA up by the old OpenSSL subject hash, so the file has to be
 * named <hash>.0 or it is simply never consulted.
 */
function certFilename(caPath) {
  const hash = execFileSync('openssl', ['x509', '-inform', 'PEM', '-subject_hash_old', '-in', caPath, '-noout'], {
    encoding: 'utf8',
  }).trim();
  if (!/^[0-9a-f]{8}$/.test(hash)) throw new Error(`Could not derive an Android hash for ${caPath}`);
  return `${hash}.0`;
}

// The store holds the PEM followed by the human-readable dump. Only the PEM is
// load-bearing, but matching the platform's own format keeps tooling happy.
function certContents(caPath) {
  const pem = readFileSync(caPath, 'utf8');
  const text = execFileSync('openssl', ['x509', '-in', caPath, '-noout', '-text'], { encoding: 'utf8' });
  return `${pem.trimEnd()}\n${text}`;
}

/**
 * Install a root CA so every app on the device trusts it.
 *
 * Two steps, because Android 14 split the store in two: the /system copy is what
 * survives a reboot, and the bind mount over the APEX copy is what the running
 * system actually reads.
 */
export async function addRootCert(device, caPath) {
  const name = certFilename(caPath);
  const local = join(tmpdir(), name);
  writeFileSync(local, certContents(caPath));

  await adb(device, ['push', local, `/data/local/tmp/${name}`]);
  await sh(device, `cp /data/local/tmp/${name} ${SYSTEM_STORE}/${name} && chmod 644 ${SYSTEM_STORE}/${name}`);

  const level = await apiLevel(device);
  if (level >= 34) await overlayApexStore(device, name);

  return { name, apiLevel: level, overlaid: level >= 34 };
}

/**
 * Shadow the read-only APEX trust store with a writable copy that has our CA in
 * it.
 *
 * The mount has to land in the zygote's namespace as well as init's: apps are
 * forked from zygote and inherit its mounts, so a mount made only in the shell's
 * namespace is invisible to every app on the device — it looks like the CA was
 * installed and ignored.
 */
async function overlayApexStore(device, name) {
  if (await apexHasCert(device, name)) return;

  await sh(
    device,
    [
      `rm -rf ${STAGE}`,
      `mkdir -p ${STAGE}`,
      `cp ${APEX_STORE}/* ${STAGE}/ 2>/dev/null`,
      `cp ${SYSTEM_STORE}/${name} ${STAGE}/`,
      `chmod 755 ${STAGE}`,
      `chmod 644 ${STAGE}/*`,
      // Conscrypt reads these under a label of its own; system_file is readable
      // by root but not by the apps that need it.
      `chcon u:object_r:system_security_cacerts_file:s0 ${STAGE} ${STAGE}/* 2>/dev/null`,
    ].join('\n'),
  );

  const pids = await sh(device, 'echo 1 $(pidof zygote64) $(pidof zygote)');
  for (const pid of pids.split(/\s+/).filter(Boolean)) {
    await sh(device, `nsenter --mount=/proc/${pid}/ns/mnt -- mount --bind ${STAGE} ${APEX_STORE} 2>/dev/null`);
  }
}

// Checked from inside zygote's namespace, because that is the view apps get.
async function apexHasCert(device, name) {
  const seen = await sh(
    device,
    `Z=$(pidof zygote64); [ -n "$Z" ] && [ -f /proc/$Z/root${APEX_STORE}/${name} ] && echo yes || echo no`,
  );
  return seen === 'yes';
}

/**
 * Point domains at the host machine in the emulator's hosts file.
 *
 * Entries live between markers so re-running replaces them instead of appending
 * a duplicate every time.
 */
export async function setHosts(device, domains, ip = HOST_LOOPBACK) {
  if (domains.length === 0) return { written: [], path: HOSTS };

  const current = await sh(device, `cat ${HOSTS}`);
  const kept = stripManagedBlock(current);
  const block = [BEGIN, ...domains.map((domain) => `${ip}\t${domain}`), END].join('\n');
  const next = `${kept}\n${block}\n`;

  const local = join(tmpdir(), 'simcert-hosts');
  writeFileSync(local, next);
  await adb(device, ['push', local, HOSTS]);
  await sh(device, `chmod 644 ${HOSTS}`);

  return { written: domains, path: HOSTS };
}

function stripManagedBlock(contents) {
  const lines = contents.split('\n');
  const out = [];
  let skipping = false;

  for (const line of lines) {
    if (line.trim() === BEGIN) { skipping = true; continue; }
    if (line.trim() === END) { skipping = false; continue; }
    if (!skipping) out.push(line);
  }

  return out.join('\n').trimEnd();
}

export async function readHosts(device) {
  return sh(device, `cat ${HOSTS}`);
}

/**
 * The URL the emulator should use to reach a server on this machine.
 *
 * The host's loopback is not the guest's, so a page served on 127.0.0.1 has to
 * be opened as 10.0.2.2 inside the emulator.
 */
export function deviceUrl(url) {
  const parsed = new URL(url);
  if (['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(parsed.hostname)) {
    parsed.hostname = HOST_LOOPBACK;
  }
  return parsed.toString();
}

export async function openUrl(device, url) {
  await adb(device, ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', deviceUrl(url)]);
}

// Same lookup an app will do. Null when the check itself could not run, so a
// missing tool never reads as a DNS failure.
export async function resolves(device, host) {
  try {
    const out = await sh(device, `ping -c 1 -W 2 ${host} 2>&1 | head -1`);
    const match = out.match(/\(([\d.]+)\)/);
    return match ? match[1] : false;
  } catch {
    return null;
  }
}

/**
 * Open the certificate picker on the device.
 *
 * This is the screen that Settings > Security & privacy > More security &
 * privacy > Encryption & credentials > Install a certificate > CA certificate
 * finally opens, so firing the intent directly replaces five taps of hunting.
 * The file the user just downloaded is the top entry under Recents.
 *
 * Handing CertInstaller the file ourselves doesn't work: it is launched as the
 * shell user, so a file:// URI to the download is rejected and the activity
 * exits without showing anything. Letting the picker supply the content:// URI
 * is the route that actually completes.
 */
export async function openCertInstaller(device) {
  await adb(device, ['shell', 'am', 'start', '-a', 'android.credentials.INSTALL']);
}
