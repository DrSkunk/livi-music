# LIVI Music

Wireless music transfer for [LIVI](https://github.com/DrSkunk/LIVI): a static
web page that sends music files from a phone or computer straight into the LIVI
library over WebRTC.

```
 browser (GitHub Pages)                              LIVI head unit
        │  PeerJS offer ──────────────► PeerJS ◄───── WSS/heartbeat │
        │  PeerJS answer ◄───────────── Cloud  ────── WSS           │
        │                                                            │
        └────────── WebRTC data channel (music files) ───────────────┘
                      direct or through TURN
```

- The browser and LIVI use the free, shared PeerJS Cloud service at
  `0.peerjs.com` to exchange WebRTC connection details. No signaling service
  needs to be deployed. The service does not carry music.
- PeerJS supplies public STUN and TURN defaults. Music travels directly when
  possible and through TURN when necessary. These shared services are best
  effort, with no uptime guarantee.
- LIVI generates a random PeerJS ID for each pairing and puts it in the page
  link's URL fragment. The fragment is not sent to GitHub Pages. Pairing still
  requires the six-digit code, matching fingerprint verification codes, and an
  explicit **Allow** tap on LIVI.
- PeerJS Cloud is public infrastructure. A random ID makes unsolicited
  connections hard to guess, but do not approve a mismatched verification code.

## Layout

`web/` contains the static client, bundled metadata reader and Inter.

## Website (GitHub Pages)

`.github/workflows/pages.yml` tests and builds `web/` and deploys it to GitHub
Pages on every push to `main`. No signaling URL or server credentials are
required. Optionally set this repository **variable** (Settings → Secrets and
variables → Actions → Variables) to override PeerJS's default ICE servers:

| Variable                 | Example                                              |
| ------------------------ | ---------------------------------------------------- |
| `LIVI_MUSIC_ICE_SERVERS` | `[{"urls":["stun:stun.l.google.com:19302"]}]`        |

Without that variable, the page uses PeerJS's bundled STUN/TURN defaults. The
generated `config.js` is public: never put private or long-lived TURN
credentials in it.

Local development:

```sh
cd web
npm ci
npm test
npm run build          # writes dist/
npx serve dist         # any static server works
```

## Configuring LIVI

On LIVI OS, optionally write `/data/livi/config/LIVI/music-sync.json` (mode
`0600`, owner `livi` if it contains TURN credentials):

```json
{
  "webUrl": "https://drskunk.github.io/livi-music/",
  "iceServers": []
}
```

`webUrl` defaults to the GitHub Pages site above. PeerJS's public ICE defaults
are used when `iceServers` is omitted or empty; optional custom ICE entries use
`{"urls":["turn:relay.example.net:3478"],"username":"...","credential":"..."}`.
Both devices must be able to reach PeerJS Cloud. `LIVI_MUSIC_WEB_URL` and JSON
`LIVI_MUSIC_ICE_SERVERS` can override the file values.

Open **Media → Local Music → Wireless sync** on LIVI and open the full link it
shows on the phone or computer. Enter the six-digit code, compare the
verification codes and tap **Allow** only if they match. The pairing window
lasts five minutes and permits one browser.

## License

GPL-3.0-or-later. The website bundles Inter (SIL OFL 1.1) and third-party
notices are generated into `dist/THIRD-PARTY-NOTICES.txt`.
