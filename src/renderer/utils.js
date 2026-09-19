import { toast, confirmUI as confirmDlg, uid } from './ui/dom.js'
import { appendSys } from './ui/render.js'
import { requireSuccess } from './requests.js'

const log = {}
const modes = ['debug', 'info', 'warn', 'error']
modes.forEach(x => log[x] = (text) => {
    window.api.api.Log(x, text)
    console.log(x + ":", text)
})

export function idFromUsername(username, arr, refs) {
    arr = Object.assign({}, arr, refs)
    let user = Object.keys(arr).find(key => arr[key].user?.username?.toLowerCase() === String(username).toLowerCase())
    if (user != undefined) {
        return user;
    } else {
        return null;
    }
}

// ── beatmap cache ─────────────────────────────────────────────────────
window.beatmaps = window.beatmaps || {}
const inflight = new Map()
let onBeatmapLoaded = () => {}
export function setBeatmapListener(fn) { onBeatmapLoaded = fn }

export async function GetBeatmap(beatmap_id) {
    if (window.beatmaps[beatmap_id]) return window.beatmaps[beatmap_id]
    if (inflight.has(beatmap_id)) return inflight.get(beatmap_id)
    const p = window.api.api.GetBeatmap(beatmap_id).then(map => {
        const data = requireSuccess(map, `Load beatmap ${beatmap_id}`)
        window.beatmaps[beatmap_id] = data ?? { error: 'empty' }
        inflight.delete(beatmap_id)
        onBeatmapLoaded(beatmap_id)
        return window.beatmaps[beatmap_id]
    }).catch(err => {
        inflight.delete(beatmap_id)
        window.beatmaps[beatmap_id] = { error: err?.message ?? 'failed' }
        onBeatmapLoaded(beatmap_id)
        return window.beatmaps[beatmap_id]
    })
    inflight.set(beatmap_id, p)
    return p
}
// Synchronous accessor for render code: returns the cached beatmap or null and kicks off a fetch.
export function beatmapCached(beatmap_id) {
    if (!beatmap_id) return null
    const c = window.beatmaps[beatmap_id]
    if (c) return c
    GetBeatmap(beatmap_id)
    return null
}

// ── event log ─────────────────────────────────────────────────────────
export const events = []
let onEvents = () => {}
export function setEventsListener(fn) { onEvents = fn }

export async function logEvent(name, data) {
    let isRes = false;
    const keep_room_id = ["RefereeInvited"]
    if (data instanceof Promise) { // if it's a method we sent
        data = await data
        isRes = true;
    }
    console.log(name, data)
    let title = name
    if (isRes) {
        title += data.success ? " · ok" : " · failed"
        data = data.success ? data.data : data.error
    } else if (data && typeof data === 'object') {
        data = { ...data }
        if (!keep_room_id.includes(name)) delete data.room_id
    }
    let text
    if (data == null) text = ''
    else if (typeof data == 'string') text = data
    else text = Object.entries(data).map(([k, v]) => k + ": " + (typeof v == 'string' ? v : JSON.stringify(v))).join('\n')
    events.unshift({ id: uid(), name: title, ts: Date.now(), text })
    if (events.length > 200) events.length = 200
    onEvents()
    log.info(name + ":" + JSON.stringify(data));
}
export function clearEvents() { events.length = 0; onEvents() }

// ── chat / ui shims used across modules ───────────────────────────────
export function addSystemMsg(msg, tone, action) { appendSys(msg, tone, action) }
export function showToast(message, duration = 3000) { toast(message, duration) }
export function confirmUI(title, body, opts) { return confirmDlg(title, body, opts) }

// ── osu proxy: every referee-hub call is logged to the events panel ───
let objs = Object.entries(window.api.send)
let osu = {}
for (const cmd of objs) {
    osu[cmd[0]] = (...args) => {
        const res = Promise.resolve().then(() => cmd[1](...args)).catch(error => ({ success: false, error: error?.message ?? String(error) }))
        logEvent(cmd[0], res)
        return res
    }
}
let MODS;
const modsReady = fetch('mods.json')
    .then(response => {
        if (!response.ok && response.status !== 0) {
            throw new Error(`Could not load mods.json: HTTP ${response.status}`)
        }
        return response.json()
    })
    .then(modes => {
        if (!Array.isArray(modes)) throw new Error('mods.json has an invalid format')
        MODS = modes
        return modes
    })
    .catch(error => {
        console.error('Could not load mod metadata:', error)
        log.error('Could not load mod metadata: ' + error.message)
        return null
    })

export { osu, MODS, modsReady, log }
