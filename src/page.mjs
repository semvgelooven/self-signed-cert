const escape = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Values that land inside <script> need JS-string quoting, not HTML escaping.
// Escaping < as well keeps a "</script>" in any value from closing the block.
const js = (value) => JSON.stringify(String(value ?? '')).replace(/</g, '\\u003c');

function siteRow(site) {
  const url = `https://${site.domain}`;
  return `
      <li class="site" data-url="${escape(url)}">
        <div class="site-main">
          <a class="site-domain" href="${escape(url)}">${escape(site.domain)}</a>
          <span class="site-status" data-status>not checked</span>
        </div>
        <button type="button" data-check>Check</button>
      </li>`;
}

const SECURE_HINT = {
  lerd: 'Run <code>lerd secure</code> in a project first.',
  valet: 'Run <code>valet secure</code> in a project first.',
  herd: 'Turn on HTTPS for a site in Herd first.',
  mkcert: 'Add them under <code>domains</code> in <code>simcert.config.json</code>.',
};

// What the two platforms need the reader to do differs enough that only the
// chrome around it is shared. Keeping both here means one page to restyle.
const PLATFORMS = {
  ios: {
    lede: 'Install this root certificate so Safari here stops warning about your local development sites.',
    download: 'Download certificate profile',
    openSettings: 'Open Settings',
    // iOS ignores the path= part of App-prefs: URLs, so the root of Settings is
    // as close as anything can get. The profile is waiting at the top of it.
    openSettingsHint: 'the profile is at the top',
    heading: 'Then, in Settings',
    steps: [
      'Press <span class="path">s</span> in the terminal to open Settings — the downloaded profile is waiting at the top. Or go to <span class="path">Settings &rsaquo; General &rsaquo; VPN &amp; Device Management</span> yourself.',
      'Open <span class="path">Settings &rsaquo; General &rsaquo; About &rsaquo; Certificate Trust Settings</span> and switch it on for this certificate.',
      'Come back and check a site below.',
    ],
    note: 'Step 2 is the one people miss. Installing the profile alone does not make iOS trust it for HTTPS.',
  },
  android: {
    lede: 'Install this root certificate so the browser here stops warning about your local development sites.',
    download: 'Download certificate',
    openSettings: 'Open certificate picker',
    openSettingsHint: 'pick the file you just downloaded',
    heading: 'Then, in Settings',
    steps: [
      'Press <span class="path">s</span> in the terminal to jump straight to the certificate picker — or open <span class="path">Settings &rsaquo; Security &amp; privacy &rsaquo; More security &amp; privacy &rsaquo; Encryption &amp; credentials &rsaquo; Install a certificate &rsaquo; CA certificate</span> yourself.',
      'Pick the file you just downloaded and give it any name.',
      'Come back and check a site below.',
    ],
    // The honest limit of this route: it lands in the user store, and since
    // Android 7 apps ignore that unless they opt in.
    note:
      'This installs a <strong>user</strong> certificate, which the browser trusts but apps do not. ' +
      'For your own app, either add a network security config that trusts <code>user</code> certificates, ' +
      'or run <code>simcert --android --trust</code> to write it into the system store over adb.',
  },
};

export function installPage({ ca, info, sites, certUrl, platform = 'ios' }) {
  const copy = PLATFORMS[platform] ?? PLATFORMS.ios;
  const hint = SECURE_HINT[ca.id] ?? SECURE_HINT.mkcert;
  const siteList = sites.length
    ? `<ul class="sites">${sites.map(siteRow).join('')}</ul>`
    : `<p class="muted">No secured sites found for ${escape(ca.label)}. ${hint}</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Trust local dev CA</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f6f7;
    --card: #ffffff;
    --ink: #16171a;
    --muted: #6b7076;
    --line: #e2e4e8;
    --accent: #2f6df6;
    --ok: #1a7f4b;
    --bad: #c0392b;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#111214; --card:#1b1d20; --ink:#f2f3f5; --muted:#9aa0a6; --line:#2c2f34; --accent:#5b8dff; --ok:#4ade80; --bad:#f87171; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px 18px calc(48px + env(safe-area-inset-bottom));
    background: var(--bg);
    color: var(--ink);
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
    -webkit-text-size-adjust: 100%;
  }
  main { max-width: 640px; margin: 0 auto; }
  h1 { font-size: 24px; line-height: 1.25; margin: 0 0 6px; letter-spacing: -0.02em; }
  .lede { color: var(--muted); margin: 0 0 22px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; margin-bottom: 18px; }
  .card h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 0 0 12px; }
  dl { margin: 0; display: grid; grid-template-columns: 92px 1fr; gap: 8px 14px; }
  dt { color: var(--muted); font-size: 14px; }
  dd { margin: 0; font-size: 14px; overflow-wrap: anywhere; }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  .cta {
    display: block; text-align: center; text-decoration: none;
    background: var(--accent); color: #fff; font-weight: 600;
    padding: 15px; border-radius: 12px; margin-bottom: 18px;
  }
  .cta-secondary {
    width: 100%; font: inherit; font-weight: 600;
    background: transparent; color: var(--accent);
    border: 1px solid var(--accent); padding: 14px;
  }
  .cta-secondary:disabled { opacity: 0.5; }
  .open-status { margin: -8px 0 18px; font-size: 14px; color: var(--muted); text-align: center; }
  .open-status[data-state="bad"] { color: var(--bad); }
  ol.steps { margin: 0; padding-left: 20px; }
  ol.steps li { margin-bottom: 10px; }
  ol.steps li:last-child { margin-bottom: 0; }
  .path { font-weight: 600; }
  .note { border-left: 3px solid var(--accent); padding-left: 12px; color: var(--muted); font-size: 14px; margin-top: 14px; }
  ul.sites { list-style: none; margin: 0; padding: 0; }
  .site { display: flex; align-items: center; gap: 12px; padding: 11px 0; border-bottom: 1px solid var(--line); }
  .site:last-child { border-bottom: 0; padding-bottom: 0; }
  .site-main { flex: 1; min-width: 0; }
  .site-domain { display: block; color: var(--accent); text-decoration: none; font-weight: 600; overflow-wrap: anywhere; }
  .site-status { font-size: 13px; color: var(--muted); }
  .site-status[data-state="ok"] { color: var(--ok); }
  .site-status[data-state="bad"] { color: var(--bad); }
  button { font: inherit; font-size: 14px; font-weight: 600; color: var(--ink); background: transparent; border: 1px solid var(--line); border-radius: 9px; padding: 8px 14px; }
  button:disabled { opacity: 0.5; }
  .muted { color: var(--muted); }
</style>
</head>
<body>
<main>
  <h1>Trust your local dev CA</h1>
  <p class="lede">${copy.lede}</p>

  <div class="card">
    <h2>Certificate</h2>
    <dl>
      <dt>Name</dt><dd>${escape(info.commonName ?? 'local development CA')}</dd>
      <dt>Source</dt><dd>${escape(ca.label)}</dd>
      ${info.expires ? `<dt>Expires</dt><dd>${escape(info.expires)}</dd>` : ''}
      ${info.fingerprint ? `<dt>SHA-256</dt><dd class="mono">${escape(info.fingerprint)}</dd>` : ''}
    </dl>
  </div>

  <a class="cta" href="${escape(certUrl)}">${copy.download}</a>

  <button type="button" class="cta cta-secondary" data-open-settings>${copy.openSettings}</button>
  <p class="open-status" data-open-status hidden></p>

  <div class="card">
    <h2>${copy.heading}</h2>
    <ol class="steps">
      ${copy.steps.map((step) => `<li>${step}</li>`).join('\n      ')}
    </ol>
    <p class="note">${copy.note}</p>
  </div>

  <div class="card">
    <h2>Your secured sites</h2>
    ${siteList}
  </div>
</main>

<script>
  // The page can't open Settings itself: iOS won't follow an App-prefs: link from
  // web content, so instead we ask simcert to do it from the machine serving this
  // page, over adb or simctl. The custom header is what keeps the route from
  // being reachable by any other origin.
  (function () {
    var button = document.querySelector('[data-open-settings]');
    var status = document.querySelector('[data-open-status]');
    if (!button) return;

    function say(message, state) {
      status.textContent = message;
      status.hidden = false;
      if (state) status.dataset.state = state; else status.removeAttribute('data-state');
    }

    button.addEventListener('click', async function () {
      button.disabled = true;
      say('opening…');
      try {
        var response = await fetch('/open-settings', { method: 'POST', headers: { 'x-simcert': '1' } });
        var body = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(body.error || 'simcert could not open it');
        say(${js(`Opened on this device — ${copy.openSettingsHint}.`)});
      } catch (error) {
        say(error.message, 'bad');
      } finally {
        button.disabled = false;
      }
    });
  })();

  // An https request that survives means the TLS chain validated, so the root is
  // trusted. no-cors keeps a cross-origin response from being an error by itself.
  document.querySelectorAll('[data-check]').forEach(function (button) {
    button.addEventListener('click', async function () {
      var row = button.closest('.site');
      var status = row.querySelector('[data-status]');
      button.disabled = true;
      status.removeAttribute('data-state');
      status.textContent = 'checking…';
      try {
        await fetch(row.dataset.url, { mode: 'no-cors', cache: 'no-store' });
        status.dataset.state = 'ok';
        status.textContent = 'trusted';
      } catch (error) {
        status.dataset.state = 'bad';
        status.textContent = 'not trusted, or site is down';
      } finally {
        button.disabled = false;
      }
    });
  });
</script>
</body>
</html>`;
}
