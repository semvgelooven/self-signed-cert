import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export const DEFAULTS = { host: '127.0.0.1', port: 8080 };

const CONFIG_FILES = [
  join(process.cwd(), 'simcert.config.json'),
  join(homedir(), '.config/simcert/config.json'),
];

function readConfigFile(explicitPath) {
  const path = explicitPath ? resolve(explicitPath) : CONFIG_FILES.find(existsSync);
  if (!path) return { source: null, values: {} };
  if (!existsSync(path)) throw new Error(`No config file at ${path}`);

  try {
    return { source: path, values: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (error) {
    throw new Error(`Could not read ${path}: ${error.message}`);
  }
}

const list = (value) => {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value;
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
};

const KNOWN_TARGETS = ['ios', 'android'];

// Accepts "ios", "android", "both", or a list of those, from either a config
// file or the environment.
export function normalizeTargets(value) {
  const named = list(value)?.flatMap((t) => {
    const id = t.toLowerCase();
    return id === 'both' || id === 'all' ? KNOWN_TARGETS : [id];
  });
  if (!named) return undefined;

  const unknown = named.find((t) => !KNOWN_TARGETS.includes(t));
  if (unknown) throw new Error(`Unknown target "${unknown}". Known: ${KNOWN_TARGETS.join(', ')}, both`);
  return [...new Set(named)];
}

// SIMCERT_ANDROID=1 is the older spelling of SIMCERT_TARGET=android, kept
// working because it was documented.
function targetList(env) {
  return normalizeTargets(env.SIMCERT_TARGET)
    ?? (env.SIMCERT_ANDROID && env.SIMCERT_ANDROID !== '0' ? ['android'] : undefined);
}

function fromEnv(env) {
  return {
    provider: env.SIMCERT_PROVIDER,
    ca: env.SIMCERT_CA,
    certificateDirs: env.SIMCERT_CERT_DIRS ? env.SIMCERT_CERT_DIRS.split(':').filter(Boolean) : undefined,
    domains: list(env.SIMCERT_DOMAINS),
    device: env.SIMCERT_DEVICE,
    host: env.SIMCERT_HOST,
    port: env.SIMCERT_PORT ? Number(env.SIMCERT_PORT) : undefined,
    targets: targetList(env),
    hostIp: env.SIMCERT_HOST_IP,
    hosts: env.SIMCERT_HOSTS ? env.SIMCERT_HOSTS !== '0' : undefined,
  };
}

const defined = (object) => Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined));

const expand = (path, base) => {
  if (!path) return path;
  const withHome = path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
  return isAbsolute(withHome) ? withHome : resolve(base, withHome);
};

// Precedence, weakest first: built-in defaults, config file, environment, flags.
export function loadConfig(flags = {}) {
  const { source, values } = readConfigFile(flags.config);
  const base = source ? join(source, '..') : process.cwd();

  const merged = {
    ...DEFAULTS,
    ...defined({
      ...values,
      domains: list(values.domains),
      certificateDirs: list(values.certificateDirs),
      targets: normalizeTargets(values.targets ?? (values.android ? 'android' : undefined)),
    }),
    ...defined(fromEnv(process.env)),
    ...defined(flags),
  };

  if (merged.port !== undefined && !Number.isInteger(merged.port)) {
    throw new Error('port must be a whole number');
  }

  return {
    ...merged,
    configFile: source,
    // Relative paths in a config file read from where that file lives.
    ca: expand(merged.ca, base),
    certificateDirs: (merged.certificateDirs ?? []).map((dir) => expand(dir, base)),
    domains: merged.domains ?? [],
  };
}
