![Demo usage](./assets/APLREFDemo.png)

# apl's lazer ref client


## Download
[Releases](https://github.com/Fengli-ruomeng/apl-ref-Kfix/releases/latest)

## Setup
See [SETUP.md](SETUP.md)

## Running

```
npm i
npm start
```

## Compile
```
npm run gensources # importantly downloads mods.json
npm run make -- --platform=win32
```
You can change or omit `-- --platform=win32` depending on what platform you build for. By default, it will build as a bundled zip.

For editing, run this to keep the tailwind css up to date (`npm start` also rebuilds it once):
```
npx @tailwindcss/cli -i ./src/renderer/css/tailwind-input.css -o ./src/renderer/css/tailwind.css  --watch
```

## Development

### Mock mode (no osu! login)
Runs the renderer against `preload.mock.js`, an in-memory stand-in for the referee hub. Nothing touches osu!.
```
# PowerShell
$env:APL_MOCK=1; npm start
# bash
APL_MOCK=1 npm start
```
Use **Simulate** in the top bar to fire fake events (joins, ready states, chat). `APL_MOCK_JOIN=1` auto-joins a populated room.
`APL_SHOT=out.png` captures the window after `APL_SHOT_DELAY` ms (`APL_SHOT_SCRIPT` runs JS in the renderer first, `APL_SHOT_QUIT=1` exits afterwards).

### Renderer layout
- `index.js` wiring, the `!mp` runner, dialogs, timers
- `models.js` room state + event queue (no DOM)
- `ui/render.js` all DOM output, `ui/dom.js` helpers (keyed lists, dialogs, toasts)
- `macros.js` one-click scripts, `cmdpalette.js` command list + autocomplete, `tracking.js` match score, `local.js` PC-only settings
- The standalone design draft stays local and is excluded from Git and desktop packages.

### Regression checks and session recovery

Run `npm test` for the HTTP error, OAuth refresh, command parsing, macro execution and room-state regression tests. These tests use fake credentials and do not contact osu!.

Access tokens are refreshed when expired or close to expiry; HTTP requests and reconnecting referee/chat connections use the updated token. Refresh follows the [osu! OAuth documentation](https://osu.ppy.sh/docs/). If renewal fails, the client reports the failure and asks you to restart and sign in again. Failed messages remain in the input, and a failed macro step stops the remaining script.

The map editor accepts an individual beatmap ID or URL. Editing a queued map uses its latest data and retains unchanged advanced mod settings.

`node scripts/verifyPackage.js win32 x64 out/repaired` verifies a build made in the separate `out/repaired` directory; omit the last argument for the default `out` directory.
