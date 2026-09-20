import { Event, EventQueue, Room } from "./models.js"
import { osu, logEvent, MODS, modsReady, addSystemMsg, confirmUI, log, events, setEventsListener, setBeatmapListener, beatmapCached, GetBeatmap } from "./utils.js"
import { buildModChange } from "./mods.js"
import { $, $$, icon, mountIcons, toast, copyText, setResult, openDlg, closeDlg, buildSeg, setSeg, wireMenu, closeMenus, ding } from './ui/dom.js'
import { showView, renderTopbar, renderPlayers, renderRefs, renderMatch, renderQueue, renderScores, renderEvents, clearChat, appendChat, mapInfo, poolLabel, RULESETS } from './ui/render.js'
import { loadPrefs, savePrefs } from './local.js'
import { loadMacros, createMacroUI } from './macros.js'
import { createCommandUI } from './cmdpalette.js'
import { buildResult, autoAward } from './tracking.js'
import { requireSuccess } from './requests.js'
import { beatmapInput, commandTokens, integerInput } from './inputs.js'
import { runRefereeCommand } from './commands.js'
import { resolveUserTarget, changeReferee } from './referees.js'
import { createQueuePanel } from './ui/queue.js'
import { createRefereeRooms } from './ui/referee-rooms.js'

window.console.error = (...args) => {
    log.error(args.join(', '))
}
document.title = document.title + ": " + window.version

// ── theme ─────────────────────────────────────────────────────────────
function applyTheme(t) {
    const root = document.documentElement
    root.classList.remove('dark', 'light'); root.classList.add(t); root.dataset.theme = t
    try { localStorage.setItem('theme', t) } catch { /* ignore */ }
    const b = $('#tb-theme')
    b.replaceChildren(icon(t === 'dark' ? 'sun' : 'moon'))
    b.title = t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
}

// ── state ─────────────────────────────────────────────────────────────
let Queue;
let room;
let countdown_id; // interval of the local chat timer
const prefs = loadPrefs()
const macros = loadMacros()
const ui = { historyOpen: false, eventsOpen: false, freestylePending: false }
const ctx = {
    prefs, ui, connected: false,
    me: () => window.me ?? { username: '…', id: 0 },
    getBeatmap: id => beatmapCached(id),
    actions: {},
}

window.api.api.GetSelf().then(x => {
    window.me = requireSuccess(x, 'Load current user')
    $('#ld-me').textContent = window.me?.username ?? '…'
}).catch(error => toast(error.message))

// ── rendering ─────────────────────────────────────────────────────────
let renderQueued = false
function scheduleRender() {
    if (renderQueued) return
    renderQueued = true
    requestAnimationFrame(() => { renderQueued = false; renderAll() })
}
function renderAll() {
    showView(!!room)
    renderTopbar(room, ctx)
    if (!room) return
    renderPlayers(room, ctx)
    renderRefs(room, ctx)
    renderMatch(room, ctx)
    renderQueue(room, ctx)
    renderScores(room, ctx)
    macroUI.renderBar()
    renderEvents(events, ctx)
}
setBeatmapListener(() => { if (room) scheduleRender() })
setEventsListener(() => renderEvents(events, ctx))

const refereeRooms = createRefereeRooms({ getRoom: () => room, osu, install: installRoomSnapshot })

function installRoomSnapshot(snapshot) {
    const nextRoom = new Room(snapshot)
    const nextQueue = new EventQueue(nextRoom)

    Queue?.dispose()
    room?.dispose()
    room = nextRoom
    Queue = nextQueue
    refereeRooms.render()
    stopLocalTimer(false)

    room.onChange = scheduleRender
    room.onClose = () => clearCurrentRoom()
    room.onMatchCompleted = id => addScore(room.id, id)
    room.onAllReady = () => ding('allReady', prefs.sounds.allReady)

    clearChat()
    addSystemMsg(`Joined room #${room.id}.`)
    addSystemMsg(`Team names: ${room.local.teams.red} (red), ${room.local.teams.blue} (blue). Macros and the scoreboard use these names.`, 'note', { label: 'Change in room settings', run: openSettings })
    renderAll()
}

function clearCurrentRoom() {
    Queue?.dispose()
    Queue = null
    room?.dispose()
    room = null
    refereeRooms.render()
    stopLocalTimer(false)
    clearChat()
    renderAll()
}

// ── placeholders for macros ───────────────────────────────────────────
function resolveText(t) {
    if (!room) return String(t ?? '')
    const q = room.queue()
    const name = it => { if (!it) return '—'; const m = mapInfo(beatmapCached(it.beatmap_id), it.beatmap_id); return `${m.title} [${m.version}]` }
    const map = {
        red: () => room.local.teams.red, blue: () => room.local.teams.blue,
        map: () => name(q[0]), next: () => name(q[1]),
        mods: () => q[0] ? poolLabel(q[0]) : '—', room: () => room.name,
    }
    return String(t ?? '').replace(/\{(\w+)\}/g, (m, k) => map[k.toLowerCase()] ? map[k.toLowerCase()]() : m)
}

// ── !mp runner ────────────────────────────────────────────────────────
async function ircStyleUsername(token) {
    if (!room) throw new Error('Join a room first')
    return (await resolveUserTarget(token, room)).id
}
const commandContext = {
    getRoom: () => room, me: ctx.me, osu, modsReady, system: addSystemMsg,
    startTimer, stopTimer: () => stopLocalTimer(true), closeRoom: clearCurrentRoom,
    onRooms: ids => refereeRooms.setRooms(ids),
}
async function commandHandler(message) {
    addSystemMsg(`→ ${message.trim()}`, 'cmd')
    const result = await runRefereeCommand(message, commandContext)
    if (!result.success) addSystemMsg(result.error, 'warn')
    return result
}
async function sendChatText(text) {
    text = String(text ?? '').trim()
    if (!text || !room) throw new Error('Join a room and enter a message first')
    if (/^(!mp|!roll|\/roll)\b/i.test(text)) {
        const result = await commandHandler(text)
        requireSuccess(result, 'Command')
        return result
    }
    return sendRoomMessage(text)
}
async function sendRoomMessage(text) {
    const target = room
    if (!target?.chat_channel_id) throw new Error('No chat channel for this room')
    const result = await window.api.api.SendMessage(target.chat_channel_id, text)
    const sent = requireSuccess(result, 'Send message')
    // A successful HTTP response should be visible even if the chat websocket
    // is reconnecting. Its message ID deduplicates the later websocket echo.
    if (room === target && sent?.message_id != null) {
        const me = ctx.me()
        appendChat({ messageId: sent.message_id, uid: sent.sender_id ?? me.id, username: me.username, avatar_url: me.avatar_url,
            text: sent.content ?? text, team: target.players[me.id]?.team, isRef: !!target.refs[me.id], ts: sent.timestamp ? Date.parse(sent.timestamp) : Date.now() })
    }
    return result
}

// ── timers (local chat countdown + server match countdown display) ────
async function startTimer(seconds) {
    const target = room
    if (!target) throw new Error('Join a room first')
    seconds = integerInput(seconds, 'Timer seconds')
    await sendRoomMessage(`Started a countdown for ${seconds} seconds`)
    if (room !== target) throw new Error('Room changed while starting timer')
    stopLocalTimer(false)
    const informTimes = [30, 15, 10, 5]
    room.timer = { total: seconds, remaining: seconds }
    const until = Date.now() + seconds * 1000
    let lastAnnouncement = seconds
    const announce = text => sendRoomMessage(text).catch(error => { stopLocalTimer(false); toast(error.message) })
    countdown_id = setInterval(() => {
        if (!room) return stopLocalTimer(false)
        room.timer.remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000))
        const left = room.timer.remaining
        if (left <= 0) {
            announce("The countdown has ended.")
            ding('timerEnd', prefs.sounds.timerEnd)
            stopLocalTimer(false)
            return
        }
        if (left !== lastAnnouncement && (informTimes.includes(left) || left % 60 == 0)) {
            lastAnnouncement = left
            let msg = "The countdown has "
            msg += left >= 60 ? `${Math.floor(left / 60)} minutes ` : ""
            msg += left % 60 != 0 ? `${left % 60} seconds remaining.` : "remaining."
            announce(msg)
        }
        renderMatch(room, ctx)
    }, 1000)
    renderMatch(room, ctx)
    return { success: true }
}
function stopLocalTimer(announce) {
    const hadTimer = countdown_id != null
    if (hadTimer) clearInterval(countdown_id)
    countdown_id = null
    if (room) {
        room.timer = null
        if (hadTimer && announce) addSystemMsg("Countdown aborted")
        renderMatch(room, ctx)
    }
}
// server match countdown: CountdownStarted gives seconds, we tick locally
setInterval(() => {
    if (!room?.countdown) return
    room.countdown.remaining = Math.max(0, room.countdown.remaining - 1)
    renderMatch(room, ctx)
}, 1000)

// ── scores ────────────────────────────────────────────────────────────
async function addScore(room_id, playlist_id) {
    const item = room?.playlistItems?.[playlist_id] ?? room?.playedItems?.[playlist_id] ?? null
    const resp = await window.api.api.GetScores(room_id, playlist_id)
    if (!room || room.id !== room_id) return
    const scores = resp?.data
    log.info(`Got scores from room ${room_id} and playlist ${playlist_id}`)
    if (!scores || scores.error != null) {
        logEvent('GetScores', scores ?? resp)
        toast('Could not fetch scores for this map')
        return
    }
    const res = buildResult(room, item, scores)
    room.results.push(res)
    if (prefs.tracking.enabled && prefs.tracking.auto && room.local.awards[res.id] === undefined) {
        const a = autoAward(room, prefs.tracking, res)
        if (a != null) { room.local.awards[res.id] = a; room.saveLocal() }
    }
    const tv = room.type === 'team_versus'
    const wtxt = tv ? (res.winner === 'tie' ? 'tie' : `${room.local.teams[res.winner]} +${Math.abs(res.totals.red - res.totals.blue).toLocaleString()}`) : `${res.scores[0]?.username ?? '—'} ${res.scores[0]?.score?.toLocaleString() ?? ''}`
    addSystemMsg(`Match finished: ${wtxt}`, 'alert')
    ding('matchEnd', prefs.sounds.matchEnd)
    renderScores(room, ctx, true)
}

// ── actions used by the render layer ──────────────────────────────────
Object.assign(ctx.actions, {
    copy: copyText,
    async swapTeam(uid) {
        if (room.type !== 'team_versus') return toast('Teams apply in Team Versus only')
        const p = room.players[uid]
        if (!p || p.team === 'none') return
        await reportAction(() => osu.MoveUser(room.id, { user_id: uid, team: p.team === 'red' ? 'blue' : 'red' }), 'Move player')
    },
    async kick(uid) {
        const name = room.players[uid]?.user?.username ?? `#${uid}`
        if (await confirmUI('Kick player', `Kick ${name} from the room? They can be invited again.`, { ok: 'Kick' })) await reportAction(() => osu.KickPlayer(room.id, uid), 'Kick player')
    },
    async ban(uid) {
        const name = room.players[uid]?.user?.username ?? `#${uid}`
        if (await confirmUI('Ban player', `Ban ${name} from this room? They cannot rejoin.`, { ok: 'Ban' })) await reportAction(() => osu.BanUser(room.id, uid), 'Ban player')
    },
    async removeRef(uid) {
        const name = room.refs[uid]?.user?.username ?? `#${uid}`
        if (await confirmUI('Remove referee', `Remove ${name} as a referee of this room? Only the room host can do this.`, { ok: 'Remove' })) await reportAction(() => changeReferee(commandContext, '#' + uid, true), 'Remove referee')
    },
    openMapDlg,
    async removeMap(item) {
        const m = mapInfo(beatmapCached(item.beatmap_id), item.beatmap_id)
        if (!(await confirmUI('Remove map', `Remove ${m.title} [${m.version}] from the queue?`, { ok: 'Remove' }))) return
        const r = await osu.RemovePlaylistItem(room.id, { playlist_item_id: item.id })
        if (!r.success) toast('Could not remove map: ' + r.error)
    },
    award(res, award) {
        if (award == null) delete room.local.awards[res.id]
        else room.local.awards[res.id] = award
        room.saveLocal()
        renderScores(room, ctx)
    },
})

// ── dialogs ───────────────────────────────────────────────────────────
let mapEditing = null
function parseMods(text, mode, modes, original = [], allowed = false) {
    if (!text.trim()) return []
    const args = commandTokens(text)
    const parsed = buildModChange(args, mode, modes)
    const mods = allowed ? [...parsed.required_mods, ...parsed.allowed_mods] : parsed.required_mods
    // An unchanged acronym keeps advanced settings when editing the map ID.
    return mods.map(mod => mod.settings ? mod : { ...mod, ...(original.find(x => x.acronym === mod.acronym)?.settings ? { settings: { ...original.find(x => x.acronym === mod.acronym).settings } } : {}) })
}
function openMapDlg(item) {
    if (!room) return
    item = item ? room.playlistItems[item.id] : null
    mapEditing = item || null
    $('#map-title').textContent = item ? 'Edit map' : 'Add map'
    $('#map-beatmap').value = item ? item.beatmap_id : ''
    setSeg($('#map-ruleset'), item ? (item.ruleset_id ?? 0) : (room?.mode ?? 0))
    $('#map-required').value = item ? (item.required_mods || []).map(m => m.acronym).join(' ') : ''
    $('#map-allowed').value = item ? (item.allowed_mods || []).map(m => m.acronym).join(' ') : ''
    $('#map-freestyle').checked = !!item?.freestyle
    $('#map-remove').hidden = !item
    setResult('map-result', null)
    openDlg('#dlg-map')
    $('#map-beatmap').focus()
}
async function saveMap() {
    const button = $('#map-save')
    if (button.disabled) return
    button.disabled = true
    const target = room, edited = mapEditing
    try {
        if (!target) throw new Error('Join a room first')
        const map = beatmapInput($('#map-beatmap').value)
        const mode = map.ruleset ?? +$('#map-ruleset').dataset.value
        const modes = await modsReady
        const body = {
            beatmap_id: map.id, ruleset_id: mode,
            required_mods: parseMods($('#map-required').value, mode, modes, edited?.required_mods),
            allowed_mods: parseMods($('#map-allowed').value, mode, modes, edited?.allowed_mods, true),
            freestyle: $('#map-freestyle').checked,
        }
        if (room !== target) throw new Error('Room changed; reopen the map editor')
        const result = edited
            ? await osu.EditPlaylistItem(target.id, { playlist_item_id: edited.id, ...body })
            : await osu.AddPlaylistItem(target.id, body)
        requireSuccess(result, edited ? 'Edit map' : 'Add map')
        if (room !== target) return
        closeDlg('#dlg-map')
        toast(edited ? 'Map update accepted' : 'Map added to the queue')
    } catch (error) { setResult('map-result', { success: false, error: error.message }) }
    finally { button.disabled = false }
}

let inviteKind = 'player'
function openInvite(kind) {
    inviteKind = kind
    $('#inv-title').textContent = kind === 'ref' ? 'Add referee' : 'Invite player'
    $('#inv-ok').textContent = kind === 'ref' ? 'Add referee' : 'Send invite'
    $('#inv-hint').textContent = kind === 'ref'
        ? 'Only the room host can add referees. Ask the recipient to open and sign in to APL Ref first, then join this room after being added. Opening osu! alone is not enough.'
        : 'This dialog stays open for multiple invites.'
    $('#inv-name').value = ''
    setResult('inv-result', null)
    openDlg('#dlg-invite'); $('#inv-name').focus()
}
async function submitInvite() {
    const token = $('#inv-name').value.trim()
    if (!token) { $('#inv-name').focus(); return }
    const button = $('#inv-ok'), current = room, kind = inviteKind
    if (button.disabled) return
    button.disabled = true
    try {
        if (!current) throw new Error('Join a room first')
        let result
        if (kind === 'ref') result = await changeReferee(commandContext, token)
        else {
            const target = await resolveUserTarget(token, current)
            if (room !== current) throw new Error('Room changed; retry in the intended room')
            result = await osu.InvitePlayer(current.id, target.id)
        }
        if (room !== current || kind !== inviteKind) return
        requireSuccess(result, kind === 'ref' ? 'Add referee' : 'Invite player')
        setResult('inv-result', { success: true, message: result.message || `Invited ${token}` })
        if (kind === 'ref') { closeDlg('#dlg-invite'); toast(result.message, 6500) }
        else { $('#inv-name').value = ''; $('#inv-name').focus() }
    } catch (error) { setResult('inv-result', { success: false, error: error.message }) }
    finally { button.disabled = false }
}

function syncTrackingForm() {
    const on = $('#set-track').checked
    const opts = $('#set-track-opts')
    opts.style.opacity = on ? '' : '.45'; opts.style.pointerEvents = on ? '' : 'none'
    const bo = $('#set-track-format').dataset.value === 'bestof'
    $('#set-bo-wrap').hidden = !bo; $('#set-custom-wrap').hidden = bo
    const n = Math.max(1, parseInt($('#set-bo').value, 10) || 9)
    $('#set-bo-hint').textContent = `first to ${Math.ceil(n / 2)}`
}
function openSettings() {
    if (!room) return
    $('#set-name').value = room.name; $('#set-password').value = room.password ?? ''; $('#set-max').value = room.max_participants ?? 0
    setSeg($('#set-type'), room.type)
    $('#set-red').value = room.local.teams.red; $('#set-blue').value = room.local.teams.blue
    const tr = prefs.tracking
    $('#set-track').checked = tr.enabled; setSeg($('#set-track-mode'), tr.auto ? 'auto' : 'manual'); setSeg($('#set-track-format'), tr.format)
    $('#set-bo').value = tr.bestOf; $('#set-ptw').value = tr.pointsToWin; $('#set-draws').checked = tr.allowDraws
    $('#set-snd-ready').checked = prefs.sounds.allReady; $('#set-snd-end').checked = prefs.sounds.matchEnd; $('#set-snd-timer').checked = prefs.sounds.timerEnd
    setResult('set-result', null)
    syncTrackingForm()
    openDlg('#dlg-settings')
}
async function applySettings() {
    if (!room) return
    // local first: these never fail
    room.local.teams = { red: $('#set-red').value.trim() || 'Red', blue: $('#set-blue').value.trim() || 'Blue' }
    room.saveLocal()
    prefs.tracking = { enabled: $('#set-track').checked, auto: $('#set-track-mode').dataset.value === 'auto', format: $('#set-track-format').dataset.value,
        bestOf: Math.max(1, parseInt($('#set-bo').value, 10) || 9), pointsToWin: Math.max(1, parseInt($('#set-ptw').value, 10) || 5), allowDraws: $('#set-draws').checked }
    prefs.sounds = { allReady: $('#set-snd-ready').checked, matchEnd: $('#set-snd-end').checked, timerEnd: $('#set-snd-timer').checked }
    savePrefs(prefs)

    const settings = {}
    const name = $('#set-name').value.trim()
    const password = $('#set-password').value
    const max_participants = Math.max(0, parseInt($('#set-max').value, 10) || 0)
    const type = $('#set-type').dataset.value
    if (name && name !== room.name) settings.name = name
    if (password !== (room.password ?? '')) settings.password = password
    if (max_participants !== (room.max_participants ?? 0)) settings.max_participants = max_participants
    if (type !== room.type) settings.type = type
    if (Object.keys(settings).length) {
        const result = await osu.ChangeRoomSettings(room.id, settings)
        if (!result.success) { setResult('set-result', result); scheduleRender(); return }
    }
    closeDlg('#dlg-settings')
    scheduleRender()
}

// ── macro + command modules ───────────────────────────────────────────
const macroUI = createMacroUI({
    macros, resolve: resolveText,
    sendChat: sendChatText,
    runCommand: text => commandHandler(text),
    me: ctx.me,
    active: () => !!room,
    contextId: () => room?.id,
})
const cmdUI = createCommandUI({
    players: () => room ? room.playerList().map(p => ({ id: p.id, username: p.user?.username ?? `#${p.id}` })) : [],
    runCommand: text => sendChatText(text),
})

// ── wiring ────────────────────────────────────────────────────────────
mountIcons()
applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
$('#tb-theme').addEventListener('click', () => applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark'))

wireMenu('#tb-more', '#menu-more')
document.addEventListener('click', closeMenus)
$('#menu-more').addEventListener('click', async e => {
    const act = e.target.closest('button')?.dataset.act
    if (!act || !room) return
    if (act === 'addref') openInvite('ref')
    if (act === 'copy') copyText(`https://osu.ppy.sh/multiplayer/rooms/${room.id}`, 'Room link copied')
    if (act === 'close') {
        if (!(await confirmUI('Close room', `Close room #${room.id}? All players are removed. This cannot be undone.`, { ok: 'Close room' }))) return
        const result = await osu.CloseRoom(room.id)
        if (result.success) clearCurrentRoom()
        else toast('Could not close room: ' + result.error, 5000)
    }
})
$('#tb-room-name').addEventListener('click', openSettings)
$('#tb-settings').addEventListener('click', openSettings)
$('#tb-ids').addEventListener('click', () => room && copyText(`https://osu.ppy.sh/multiplayer/rooms/${room.id}`, 'Room link copied'))
$('#tb-resync').addEventListener('click', async e => {
    if (!room) return
    const b = e.currentTarget, label = b.querySelector('span'), svg = b.querySelector('svg')
    const roomId = room.id
    b.disabled = true; svg.classList.add('spin'); if (label) label.textContent = 'Syncing…'
    try {
        const result = await window.api.ResyncRoom(roomId)
        if (!result.success) throw new Error(result.error)
        installRoomSnapshot(result.data)
        toast('Room resynced')
    } catch (err) {
        toast('Resync failed: ' + err.message, 5000)
    } finally {
        svg.classList.remove('spin'); if (label) label.textContent = 'Resync'; b.disabled = false
    }
})
createQueuePanel($('#view-room'), $('#col-queue'), $('#tb-queue'), $('#btn-queue-close'), $('#queue-backdrop'))

$('#btn-lock').addEventListener('click', () => room && reportAction(() => osu.SetLockState(room.id, { locked: !room.locked }), 'Set lock state'))
$('#btn-size').addEventListener('click', () => { openSettings(); $('#set-max').focus(); $('#set-max').select() })
$('#btn-invite').addEventListener('click', () => openInvite('player'))
$('#btn-addref').addEventListener('click', () => openInvite('ref'))

$('#btn-freestyle').addEventListener('click', async () => {
    if (ui.freestylePending || !room?.currentItem() || ['playing', 'countdown'].includes(room.status)) return
    ui.freestylePending = true; renderMatch(room, ctx)
    try { requireSuccess(await commandHandler(`!mp freestyle ${room.currentItem().freestyle ? 'off' : 'on'}`), 'Change Freestyle') }
    catch (error) { toast(error.message) }
    finally { ui.freestylePending = false; if (room) renderMatch(room, ctx) }
})

function reportAction(task, label) {
    return Promise.resolve().then(task).then(result => { requireSuccess(result, label); return result }).catch(error => toast(error.message))
}
$('#btn-start').addEventListener('click', () => room && reportAction(() => osu.StartMatch(room.id, { countdown: prefs.secStart }), 'Start match'))
$('#btn-abort').addEventListener('click', () => {
    if (!room) return
    if (room.status === 'countdown') reportAction(() => osu.StopMatchCountdown(room.id), 'Cancel countdown')
    else reportAction(() => osu.AbortMatch(room.id), 'Abort match')
})
$('#btn-timer').addEventListener('click', () => reportAction(() => startTimer(prefs.secTimer), 'Start timer'))
$('#timer-stop').addEventListener('click', () => stopLocalTimer(true))
buildSeg($('#seg-start'), [0, 5, 10, 30].map(v => ({ value: v, label: v === 0 ? 'now' : v + 's' })), prefs.secStart, v => { prefs.secStart = +v; savePrefs(prefs) })
buildSeg($('#seg-timer'), [30, 60, 90, 120].map(v => ({ value: v, label: v + 's' })), prefs.secTimer, v => { prefs.secTimer = +v; savePrefs(prefs) })

const chatInput = $('#chat-input')
async function submitChat() {
    const text = chatInput.value.trim()
    const button = $('#chat-send'), target = room
    if (!text || button.disabled) return
    button.disabled = true
    cmdUI.hideAc()
    try {
        await sendChatText(text)
        if (room === target && chatInput.value.trim() === text) chatInput.value = ''
    } catch (error) { toast(error.message, 5000); addSystemMsg(error.message, 'warn') }
    finally { button.disabled = false }
}
$('#chat-send').addEventListener('click', submitChat)
chatInput.addEventListener('keydown', e => { if (e.isComposing) return; if (cmdUI.acKey(e)) return; if (e.key === 'Enter') { e.preventDefault(); submitChat() } })
$('#chk-sys').addEventListener('change', e => $('#chat-log').classList.toggle('hide-sys', !e.target.checked))
$('#btn-history').addEventListener('click', () => { ui.historyOpen = !ui.historyOpen; if (room) renderScores(room, ctx) })
$('#btn-addmap').addEventListener('click', () => openMapDlg(null))
$('#btn-events').addEventListener('click', () => { ui.eventsOpen = !ui.eventsOpen; renderEvents(events, ctx) })

$$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close() }))
buildSeg($('#map-ruleset'), RULESETS.map((l, i) => ({ value: i, label: l })), 0)
$('#map-cancel').addEventListener('click', () => closeDlg('#dlg-map'))
$('#map-save').addEventListener('click', saveMap)
$('#map-remove').addEventListener('click', () => { const it = mapEditing; closeDlg('#dlg-map'); if (it) ctx.actions.removeMap(it) })
$('#dlg-map').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') saveMap() })
$('#inv-cancel').addEventListener('click', () => closeDlg('#dlg-invite'))
$('#inv-ok').addEventListener('click', submitInvite)
$('#inv-name').addEventListener('keydown', e => { if (e.key === 'Enter') submitInvite() })
buildSeg($('#set-type'), [{ value: 'head_to_head', label: 'Head-to-head' }, { value: 'team_versus', label: 'Team versus' }], 'team_versus')
buildSeg($('#set-track-mode'), [{ value: 'manual', label: 'Manual' }, { value: 'auto', label: 'Automatic' }], 'manual', syncTrackingForm)
buildSeg($('#set-track-format'), [{ value: 'bestof', label: 'Best of' }, { value: 'custom', label: 'Custom' }], 'bestof', syncTrackingForm)
$('#set-track').addEventListener('change', syncTrackingForm)
$('#set-bo').addEventListener('input', syncTrackingForm)
$('#set-cancel').addEventListener('click', () => closeDlg('#dlg-settings'))
$('#set-apply').addEventListener('click', applySettings)

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeMenus(); cmdUI.openPanel(false) }
})

// ── landing: make / join ──────────────────────────────────────────────
function int(id) { return parseInt(document.getElementById(id).value, 10) }
function str(id) { return document.getElementById(id).value.trim() }
buildSeg($('#make-ruleset'), RULESETS.map((l, i) => ({ value: i, label: l })), 0)
let previewSeq = 0
async function updateMakePreview() {
    const id = int('make-beatmap-id')
    const el = $('#make-preview')
    if (!id) { el.textContent = ''; return }
    const seq = ++previewSeq
    el.textContent = 'Looking up beatmap…'
    const bm = await GetBeatmap(id)
    if (seq !== previewSeq) return
    const m = mapInfo(bm, id)
    el.textContent = bm?.error ? `Beatmap ${id} not found` : `${m.artist} – ${m.title} [${m.version}] · ★${m.stars?.toFixed(2) ?? '?'}`
}
$('#make-beatmap-id').addEventListener('input', updateMakePreview)
$('#make-room-btn').addEventListener('click', async () => {
    const result = await osu.MakeRoom({
        ruleset_id: +$('#make-ruleset').dataset.value || 0,
        beatmap_id: int('make-beatmap-id'),
        name: str('make-room-name'),
        max_participants: Object.is(int('make-room-max-participants'), NaN) ? 0 : int('make-room-max-participants')
    })
    setResult('make-room-result', result.success ? null : result)
    if (result.success && result.data) installRoomSnapshot(result.data)
})
$('#join-room-btn').addEventListener('click', async () => {
    const roomId = int('join-room-id')
    if (!roomId) { toast('Enter a room ID'); return }
    const result = await osu.JoinRoom(roomId)
    setResult('join-room-result', result.success ? null : result)
    if (result.success && result.data) installRoomSnapshot(result.data)
})
$('#join-room-id').addEventListener('keydown', e => { if (e.key === 'Enter') $('#join-room-btn').click() })

// ── incoming events / chat / connection ───────────────────────────────
for (const [name, subscribe] of Object.entries(window.api.on)) {
    subscribe(info => {
        if (name === 'RefereeInvited') refereeRooms.invite(info.room_id)
        if (name === 'RefereeRemoved' && info?.user_id === window.me?.id) refereeRooms.remove(info.room_id)
        if (Queue?.room && info?.room_id == Queue.room.id) Queue.add(new Event(name, info))
        logEvent(name, info)
    })
}

window.api.api.onChatMessage(async buffer => {
    try {
    if (!room?.chat_channel_id) return;
    const data = JSON.parse(buffer)
    if (data.event != "chat.message.new") return;
    for (const msg of data.data.messages) {
        if (msg.channel_id != room.chat_channel_id) continue
        const target = room
        const u = await target.GetUser(msg.sender_id)
        if (room !== target || room.chat_channel_id != msg.channel_id) return
        appendChat({
            messageId: msg.message_id,
            uid: msg.sender_id, username: u.user.username, avatar_url: u.user.avatar_url, text: msg.content,
            team: room.players[msg.sender_id]?.team, isRef: !!room.refs[msg.sender_id], ts: msg.timestamp ? Date.parse(msg.timestamp) : Date.now(),
        })
    }
    } catch (error) { log.error('Could not display chat: ' + error.message); toast('Could not display chat: ' + error.message) }
})

async function updateStatus() {
    let connected = false
    try { const status = await window.api.GetConnectionStatus(); connected = !!(status.success && status.data?.connected) } catch { /* IPC is reconnecting */ }
    if (connected !== ctx.connected) { ctx.connected = connected; renderTopbar(room, ctx); if (connected) refereeRooms.refresh() }
}
updateStatus()
setInterval(updateStatus, 5000)

// ── mock mode (APL_MOCK=1): simulate menu ─────────────────────────────
if (window.api.mock) {
    $('#tb-sim-wrap').hidden = false
    wireMenu('#tb-sim', '#menu-sim', { stayOpen: true })
    $('#menu-sim').addEventListener('click', async e => {
        const kind = e.target.closest('button')?.dataset.sim
        if (!kind) return
        const result = await window.api.mock.trigger(kind)
        if (result?.message) toast(result.message)
    })
    if (new URLSearchParams(location.search).has('mockjoin')) setTimeout(() => { $('#join-room-id').value = '1487223'; $('#join-room-btn').click() }, 300)
}

renderAll()

// just for personal use of testing
window.osu = osu
window.ircStyleUsername = (str) => {return ircStyleUsername(str)}
window.MODS = () => {return MODS};
window.room = () => {return room}
window.log = log
window.prefs = prefs
