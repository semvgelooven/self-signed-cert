# simcert

**Trust your local development HTTPS certificate in the iOS Simulator and the
Android emulator, in one command.**

You run [Herd](https://herd.laravel.com), [Valet](https://laravel.com/docs/valet),
[lerd](https://github.com/lerd-env/lerd) or plain [mkcert](https://github.com/FiloSottile/mkcert),
your sites work over HTTPS on your Mac. Then Safari in the Simulator refuses to
open them, because it has never heard of your root CA.

The Android emulator is worse: it can't even resolve `.test`, because it has its
own hosts file and its own idea of where "your machine" is.

`simcert` fixes both.

```sh
npx github:semvgelooven/self-signed-cert
```

It finds your root CA, serves it to the Simulator, and walks you through trusting
it. No dependencies, nothing to configure for the common case.

## Why this is needed

Dragging a `.pem` file onto the Simulator used to install it. Recent iOS and macOS
versions dropped that. The certificate now has to arrive over HTTP so Safari
recognises it as a configuration profile, which means standing up a web server
just to hand over one file. That's the entire job this tool does for you.

## Requirements

- Node.js 18 or newer
- A local dev tool that already serves HTTPS (Herd, Valet, lerd, or mkcert)
- For iOS: macOS with Xcode and at least one Simulator runtime
- For Android: `adb` on your `PATH` (or `ANDROID_HOME` set) and a running emulator

## Install

Run it straight from GitHub:

```sh
npx github:semvgelooven/self-signed-cert
```

Or clone it, if you'd rather keep it around:

```sh
git clone https://github.com/semvgelooven/self-signed-cert.git
cd self-signed-cert
npm start
```

There are no dependencies to install.

## Usage

### Picking a target

```sh
npm start          # or: npx github:semvgelooven/self-signed-cert
```

`simcert` only asks a question when there is more than one answer. It looks at
what is actually *running*, not what is installed:

| What's running | What happens |
| --- | --- |
| Just a Simulator | Uses it |
| Just an emulator | Uses it |
| Both | Asks which — or press Enter for both |
| Neither | Tells you to boot something |

One server feeds both devices at once, handing each the page and the file format
its platform wants, so "both" is a single run rather than two.

Skip the question with `--ios`, `--android` or `--both`. In a script, both
running means both get it, without prompting.

### The guided route

This detects your setup, serves the certificate at `http://127.0.0.1:8080`, boots
the device if it isn't running, and opens the install page in its browser.

Then, in the Simulator:

1. Tap **Download certificate profile**
2. **Settings › General › VPN & Device Management** → install the profile
3. **Settings › General › About › Certificate Trust Settings** → switch it on

**Step 3 is the one everybody misses.** Installing the profile is not enough. iOS
will not trust the CA for HTTPS until you flip that switch.

The page lists the sites you've secured, each with a **Check** button, so you can
confirm it worked before closing anything.

### Jumping to the install screen

While the server is running, press **s** to open the certificate screen on every
device it opened the page on. There is also `simcert --settings` on its own, for
when the file is already downloaded and you just want the screen back.

How far this gets you differs by platform, because the platforms differ:

- **Android** lands you *on* the certificate picker, with the file you just
  downloaded at the top of Recents. It replaces five taps of hunting through
  Settings.
- **iOS** can only open Settings at the root. iOS ignores the `path=` part of
  `App-prefs:` URLs, so there is no way to deep-link the profile screen — but the
  downloaded profile is waiting at the top of that root screen anyway, so it is
  one tap rather than none. The **Certificate Trust Settings** toggle can't be
  reached this way at all; `--trust` skips both screens instead.

### The fast route

If you don't need the certificate to appear in Settings:

```sh
npm run trust      # or: npx github:semvgelooven/self-signed-cert --trust
```

This writes the CA straight into the Simulator's trust store with
`simctl keychain add-root-cert`. Same outcome, no tapping, and no Settings
navigation at all — including the trust toggle no deep link can reach.

It applies to one simulator at a time, and it doesn't survive erasing a device, so
re-run it when you add or reset a simulator. The guided route installs a real
profile, which is closer to how a physical device behaves, so use that one if
you're testing certificate handling itself.

### Android

```sh
npm run android            # or: simcert --android
```

Same idea as the iOS guided route: it serves the certificate, opens the install
page in the emulator's browser, and walks you through it. It also does the thing
iOS never needs — points your secured domains at your machine in the emulator's
hosts file, because otherwise there is nothing for the certificate to be trusted
*for*.

Then, in the emulator:

1. Tap **Download certificate**
2. Press **s** in the terminal to open the certificate picker
3. Pick the downloaded file and give it any name

Without step 2 that is **Settings › Security & privacy › More security & privacy
› Encryption & credentials › Install a certificate › CA certificate**, which is
why the shortcut exists.

That lands in the **user** store. The browser trusts it; apps do not, because
since Android 7 an app only trusts user certificates if its network security
config says so. For your own app you want the system store instead:

```sh
npm run android:trust      # or: simcert --android --trust
```

This writes the CA into the device's own trust store over adb, so every app on
the device trusts it with no app changes. It needs a rootable emulator — see
below.

#### What `--android --trust` needs

A **Google APIs** system image, not a **Google Play** one. Play images are
production builds and refuse `adb root`, which means neither the trust store nor
the hosts file can be written. `simcert` tells you this if it hits it.

```sh
sdkmanager "system-images;android-36;google_apis;arm64-v8a"
avdmanager create avd -n Pixel_dev -k "system-images;android-36;google_apis;arm64-v8a"
emulator -avd Pixel_dev -writable-system
```

The `-writable-system` flag matters: without it `/system` stays read-only.

#### The reboot caveat

On Android 14 and newer, apps read their CAs from the Conscrypt APEX
(`/apex/com.android.conscrypt/cacerts`), which is mounted read-only. `simcert`
shadows it with a bind mount containing your CA. That mount does not survive a
reboot, so re-run `simcert --android --trust` after restarting the emulator. The
hosts file and the `/system` copy of the certificate both persist.

### Check what it found

```sh
npm run info       # or: npx github:semvgelooven/self-signed-cert --info
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

For Android, `device` is the emulator serial or AVD name instead:

```json
{
  "provider": "lerd",
  "targets": "both",
  "port": 9000
}
```

| Flag | Config key | Environment | Meaning |
| --- | --- | --- | --- |
| `--provider <id>` | `provider` | `SIMCERT_PROVIDER` | `herd`, `valet`, `lerd` or `mkcert` |
| `--ca <path>` | `ca` | `SIMCERT_CA` | Root certificate to serve |
| `--certs <dir>` | `certificateDirs` | `SIMCERT_CERT_DIRS` | Where `<domain>.crt` files live (repeat the flag; `:`-separated in the environment) |
| `--domains <list>` | `domains` | `SIMCERT_DOMAINS` | Extra domains to show on the page |
| `--ios` / `--android` / `--both` | `targets` | `SIMCERT_TARGET` | Where the certificate goes. Omit to use whatever is running, and be asked if both are. `SIMCERT_TARGET` takes `ios`, `android` or `both` |
| `--device <name>` | `device` | `SIMCERT_DEVICE` | Simulator name/UDID, or emulator serial/AVD name. Needs a single target |
| `--port <number>` | `port` | `SIMCERT_PORT` | Default `8080`; walks forward if taken |
| `--host <addr>` | `host` | `SIMCERT_HOST` | Default `127.0.0.1` |
| `--config <path>` | n/a | n/a | Config file to read |
| `--no-open` | n/a | n/a | Serve the page only, leave the device alone |
| `--settings` | n/a | n/a | Open the certificate install screen and exit |
| `--host-ip <addr>` | `hostIp` | `SIMCERT_HOST_IP` | Address the emulator reaches your machine on (default `10.0.2.2`) |
| `--no-hosts` | `hosts: false` | `SIMCERT_HOSTS=0` | Don't touch the emulator's hosts file |

`SIMCERT_ANDROID=1` still works as an older spelling of `SIMCERT_TARGET=android`,
as does `"android": true` in a config file.

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
No URL scheme can open that screen for you, which is the best argument for
`--trust`.

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

**Android: `adb root` is refused.**
You're on a Google Play system image. They are production builds and never allow
it. Create an AVD from a Google APIs image instead — see
[What `--android --trust` needs](#what---android---trust-needs).

**Android: the certificate installed but my app still won't connect.**
The guided route installs a *user* certificate, and apps ignore those unless
their network security config opts in. Either add
`<certificates src="user"/>` to the app's `network_security_config.xml`, or use
`simcert --android --trust` to write it into the system store.

**Android: Chrome still shows a certificate warning.**
Chrome ships its own root store and increasingly ignores system-added CAs on
Android, so it is a bad test. Check with the app you actually care about, or
install the CA the guided way, which Chrome does honour.

**Android: it worked, then stopped after restarting the emulator.**
Expected on Android 14+. The APEX trust store shadow is a bind mount and is lost
on reboot. Re-run `simcert --android --trust`.

**Android: `http://127.0.0.1:8080` won't open in the emulator.**
It never will. Inside the emulator `127.0.0.1` is the emulator, not your Mac.
Use `http://10.0.2.2:8080` — the address `simcert` prints first and opens for
you. Change it with `--host-ip` if your setup differs.

**Android: no emulator found.**
`simcert` only talks to a running one. Start it first, with
`emulator -avd <name> -writable-system`.

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

On Android the same certificate is served as `/ca.crt`, because the certificate
installer there keys off the file extension rather than the MIME type, and the
page is opened with an `am start` intent at `10.0.2.2` — the emulator's alias for
your machine's loopback.

`--android --trust` does three things the browser route can't:

1. Names the certificate `<subject_hash_old>.0`, which is the only name Android
   will look it up under.
2. Copies it into `/system/etc/security/cacerts` (persistent) *and* bind-mounts a
   writable copy of the Conscrypt APEX store over the read-only one, which is
   what Android 14+ actually reads.
3. Makes that mount inside the **zygote's** mount namespace as well as init's.
   Apps are forked from zygote and inherit its mounts, so a mount made only in
   the shell's namespace is invisible to every app — it looks exactly like the
   certificate was installed and then ignored.

Only the public certificate is ever read; the matching private key is never opened
or served. The server binds `127.0.0.1` and exits with Ctrl-C. Setting `--host` to
a public interface would expose the page to your network, and there's no reason to.

## License

MIT
