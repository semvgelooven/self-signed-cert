import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export function readCa(path) {
  if (!existsSync(path)) throw new Error(`No certificate at ${path}`);
  return readFileSync(path);
}

// Pull the human-readable bits out of the cert so the install page can show what
// is about to be trusted. Never fatal: the page just shows less.
export function describeCa(path) {
  const info = { subject: null, commonName: null, expires: null, fingerprint: null };
  try {
    const out = execFileSync(
      'openssl',
      ['x509', '-in', path, '-noout', '-subject', '-enddate', '-fingerprint', '-sha256'],
      { encoding: 'utf8' },
    );
    for (const line of out.split('\n')) {
      if (line.startsWith('subject=')) info.subject = line.slice('subject='.length).trim();
      if (line.startsWith('notAfter=')) info.expires = line.slice('notAfter='.length).trim();
      if (line.includes('Fingerprint=')) info.fingerprint = line.split('Fingerprint=')[1].trim();
    }
    if (info.subject) {
      const cn = info.subject.match(/CN\s*=\s*([^,]+)/);
      if (cn) info.commonName = cn[1].trim();
    }
  } catch {
    // openssl missing or cert unreadable by it; the download still works
  }
  return info;
}
