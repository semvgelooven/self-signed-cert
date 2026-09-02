const escape = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

export function installPage({ ca, info, sites, certUrl }) {
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
  <p class="lede">Install this root certificate so Safari here stops warning about your local development sites.</p>

  <div class="card">
    <h2>Certificate</h2>
    <dl>
      <dt>Name</dt><dd>${escape(info.commonName ?? 'local development CA')}</dd>
      <dt>Source</dt><dd>${escape(ca.label)}</dd>
      ${info.expires ? `<dt>Expires</dt><dd>${escape(info.expires)}</dd>` : ''}
      ${info.fingerprint ? `<dt>SHA-256</dt><dd class="mono">${escape(info.fingerprint)}</dd>` : ''}
    </dl>
  </div>

  <a class="cta" href="${escape(certUrl)}">Download certificate profile</a>

  <div class="card">
    <h2>Then, in Settings</h2>
    <ol class="steps">
      <li>Open <span class="path">Settings &rsaquo; General &rsaquo; VPN &amp; Device Management</span> and install the downloaded profile.</li>
      <li>Open <span class="path">Settings &rsaquo; General &rsaquo; About &rsaquo; Certificate Trust Settings</span> and switch it on for this certificate.</li>
      <li>Come back and check a site below.</li>
    </ol>
    <p class="note">Step 2 is the one people miss. Installing the profile alone does not make iOS trust it for HTTPS.</p>
  </div>

  <div class="card">
    <h2>Your secured sites</h2>
    ${siteList}
  </div>
</main>

<script>
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
