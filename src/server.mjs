import { createServer } from 'node:http';
import { basename } from 'node:path';

const CERT_ROUTE = '/ca.pem';

export function startServer({ ca, info, sites, host, port, renderPage }) {
  const pem = ca.contents;
  const filename = basename(ca.path);

  const server = createServer((req, res) => {
    const path = new URL(req.url, `http://${req.headers.host ?? host}`).pathname;

    if (path === CERT_ROUTE || path === `/${filename}`) {
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
      const html = renderPage({ ca, info, sites, certUrl: CERT_ROUTE });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }

    res.writeHead(302, { Location: '/' });
    res.end();
  });

  return listenFrom(server, host, port);
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
