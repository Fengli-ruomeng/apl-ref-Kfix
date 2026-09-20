// Offline stand-in for preload.js: same window.api surface, but every hub call
// mutates an in-memory room and echoes the events the real server would send.
// Enabled with APL_MOCK=1 (see src/main/index.js). Never talks to osu!.
const { contextBridge, ipcRenderer } = require('electron')

// sandboxed preloads cannot require project files; main serves these lists over IPC
ipcRenderer.invoke('get-api-data').then(([CMDS_SET, EVENTS, version]) => {

    const ME = 901
    const USERS = {
        1: { id: 1, username: 'Averagegal' }, 2: { id: 2, username: 'submissive cat' }, 3: { id: 3, username: 'OtoriEmu' }, 4: { id: 4, username: 'Zeguqi' },
        11: { id: 11, username: 'mrekk' }, 12: { id: 12, username: 'Mumei' }, 13: { id: 13, username: 'WhiteCat' }, 14: { id: 14, username: 'Akolibed' }, 15: { id: 15, username: 'chocomint' }, 16: { id: 16, username: 'Lifeline' },
        900: { id: 900, username: 'applearon' }, [ME]: { id: ME, username: 'Kaguya' },
    }
    for (const u of Object.values(USERS)) u.avatar_url = ''
    const BEATMAPS = {
        3398826: { artist: 'Camellia', title: 'GHOST', version: 'Nightmare', creator: 'Sotarks', stars: 6.87, length: 277, bpm: 220, cs: 4, ar: 9.6, od: 9.2, hp: 6 },
        1003651: { artist: 'xi', title: 'Blue Zenith', version: 'FOUR DIMENSIONS', creator: 'Asphyxia', stars: 7.12, length: 249, bpm: 200, cs: 4, ar: 9.5, od: 9, hp: 6 },
        2626718: { artist: 'Nekomata Master', title: 'Scars of FAUNA', version: 'Master', creator: 'Sotarks', stars: 6.41, length: 128, bpm: 175, cs: 4.2, ar: 9.3, od: 9, hp: 5 },
        1849452: { artist: 'Yooh', title: 'Ice Angel', version: 'Frozen', creator: 'Monstrata', stars: 6.02, length: 214, bpm: 190, cs: 4, ar: 9.4, od: 9, hp: 6 },
        4012345: { artist: 'Kola Kid', title: 'good old times', version: 'max', creator: 'Sotarks', stars: 6.55, length: 150, bpm: 180, cs: 4, ar: 9.4, od: 9, hp: 6 },
    }
    const CHAT_POOL = ['gl', 'gg', 'one sec', 'ready', 'can we get 30s', 'my game crashed lol', 'nice', 'unlucky', 'rip', 'pick zenith']

    const listeners = {}
    let chatCb = null
    let room = null
    let isHost = true, recipientConnected = true
    const availableRooms = new Set([1487223])
    let itemSeq = 100, cdSeq = 0
    let timers = []
    const clearTimers = () => { timers.forEach(clearTimeout); timers = [] }
    const later = (ms, fn) => timers.push(setTimeout(fn, ms))
    const ok = data => ({ success: true, data })
    const fail = error => ({ success: false, error })
    const rand = a => a[Math.floor(Math.random() * a.length)]
    const emit = (name, info) => setTimeout(() => (listeners[name] || []).forEach(cb => cb({ room_id: room?.room_id, ...info })), 0)
    const snapshot = () => JSON.parse(JSON.stringify(room))
    const need = () => { if (!room) throw new Error('Not in a room') }

    function item(beatmap_id, ruleset_id, extra = {}) {
        return { id: ++itemSeq, owner_id: ME, beatmap_id, ruleset_id, required_mods: [], allowed_mods: [], freestyle: false, was_played: false, order: 0, ...extra }
    }
    function reorder() { room.playlist.filter(i => !i.was_played).sort((a, b) => a.order - b.order).forEach((i, n) => i.order = n) }
    function player(uid) { return room.players.find(p => p.user_id === uid) }
    function addPlayer(uid, team) {
        if (player(uid)) return
        const teams = { red: 0, blue: 0 }
        for (const p of room.players) if (teams[p.team] != null) teams[p.team]++
        room.players.push({ user_id: uid, team: room.state.type === 'team_versus' ? (team || (teams.red <= teams.blue ? 'red' : 'blue')) : 'none', mods: [], status: 'idle', style: null })
        const i = room.state.slots.indexOf(null)
        if (i >= 0) room.state.slots[i] = uid; else room.state.slots.push(uid)
        emit('UserJoined', { user_id: uid })
        if (room.state.type === 'team_versus') emit('UserTeamChanged', { user_id: uid, team: player(uid).team })
    }
    function removePlayer(uid, evName, key) {
        room.players = room.players.filter(p => p.user_id !== uid)
        room.state.slots = room.state.slots.map(s => s === uid ? null : s)
        emit(evName, { [key]: uid })
        emit('MatchStateChanged', { state: room.state })
    }
    function chat(sender_id, content) {
        if (!chatCb || !room) return
        setTimeout(() => chatCb(JSON.stringify({ event: 'chat.message.new', data: { messages: [{ channel_id: room.chat_channel_id, sender_id, content, timestamp: new Date().toISOString(), message_id: Date.now() }] } })), 0)
    }
    function setStatus(uid, status) { const p = player(uid); if (p) { p.status = status; emit('UserStatusChanged', { user_id: uid, status }) } }
    function makeRoom(req) {
        clearTimers()
        const max = req.max_participants || 0
        room = {
            room_id: 1487000 + Math.floor(Math.random() * 900), chat_channel_id: 61990000 + Math.floor(Math.random() * 9000),
            name: req.name || 'Mock room', password: '', playlist: [item(req.beatmap_id || 3398826, req.ruleset_id || 0)],
            referees: [{ user_id: ME }, { user_id: 900 }], players: [], state: { type: 'head_to_head', locked: false, slots: Array(max).fill(null) },
        }
        return snapshot()
    }
    function joinRoom(roomId = 1487223) {
        clearTimers()
        room = {
            room_id: roomId, chat_channel_id: 61987707, name: 'APL: (Averagegal) vs (submissive cat)', password: 'apl',
            playlist: [
                item(3398826, 0, { order: 0 }), item(1003651, 0, { order: 1, required_mods: [{ acronym: 'HD' }] }),
                item(2626718, 0, { order: 2, required_mods: [{ acronym: 'DT', settings: { speed_change: 1.5 } }] }),
                item(1849452, 0, { order: 3, allowed_mods: [{ acronym: 'HD' }, { acronym: 'HR' }, { acronym: 'EZ' }, { acronym: 'FL' }] }),
                item(4012345, 0, { order: 4, freestyle: true, allowed_mods: [{ acronym: 'HD' }, { acronym: 'HR' }] }),
            ],
            referees: [{ user_id: 900 }, { user_id: ME }],
            players: [
                { user_id: 1, team: 'red', mods: [{ acronym: 'HD' }], status: 'ready', style: null },
                { user_id: 2, team: 'blue', mods: [{ acronym: 'HR' }], status: 'ready', style: null },
                { user_id: 3, team: 'blue', mods: [], status: 'idle', style: null },
                { user_id: 4, team: 'red', mods: [], status: 'spectating', style: null },
            ],
            state: { type: 'team_versus', locked: false, slots: [1, 2, 3, 4, null, null, null, null] },
        }
        later(1500, () => chat(3, 'cause of lazer'))
        later(2600, () => chat(1, 'genuinely'))
        return snapshot()
    }
    function finishMatch(playlistItem) {
        for (const p of room.players) if (p.status === 'playing' || p.status === 'finished_play') p.status = 'idle'
        playlistItem.was_played = true
        emit('PlaylistItemChanged', { playlist_item: { ...playlistItem } })
        reorder()
        for (const i of room.playlist.filter(i => !i.was_played)) emit('PlaylistItemChanged', { playlist_item: { ...i } })
        emit('MatchCompleted', { playlist_item_id: playlistItem.id })
        for (const p of room.players) if (p.status !== 'spectating') emit('UserStatusChanged', { user_id: p.user_id, status: 'idle' })
    }

    const send = {}
    for (const cmd of CMDS_SET) send[cmd] = async () => fail(`${cmd} is not simulated`)
    Object.assign(send, {
        Ping: async msg => ok(msg),
        MakeRoom: async req => ok(makeRoom(req)),
        JoinRoom: async id => availableRooms.has(id) ? ok(joinRoom(id)) : fail('No referee access to this room'),
        CloseRoom: async () => { clearTimers(); room = null; return ok(null) },
        ListRooms: async () => ok({ room_ids: [...availableRooms] }),
        InvitePlayer: async (_, uid) => { need(); if (!USERS[uid]) USERS[uid] = { id: uid, username: `user${uid}`, avatar_url: '' }; later(1500, () => room && addPlayer(uid)); return ok(null) },
        KickPlayer: async (_, uid) => { need(); removePlayer(uid, 'UserKicked', 'kicked_user_id'); return ok(null) },
        BanUser: async (_, uid) => { need(); removePlayer(uid, 'UserKicked', 'kicked_user_id'); return ok(null) },
        AddReferee: async (_, uid) => {
            need()
            if (uid === ME) return fail('Error 15: Cannot perform this operation on self.')
            if (!isHost) return fail('Error 18: You are not the host of the room.')
            if (!recipientConnected) return fail("An unexpected error occurred invoking 'AddReferee' on the server.")
            if (!room.referees.some(r => r.user_id === uid)) room.referees.push({ user_id: uid })
            emit('RefereeAdded', { user_id: uid }); return ok(null)
        },
        RemoveReferee: async (_, uid) => {
            need()
            if (!isHost) return fail('Error 18: You are not the host of the room.')
            if (uid === ME) return fail('Error 15: Cannot perform this operation on self.')
            room.referees = room.referees.filter(r => r.user_id !== uid); emit('RefereeRemoved', { user_id: uid }); return ok(null)
        },
        ChangeRoomSettings: async (_, req) => {
            need()
            if (req.name != null) room.name = req.name
            if (req.password != null) room.password = req.password
            if (req.type != null && req.type !== room.state.type) { room.state.type = req.type; let i = 0; for (const p of room.players) { p.team = req.type === 'team_versus' ? (i++ % 2 ? 'blue' : 'red') : 'none'; emit('UserTeamChanged', { user_id: p.user_id, team: p.team }) } }
            if (req.max_participants != null) { const ids = room.state.slots.filter(Boolean); room.state.slots = req.max_participants ? [...ids, ...Array(Math.max(0, req.max_participants - ids.length)).fill(null)] : ids }
            emit('RoomSettingsChanged', { name: room.name, password: room.password, type: room.state.type, max_participants: room.state.slots.length || null })
            emit('MatchStateChanged', { state: room.state })
            return ok(null)
        },
        SetLockState: async (_, req) => { need(); room.state.locked = !!req.locked; emit('MatchStateChanged', { state: room.state }); return ok(null) },
        MoveUser: async (_, req) => {
            need(); const p = player(req.user_id); if (!p) return fail('No such player')
            if (req.team) { p.team = req.team; emit('UserTeamChanged', { user_id: p.user_id, team: p.team }) }
            if (req.slot != null) { const s = room.state.slots; const from = s.indexOf(p.user_id); if (req.slot >= s.length || s[req.slot]) return fail('Slot unavailable'); s[from] = null; s[req.slot] = p.user_id; emit('MatchStateChanged', { state: room.state }) }
            return ok(null)
        },
        AddPlaylistItem: async (_, req) => { need(); const it = item(req.beatmap_id, req.ruleset_id || 0, { required_mods: req.required_mods || [], allowed_mods: req.allowed_mods || [], freestyle: !!req.freestyle, order: room.playlist.filter(i => !i.was_played).length }); room.playlist.push(it); emit('PlaylistItemAdded', { playlist_item: { ...it } }); return ok(null) },
        EditPlaylistItem: async (_, req) => { need(); const it = room.playlist.find(i => i.id === req.playlist_item_id); if (!it) return fail('No such item'); Object.assign(it, { beatmap_id: req.beatmap_id ?? it.beatmap_id, ruleset_id: req.ruleset_id ?? it.ruleset_id, required_mods: req.required_mods ?? it.required_mods, allowed_mods: req.allowed_mods ?? it.allowed_mods, freestyle: req.freestyle ?? it.freestyle }); emit('PlaylistItemChanged', { playlist_item: { ...it } }); return ok(null) },
        EditCurrentPlaylistItem: async (_, req) => { need(); const it = room.playlist.find(i => !i.was_played && i.order === 0); if (!it) return fail('No current item'); Object.assign(it, req); emit('PlaylistItemChanged', { playlist_item: { ...it } }); return ok(null) },
        RemovePlaylistItem: async (_, req) => { need(); room.playlist = room.playlist.filter(i => i.id !== req.playlist_item_id); reorder(); emit('PlaylistItemRemoved', { playlist_item_id: req.playlist_item_id }); for (const i of room.playlist.filter(i => !i.was_played)) emit('PlaylistItemChanged', { playlist_item: { ...i } }); return ok(null) },
        Roll: async (_, req) => { need(); const max = req?.max || 100; emit('RollCompleted', { user_id: ME, result: 1 + Math.floor(Math.random() * max), max }); return ok(null) },
        StartMatch: async (_, req) => {
            need()
            const current = room.playlist.find(i => !i.was_played && i.order === 0)
            if (!current) return fail('No playlist item')
            const seconds = req?.countdown || 0
            const begin = () => {
                emit('MatchStarted', {})
                const active = room.players.filter(p => p.status !== 'spectating')
                for (const p of active) setStatus(p.user_id, 'playing')
                active.forEach((p, i) => later(4000 + i * 1200, () => setStatus(p.user_id, 'finished_play')))
                later(4000 + active.length * 1200 + 1200, () => finishMatch(current))
            }
            if (seconds > 0) { const id = ++cdSeq; emit('CountdownStarted', { countdown_id: id, seconds, type: 'match_start' }); later(seconds * 1000, () => { emit('CountdownStopped', { countdown_id: id, type: 'match_start' }); begin() }) }
            else begin()
            return ok(null)
        },
        StopMatchCountdown: async () => { need(); clearTimers(); emit('CountdownStopped', { countdown_id: cdSeq, type: 'match_start' }); return ok(null) },
        AbortMatch: async () => { need(); clearTimers(); for (const p of room.players) if (p.status !== 'spectating') setStatus(p.user_id, 'idle'); emit('MatchAborted', {}); return ok(null) },
    })

    const api = {
        onChatMessage: cb => { chatCb = cb },
        GetUser: async key => {
            let u = USERS[key] ?? Object.values(USERS).find(x => x.username.toLowerCase() === String(key).toLowerCase())
            if (!u) { const id = 500 + Math.floor(Math.random() * 400); u = USERS[id] = { id, username: String(key), avatar_url: '' } }
            return ok({ ...u })
        },
        GetSelf: async () => ok({ ...USERS[ME] }),
        SendMessage: async (channel_id, message) => { chat(ME, message); return ok({ content: message }) },
        GetBeatmap: async id => {
            await new Promise(r => setTimeout(r, 250))
            const b = BEATMAPS[id] || { artist: 'Unknown artist', title: `Beatmap ${id}`, version: 'Unknown', creator: '—', stars: 4.5 + (id % 300) / 100, length: 120 + (id % 180), bpm: 150 + (id % 70), cs: 4, ar: 9, od: 8.5, hp: 5.5 }
            return ok({ id, version: b.version, difficulty_rating: b.stars, total_length: b.length, bpm: b.bpm, cs: b.cs, ar: b.ar, accuracy: b.od, drain: b.hp, mode_int: 0, beatmapset: { artist: b.artist, title: b.title, creator: b.creator, covers: {} } })
        },
        GetScores: async () => {
            if (!room) return ok({ scores: [] })
            const bias = rand(['red', 'blue'])
            const scores = room.players.filter(p => p.status !== 'spectating').map(p => ({ user_id: p.user_id, user: { ...USERS[p.user_id] }, total_score: Math.round((420000 + Math.random() * 480000) * (p.team === bias ? 1.12 : 1)), accuracy: 0.91 + Math.random() * 0.087, max_combo: 250 + Math.floor(Math.random() * 1000), passed: true }))
            return ok({ scores })
        },
        Log: async (type, text) => { console.log(`[mock:${type}]`, text); return ok(null) },
    }
    const on = {}
    for (const ev of EVENTS) on[ev] = cb => { (listeners[ev] ||= []).push(cb) }

    const mock = {
        trigger(kind) {
            if (kind === 'refinvite') { availableRooms.add(1487333); emit('RefereeInvited', { room_id: 1487333 }); return }
            if (kind === 'refhost') { isHost = !isHost; return { message: `Mock room host: ${isHost ? 'yes' : 'no'}` } }
            if (kind === 'refoffline') { recipientConnected = !recipientConnected; return { message: `Mock referee recipient: ${recipientConnected ? 'connected' : 'offline'}` } }
            if (!room) return
            const ids = room.players.map(p => p.user_id)
            const pool = Object.keys(USERS).map(Number).filter(id => id < 900 && !ids.includes(id))
            switch (kind) {
            case 'join': if (pool.length) addPlayer(rand(pool)); break
            case 'leave': if (ids.length) { const uid = rand(ids); room.players = room.players.filter(p => p.user_id !== uid); room.state.slots = room.state.slots.map(s => s === uid ? null : s); emit('UserLeft', { user_id: uid }); emit('MatchStateChanged', { state: room.state }) } break
            case 'ready': { const c = room.players.filter(p => !['spectating', 'playing'].includes(p.status)); if (c.length) { const p = rand(c); setStatus(p.user_id, p.status === 'ready' ? 'idle' : 'ready') } } break
            case 'allready': for (const p of room.players) if (!['spectating', 'playing'].includes(p.status)) setStatus(p.user_id, 'ready'); break
            case 'chat': if (ids.length) chat(rand(ids), rand(CHAT_POOL)); break
            case 'mods': if (ids.length) { const p = player(rand(ids)); p.mods = rand([[], [{ acronym: 'HD' }], [{ acronym: 'HR' }], [{ acronym: 'HD' }, { acronym: 'HR' }]]); emit('UserModsChanged', { user_id: p.user_id, mods: p.mods }) } break
            }
        },
    }

    contextBridge.exposeInMainWorld('api', {
        send,
        GetConnectionStatus: async () => ok({ connected: true }),
        ResyncRoom: async () => room ? ok(snapshot()) : fail('Not in a room'),
        api, dev: { CloseWS: async () => ok(null) }, config: { SendConfig: async () => ok(null) }, on, mock,
    })
    contextBridge.exposeInMainWorld('version', version + ' (mock)')
})
