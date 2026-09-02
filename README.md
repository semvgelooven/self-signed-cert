# simcert

**Trust your local development HTTPS certificate in the iOS Simulator, in one command.**

You run [Herd](https://herd.laravel.com), [Valet](https://laravel.com/docs/valet),
[lerd](https://github.com/lerd-env/lerd) or plain [mkcert](https://github.com/FiloSottile/mkcert),
your sites work over HTTPS on your Mac. Then Safari in the Simulator refuses to
open them, because it has never heard of your root CA.

`simcert` fixes that.

```sh
npx github:semvgelooven/simcert
```

It finds your root CA, serves it to the Simulator, and walks you through trusting
it. No dependencies, nothing to configure for the common case.

## Why this is needed

Dragging a `.pem` file onto the Simulator used to install it. Recent iOS and macOS
versions dropped that. The certificate now has to arrive over HTTP so Safari
recognises it as a configuration profile, which means standing up a web server
just to hand over one file. That's the entire job this tool does for you.

## Requirements

- macOS with Xcode and at least one iOS Simulator runtime
- Node.js 18 or newer
- A local dev tool that already serves HTTPS (Herd, Valet, lerd, or mkcert)

## Install

Run it straight from GitHub:

```sh
npx github:semvgelooven/simcert
```

Or clone it, if you'd rather keep it around:

```sh
git clone https://github.com/semvgelooven/simcert.git
cd simcert
npm start
```

There are no dependencies to install.

## Usage

### The guided route

```sh
npm start          # or: npx github:semvgelooven/simcert
```

This detects your setup, serves the certificate at `http://127.0.0.1:8080`, boots
the Simulator if it isn't running, and opens the install page in Safari there.

Then, in the Simulator:

1. Tap **Download certificate profile**
2. **Settings › General › VPN & Device Management** → install the profile
3. **Settings › General › About › Certificate Trust Settings** → switch it on

**Step 3 is the one everybody misses.** Installing the profile is not enough. iOS
will not trust the CA for HTTPS until you flip that switch.

The page lists the sites you've secured, each with a **Check** button, so you can
confirm it worked before closing anything.

### The fast route

If you don't need the certificate to appear in Settings:

```sh
npm run trust      # or: npx github:semvgelooven/simcert --trust
```

This writes the CA straight into the Simulator's trust store with
`simctl keychain add-root-cert`. Same outcome, no tapping.

It applies to one simulator at a time, and it doesn't survive erasing a device, so
re-run it when you add or reset a simulator. The guided route installs a real
profile, which is closer to how a physical device behaves, so use that one if
you're testing certificate handling itself.

### Check what it found

```sh
npm run info       # or: npx github:semvgelooven/simcert --info
```

```
Config file      (none)
Detected         Herd
Using            Herd
Certificate      ~/Library/Application Support/Herd/config/valet/CA/LaravelValetCASelfSigned.pem
Certificate dirs ~/Library/Application Support/Herd/config/valet/Certificates
Sites            my-app.test, my-other-app.test
Serve on         http://127.0.0.1:8080/
Device           (booted, else newest iPhone)
```

Start here whenever something looks wrong.

## What it detects

| Provider | Root CA | Secured sites |
| --- | --- | --- |
| `herd` | `~/Library/Application Support/Herd/config/valet/CA/` | `…/config/valet/Certificates` |
| `valet` | `~/.config/valet/CA/` | `~/.config/valet/Certificates` |
| `lerd` | mkcert's `rootCA.pem` | `~/.local/share/lerd/certs/sites` |
| `mkcert` | mkcert's `rootCA.pem` | none (list domains yourself) |

All of these write one `<domain>.crt` per secured site into a single directory, so
that directory *is* the site list. No tool-specific config file is ever parsed.

If several are installed, the first match wins. Override it with `--provider valet`.

## Configuration

Nothing needs configuring to get started. When it does, every option can come from
a flag, an environment variable, or a config file. Flags beat the environment,
which beats the file.

```sh
simcert --provider valet --port 9000
SIMCERT_PROVIDER=valet SIMCERT_PORT=9000 simcert
```

A config file is read from `./simcert.config.json`, then
`~/.config/simcert/config.json`, or wherever `--config` points. Copy
`simcert.config.example.json` to get started:

```json
{
  "provider": "valet",
  "domains": ["staging-mirror.test"],
  "port": 8080,
  "device": "iPhone 16 Pro"
}
```

| Flag | Config key | Environment | Meaning |
| --- | --- | --- | --- |
| `--provider <id>` | `provider` | `SIMCERT_PROVIDER` | `herd`, `valet`, `lerd` or `mkcert` |
| `--ca <path>` | `ca` | `SIMCERT_CA` | Root certificate to serve |
| `--certs <dir>` | `certificateDirs` | `SIMCERT_CERT_DIRS` | Where `<domain>.crt` files live (repeat the flag; `:`-separated in the environment) |
| `--domains <list>` | `domains` | `SIMCERT_DOMAINS` | Extra domains to show on the page |
| `--device <name>` | `device` | `SIMCERT_DEVICE` | Simulator name or UDID |
| `--port <number>` | `port` | `SIMCERT_PORT` | Default `8080`; walks forward if taken |
| `--host <addr>` | `host` | `SIMCERT_HOST` | Default `127.0.0.1` |
| `--config <path>` | n/a | n/a | Config file to read |
| `--no-open` | n/a | n/a | Serve the page only, leave the Simulator alone |

Relative paths inside a config file resolve against that file's own directory, and
`~/` expands.

Using something this doesn't know about? Point it at the pieces directly, no
provider needed:

```sh
simcert --ca ~/certs/rootCA.pem --domains app.test,api.test
```

## Troubleshooting

**The site still won't load after installing the profile.**
You almost certainly skipped **Settings › General › About › Certificate Trust
Settings**. The profile being installed is not the same as the CA being trusted.

**The domain doesn't resolve in the Simulator.**
The Simulator resolves through the host, so a `.test` domain that works in your
Mac's browser should work there too. `simcert` warns you when it doesn't. That's a
DNS problem on the host (`valet restart`, `lerd dns:check`), not a certificate one.

**`Could not run "xcrun simctl"`.**
Install Xcode from the App Store, open it once so it finishes setup, then add a
runtime under Xcode › Settings › Components.

**No sites are listed.**
Only sites with a certificate show up. Secure one first (`valet secure`,
`lerd secure`, or the HTTPS toggle in Herd), or add domains yourself with
`--domains`.

**Starting over.**
`xcrun simctl keychain booted reset` clears the simulator's keychain, including
anything `--trust` added. Profiles installed the guided way are removed under
Settings › General › VPN & Device Management.

## How it works

1. Locates your root CA, using the install directory of each known tool to decide
   which one you're actually running.
2. Serves that certificate on loopback as `application/x-x509-ca-cert`, the MIME
   type that makes iOS Safari offer it as a configuration profile rather than
   printing it as text.
3. Boots a simulator if needed and opens the page there with `simctl openurl`.

Only the public certificate is ever read; the matching private key is never opened
or served. The server binds `127.0.0.1` and exits with Ctrl-C. Setting `--host` to
a public interface would expose the page to your network, and there's no reason to.

## License

MIT
