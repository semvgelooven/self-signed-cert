import { createServer } from 'node:http';
import { basename } from 'node:path';

// iOS keys the install flow off the MIME type, Android off the file extension —
// so the same bytes are offered under both names.
const CERT_ROUTES = { ios: '/ca.pem', android: '/ca.crt' };

// One server can be feeding a Simulator and an emulator at the same time, so the
// platform is a property of the request, not of the process. The fallback is the
// target we were started for, which is what a curl from the host should see.
const platformFor = (userAgent, fallback) => (/android/i.test(userAgent ?? '') ? 'android' : fallback);

// The button on the page can't open Settings itself — iOS refuses to follow
// App-prefs: links from web content — so it asks us to do it from the host
// instead, over the connection it already has.
const OPEN_ROUTE = '/open-settings';

/**
 * Only our own page can ask for this.
 *
 * The header is the whole check: a cross-origin fetch that sets it triggers a
 * CORS preflight, and since we answer no preflight the browser never sends the
 * request. That stops a page in another tab from poking at localhost, which
 * matters because this route runs a command against a device.
 */
const fromOurPage = (req) => req.method === 'POST' && req.headers['x-simcert'] === '1';

export function startServer({ ca, info, sites, host, port, renderPage, platform = 'ios', onOpenSettings }) {
  const pem = ca.contents;
  const filename = basename(ca.path);

  const server = createServer((req, res) => {
    const path = new URL(req.url, `http://${req.headers.host ?? host}`).pathname;

    if (path === OPEN_ROUTE) {
      openSettings(req, res, platform, onOpenSettings);
      return;
    }

    if (path === CERT_ROUTES.ios || path === CERT_ROUTES.android || path === `/${filename}`) {
      res.writeHead(200, {
        // The MIME type is what makes iOS Safari offer this as a configuration
        // profile instead of dumping the text on screen.
        'Content-Type': 'application/x-x509-ca-cert',
        'Content-Length': pem.length,
        'Cache-Control': 'no-store',
      });
      res.end(pem);
      return;
    }

    if (path === '/') {
      const forPlatform = platformFor(req.headers['user-agent'], platform);
      const html = renderPage({ ca, info, sites, certUrl: CERT_ROUTES[forPlatform], platform: forPlatform });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }

    res.writeHead(302, { Location: '/' });
    res.end();
  });

  return listenFrom(server, host, port);
}

/**
 * Open the install screen on whichever device asked.
 *
 * The requesting device is read back off the User-Agent, so with a Simulator and
 * an emulator both pointed at this one server, each button opens Settings on the
 * device it was tapped on rather than on both.
 */
async function openSettings(req, res, fallback, onOpenSettings) {
  const reply = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  if (!fromOurPage(req)) return reply(405, { error: 'Ask from the install page.' });
  if (!onOpenSettings) return reply(501, { error: 'Nothing to open: simcert was started with --no-open.' });

  try {
    const where = await onOpenSettings(platformFor(req.headers['user-agent'], fallback));
    reply(200, { opened: where });
  } catch (error) {
    reply(500, { error: error.message ?? String(error) });
  }
}

// Walk forward from the requested port so a stale server from a previous run
// doesn't turn into a crash.
function listenFrom(server, host, port, attemptsLeft = 20) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      if (error.code === 'EADDRINUSE' && attemptsLeft > 0) {
        server.removeListener('error', onError);
        resolve(listenFrom(server, host, port + 1, attemptsLeft - 1));
        return;
      }
      reject(error);
    };

    server.once('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      resolve({ server, port, url: `http://${host}:${port}/` });
    });
  });
}
