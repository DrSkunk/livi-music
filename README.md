# LIVI Music

Wireless music transfer for [LIVI](https://github.com/DrSkunk/LIVI): a static
web page that sends music files from a phone or computer straight into the LIVI
library over WebRTC, and the small signaling relay that introduces the two
peers.

```
 browser (GitHub Pages)                         LIVI head unit
        │  1. join room "123456" ──► signal ◄── join room "123456"  │
        │  2. SDP offer ───────────► relay  ──► SDP offer           │
        │  3. SDP answer ◄────────── (WSS)  ◄── SDP answer          │
        │                                                           │
        └──────── 4. WebRTC data channel (music files) ─────────────┘
                     direct, or via STUN-discovered / TURN-relayed path
```

- **STUN** only tells each peer its public address; **TURN** relays the data if
  no direct path works. Neither can exchange the initial offer/answer, so a
  signaling relay is always required. Static hosting (GitHub Pages) cannot run
  it.
- The relay only forwards connection descriptions (a few KiB). Music never
  passes through it.
- Pairing uses a six-digit room code shown on LIVI, a verification code derived
  from both DTLS fingerprints, and an explicit **Allow** tap on LIVI.

## Layout

| Path      | Contents                                                     |
| --------- | ------------------------------------------------------------ |
| `web/`    | Static client (vanilla JS, bundled metadata reader and Inter) |
| `signal/` | `livi-music-signal`, the Rust WebSocket signaling relay      |

## Website (GitHub Pages)

`.github/workflows/pages.yml` tests and builds `web/` and deploys it to GitHub
Pages on every push to `main`. Configure it with repository **variables**
(Settings → Secrets and variables → Actions → Variables):

| Variable                   | Example                                              |
| -------------------------- | ---------------------------------------------------- |
| `LIVI_MUSIC_SIGNALING_URL` | `wss://signal.example.net/signal` (must be `wss://`) |
| `LIVI_MUSIC_ICE_SERVERS`   | `[{"urls":["stun:stun.l.google.com:19302"]}]`        |

Without `LIVI_MUSIC_ICE_SERVERS` the page uses Google's public STUN server.
The generated `config.js` is public: never put long-lived TURN credentials in
it. Users can still type another signaling URL in the page.

Local development:

```sh
cd web
npm ci
npm test
npm run build          # writes dist/
npx serve dist         # any static server works
```

## Signaling relay

`.github/workflows/signal.yml` runs `cargo fmt`, `clippy` and tests, then
publishes a multi-arch image to `ghcr.io/drskunk/livi-music-signal` on pushes to
`main` and `v*` tags.

```sh
docker run -p 8787:8787 ghcr.io/drskunk/livi-music-signal:latest
```

The relay listens on `LIVI_MUSIC_SIGNAL_LISTEN` when set, otherwise on
`0.0.0.0:$PORT` when `PORT` is set, otherwise on `127.0.0.1:8787`. The image sets
`PORT=8787`, so platforms that assign `PORT` (Fly.io, Render, Cloud Run)
override it automatically. Endpoints:

- `GET /signal` — WebSocket signaling
- `GET /healthz` — health check

Host it anywhere that terminates TLS with a publicly trusted certificate (LIVI
verifies it against the WebPKI roots) and passes WebSocket upgrades. The
per-IP attempt limit sees the proxy's address when proxied, so also rate-limit
at the proxy if needed.

Build from source (Rust 1.88+):

```sh
cd signal
cargo build --release
```

## Configuring LIVI

On LIVI OS, write `/data/livi/config/LIVI/music-sync.json` (mode `0600`, owner
`livi` if it contains TURN credentials):

```json
{
  "signalUrl": "wss://signal.example.net/signal",
  "webUrl": "https://drskunk.github.io/livi-music/",
  "iceServers": [{ "urls": ["stun:stun.l.google.com:19302"] }]
}
```

Then open **Media → Local Music → Wireless sync** on LIVI, open the website,
enter the pairing code, compare the verification codes and tap **Allow**.

## License

GPL-3.0-or-later. The website bundles Inter (SIL OFL 1.1) and third-party
notices are generated into `dist/THIRD-PARTY-NOTICES.txt`.
