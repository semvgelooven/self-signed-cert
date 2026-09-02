import { readdirSync } from 'node:fs';

// Valet, Herd and lerd all write <domain>.crt per secured site, so the contents
// of the certificates directory *is* the list of sites that speak HTTPS.
export function securedDomains({ certificateDirs = [], extraDomains = [] } = {}) {
  const domains = new Set(extraDomains.map((d) => d.trim()).filter(Boolean));

  for (const dir of certificateDirs) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue; // configured but unreadable, so it contributes nothing
    }
    for (const entry of entries) {
      if (entry.endsWith('.crt')) domains.add(entry.slice(0, -'.crt'.length));
    }
  }

  return [...domains].sort().map((domain) => ({ domain }));
}
