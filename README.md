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
- `index.js` wiring, dialogs, timers
- `commands.js` the shared command registry used by execution, the command list, help and autocomplete
- `referees.js` referee target lookup, permission/error guidance and room-list response parsing
- `models.js` room state + event queue (no DOM)
- `ui/render.js` all DOM output, `ui/dom.js` helpers (keyed lists, dialogs, toasts)
- `macros.js` one-click scripts, `cmdpalette.js` command list + autocomplete, `tracking.js` match score, `local.js` PC-only settings
- The standalone design draft stays local and is excluded from Git and desktop packages.

### Regression checks and session recovery

Run `npm test` for the HTTP error, OAuth refresh, command parsing, macro execution and room-state regression tests. These tests use fake credentials and do not contact osu!.

Access tokens are refreshed when expired or close to expiry; HTTP requests and reconnecting referee/chat connections use the updated token. Refresh follows the [osu! OAuth documentation](https://osu.ppy.sh/docs/). If renewal fails, the client reports the failure and asks you to restart and sign in again. Failed messages remain in the input, and a failed macro step stops the remaining script.

The map editor accepts an individual beatmap ID or URL. Editing a queued map uses its latest data and retains unchanged advanced mod settings.

`node scripts/verifyPackage.js win32 x64 out/repaired` verifies a build made in the separate `out/repaired` directory; omit the last argument for the default `out` directory.

### Referee controls

Freestyle has a direct On/Off button next to the match controls and can also be changed with `!mp freestyle on|off`. It lets players choose their difficulty and is separate from Freemod. The map editor checkbox still configures individual queued maps.

The Queue button and Close button use the same open/closed state at every window size. Closing the queue on desktop gives the space back to the centre column. On smaller windows it becomes a drawer, dismissible with its Close button, the backdrop, or Escape.

The command list is generated from the executor's registry. Use `!mp help` for supported commands, `!mp stop` to cancel the server start countdown, and `!mp aborttimer` to cancel only the local chat timer. This client does not implement every Bancho command; the referee protocol has no general host-transfer or score-mode operation.

Only the room host can add/remove referees, and cannot act on themselves. The recipient should open and sign in to APL Ref before being added, then join the room via its invitation banner or room ID. Merely opening osu! is not enough to establish a referee-client connection. `!mp listrooms` and the invitation banner use the server's `ListRooms` response to recover available rooms.

The upstream [AddReferee implementation](https://github.com/ppy/osu-server-spectator/blob/bb42c5f5c0ff3de3803e5a366145a102c7b286a8/osu.Server.Spectator/Hubs/Referee/RefereeHub.cs#L294) accesses the recipient's tracked referee state without creating a missing tracking entry. [EntityStore.GetForUse](https://github.com/ppy/osu-server-spectator/blob/bb42c5f5c0ff3de3803e5a366145a102c7b286a8/osu.Server.Spectator/Entities/EntityStore.cs#L63) throws for an untracked recipient, which can surface as a generic server error. The client provides guidance for this error; it cannot patch the hosted server or bypass its host requirement.
