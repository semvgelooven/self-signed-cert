import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const home = (...parts) => join(homedir(), ...parts);

function mkcertCaRoot() {
  if (process.env.CAROOT) return process.env.CAROOT;
  const bins = [
    home('.local/share/lerd/bin/mkcert'),
    '/opt/homebrew/bin/mkcert',
    '/usr/local/bin/mkcert',
  ];
  for (const bin of bins) {
    if (!existsSync(bin)) continue;
    try {
      return execFileSync(bin, ['-CAROOT'], { encoding: 'utf8' }).trim();
    } catch {
      // mkcert is there but wouldn't answer; fall through to the usual location
    }
  }
  return home('Library/Application Support/mkcert');
}

const HERD_CONFIG = 'Library/Application Support/Herd/config/valet';

// `dir` is what proves the tool is installed at all. Without it, a shared CA
// (lerd and Herd can both sit on mkcert's root) would make an absent tool look
// present. `certificates` holds one <domain>.crt per secured site in all of
// them, which is why site discovery needs no tool-specific parsing.
export const PROVIDERS = [
  {
    id: 'lerd',
    label: 'lerd',
    dir: () => home('.local/share/lerd'),
    ca: () => [join(mkcertCaRoot(), 'rootCA.pem')],
    certificates: () => [home('.local/share/lerd/certs/sites')],
  },
  {
    id: 'herd',
    label: 'Herd',
    dir: () => home('Library/Application Support/Herd'),
    ca: () => [home(HERD_CONFIG, 'CA/LaravelValetCASelfSigned.pem'), join(mkcertCaRoot(), 'rootCA.pem')],
    certificates: () => [home(HERD_CONFIG, 'Certificates')],
  },
  {
    id: 'valet',
    label: 'Valet',
    dir: () => home('.config/valet'),
    ca: () => [home('.config/valet/CA/LaravelValetCASelfSigned.pem')],
    certificates: () => [home('.config/valet/Certificates')],
  },
  {
    // Bare mkcert, for anyone not using one of the three above.
    id: 'mkcert',
    label: 'mkcert',
    dir: () => mkcertCaRoot(),
    ca: () => [join(mkcertCaRoot(), 'rootCA.pem')],
    certificates: () => [],
  },
];

export const PROVIDER_IDS = PROVIDERS.map((p) => p.id);

function resolve(provider) {
  return {
    id: provider.id,
    label: provider.label,
    installed: existsSync(provider.dir()),
    caPath: provider.ca().find(existsSync) ?? null,
    certificateDirs: provider.certificates().filter(existsSync),
  };
}

export function detectProviders() {
  return PROVIDERS.map(resolve).filter((p) => p.installed && p.caPath);
}

export function selectProvider(id) {
  if (!id) {
    const [first] = detectProviders();
    if (first) return first;
    const looked = PROVIDERS.map((p) => `  - ${p.dir()}`).join('\n');
    throw new Error(
      `No local dev tooling found. Looked for:\n${looked}\n\n` +
        'Point at a certificate directly with --ca <path>, or set it in simcert.config.json.',
    );
  }

  const provider = PROVIDERS.find((p) => p.id === id);
  if (!provider) throw new Error(`Unknown provider "${id}". Known: ${PROVIDER_IDS.join(', ')}`);

  const resolved = resolve(provider);
  if (!resolved.installed) {
    throw new Error(`${provider.label} doesn't look installed: nothing at ${provider.dir()}`);
  }
  if (!resolved.caPath) {
    throw new Error(
      `${provider.label} is installed but has no root CA yet. Looked for:\n` +
        `${provider.ca().map((p) => `  - ${p}`).join('\n')}\n\n` +
        'Secure a site with that tool first, so it generates one.',
    );
  }
  return resolved;
}
