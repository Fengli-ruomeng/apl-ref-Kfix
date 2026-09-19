import { idFromUsername, addSystemMsg } from './utils.js'
import { loadRoomLocal, saveRoomLocal } from './local.js'
import { requireSuccess } from './requests.js'

export class User {
    constructor(id, user, team, mods, style, status) {
        this.id = id; // user id
        this.user = user // user json from api
        this.team = team // team: "red", "blue", "none"
        this.mods = mods; // array of Mods (mod acronym, settings)
        this.style = style; // idek man it's freestyle
        this.status = status // spectating or idle or playing or whatever
    }
}

export class Room {
    // stores all information about a room; rendering happens through onChange
    constructor(resp) { // RoomJoinedResponse data
        this.disposed = false
        this.id = resp.room_id
        this.chat_channel_id = resp.chat_channel_id
        this.name = resp.name
        this.password = resp.password
        this.playlistItems = {}
        for (const item of resp.playlist) {
            if (!item.was_played) this.playlistItems[item.id] = item
        }
        this.mode = this.updateMode()
        this.players = {}
        this.refs = {}
        this.userData = new Map()
        this.userRequests = new Map()
        this.max_participants = resp.state.slots?.length ?? 0;
        this.player_slots = resp.state.slots ?? []
        this.type = resp.state.type ?? "head_to_head"
        this.locked = resp.state.locked ?? false

        // 'idle' | 'countdown' | 'playing' | 'results'
        this.status = "idle"
        this.countdown = null // { id, total, remaining } from CountdownStarted
        this.timer = null     // { total, remaining } local chat countdown
        this.results = []     // finished maps, see tracking.js
        this.playedItems = {} // playlist items that were played, kept for the score history
        this.local = loadRoomLocal(this.id, this.name)
        this.editing_playlist_item = 0;

        // hooks set by index.js
        this.onChange = () => {}
        this.onClose = () => {}
        this.onMatchCompleted = () => {}
        this.onAllReady = () => {}

        // Install server state synchronously. Profile lookups only replace
        // display data; they must not overwrite newer player events.
        for (const p of resp.players) {
            this.players[p.user_id] = new User(p.user_id, { id: p.user_id, username: `#${p.user_id}` }, p.team, p.mods || [], p.style, p.status)
            if (!this.player_slots.includes(p.user_id)) this.player_slots.push(p.user_id)
        }
        for (const ref of resp.referees) {
            this.refs[ref.user_id] = new User(ref.user_id, { id: ref.user_id, username: `#${ref.user_id}` }, 'none', [], null, 'referee')
            this.GetUser(ref.user_id, false).then(() => {
                if (this.disposed) return
                this.updateUI()
            }).catch(error => { if (!this.disposed) addSystemMsg(error.message, 'warn') })
        }
        for (const p of resp.players) {
            this.GetUser(p.user_id, true).then(() => {
                if (this.disposed) return
                this.updateUI()
            }).catch(error => { if (!this.disposed) addSystemMsg(error.message, 'warn') })
        }
    }
    updateMode() {
        const currentItem = Object.values(this.playlistItems).find(x => x.order == 0)
        if (currentItem) this.mode = currentItem.ruleset_id ?? 0
        if (this.mode == null) this.mode = 0
        return this.mode
    }
    async GetUser(user_id, normal) {
        user_id = idFromUsername(user_id, this.players, this.refs) ?? user_id
        const key = String(user_id).toLowerCase()
        let data = this.userData.get(key)
        if (!data) {
            let pending = this.userRequests.get(key)
            if (!pending) {
                pending = window.api.api.GetUser(user_id).then(result => {
                    const user = requireSuccess(result, `Load user ${user_id}`)
                    if (!user?.id) throw new Error(`User ${user_id} was not found`)
                    this.userData.set(String(user.id), user)
                    this.userData.set(user.username.toLowerCase(), user)
                    return user
                }).finally(() => this.userRequests.delete(key))
                this.userRequests.set(key, pending)
            }
            data = await pending
        }
        for (const record of [this.players[data.id], this.refs[data.id]]) if (record) record.user = data
        const group = normal === true ? this.players : normal === false ? this.refs : null
        if (group && !group[data.id] && !this.disposed) group[data.id] = new User(data.id, data, 'none', [], null, normal ? 'idle' : 'referee')
        return group?.[data.id] ?? this.players[data.id] ?? this.refs[data.id] ?? new User(data.id, data, 'none', [], null, null)
    }

    // ── derived state ────────────────────────────────────────────────
    currentItem() { return Object.values(this.playlistItems).find(x => x.order == 0) ?? this.queue()[0] ?? null }
    queue() { return Object.values(this.playlistItems).filter(x => !x.was_played).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) }
    playerList() { return Object.values(this.players) }
    activePlayers() { return this.playerList().filter(p => p.status !== 'spectating') }
    allReady() { const a = this.activePlayers(); return a.length > 0 && a.every(p => p.status === 'ready') }
    playerByToken(token) { // "#123" or a username
        const s = String(token ?? '').trim()
        if (!s) return null
        if (s[0] === '#') return this.players[parseInt(s.slice(1), 10)] ?? null
        return this.playerList().find(p => p.user?.username?.toLowerCase() === s.toLowerCase()) ?? null
    }

    saveLocal() { saveRoomLocal(this.id, this.local) }

    updateUI() {
        if (this.disposed) return
        this.onChange(this)
    }
    dispose() {
        this.disposed = true
    }
    close() {
        this.dispose()
        this.onClose(this)
    }
}

export class Event {
    name;
    data;
    constructor(name, data) {
        this.name = name
        this.data = data
    }
}

export class EventQueue {
    constructor(room) {
        this.room = room
        this.arr = [] // array of Event
        this.processing = false
        this.active = true
        this.currentEvent = null
    }
    add(ev) {
        if (!this.active) return
        this.arr.push(ev)
        if (!this.processing) this.#runQueue()
    }

    dispose() {
        this.active = false
        this.arr.length = 0
    }

    #runQueue() {
        this.#queueLoop()
            .catch(err => console.error(`Failed to process ${this.currentEvent?.name}: ${err?.stack ?? err}`))
            .finally(() => {
                this.processing = false
                this.currentEvent = null
                if (this.active && this.arr.length > 0) this.#runQueue()
            })
    }

    async #queueLoop() {
        this.processing = true
        while (this.active && this.arr.length > 0) {
            const ev = this.arr.shift()
            this.currentEvent = ev
            const data = ev.data
            const room = this.room
            switch (ev.name) {
            case "UserJoined": {
                const user = await room.GetUser(data.user_id, true)
                room.players[data.user_id].status = "idle"
                room.players[data.user_id].team = "none"
                if (!room.max_participants && !room.player_slots.includes(data.user_id)) room.player_slots.push(data.user_id)
                addSystemMsg(`${user.user.username} joined the room`)
            } break;
            case "UserLeft": {
                const name = room.players[data.user_id]?.user?.username
                delete room.players[data.user_id]
                if (!room.max_participants) room.player_slots = room.player_slots.filter(x => x != data.user_id)
                if (name) addSystemMsg(`${name} left the room`)
            } break;
            case "UserKicked":
            case "UserBanned": {
                const uid = data.kicked_user_id ?? data.banned_user_id ?? data.user_id
                if (uid == window.me?.id) {
                    room.close()
                    this.dispose()
                    break
                }
                const name = room.players[uid]?.user?.username
                delete room.players[uid]
                if (!room.max_participants) room.player_slots = room.player_slots.filter(x => x != uid)
                if (name) addSystemMsg(`${name} was ${ev.name === 'UserBanned' ? 'banned' : 'kicked'}`, 'warn')
            } break;
            case "RefereeAdded": {
                const uid = data.user_id ?? data.target_user_id
                if (uid != null) { const u = await room.GetUser(uid, false); addSystemMsg(`${u.user.username} is now a referee`) }
            } break;
            case "RefereeRemoved": {
                const uid = data.user_id ?? data.target_user_id
                const name = room.refs[uid]?.user?.username
                delete room.refs[uid]
                if (name) addSystemMsg(`${name} is no longer a referee`)
            } break;
            case "RoomSettingsChanged": {
                room.name = data.name
                room.password = data.password
                room.type = data.type
                room.max_participants = data.max_participants
                if (data.max_participants == null) room.player_slots = room.player_slots.filter(x => x != null)
            } break;
            case "MatchStateChanged": {
                room.locked = data.state.locked;
                room.type = data.state.type
                if (data.state.slots) room.player_slots = data.state.slots
            } break;
            case "PlaylistItemAdded": {
                if (data.playlist_item.was_played) {
                    room.playedItems[data.playlist_item.id] = { ...room.playlistItems[data.playlist_item.id], ...data.playlist_item }
                    delete room.playlistItems[data.playlist_item.id]
                } else {
                    room.playlistItems[data.playlist_item.id] = data.playlist_item
                }
            } break;
            case "PlaylistItemChanged": {
                if (data.playlist_item.was_played) {
                    room.playedItems[data.playlist_item.id] = { ...room.playlistItems[data.playlist_item.id], ...data.playlist_item }
                    delete room.playlistItems[data.playlist_item.id]
                } else {
                    const existing = room.playlistItems[data.playlist_item.id] ?? {}
                    room.playlistItems[data.playlist_item.id] = {
                        ...existing,
                        ...data.playlist_item
                    }
                }
            } break;
            case "PlaylistItemRemoved": {
                delete room.playlistItems[data.playlist_item_id]
            } break;
            case "UserStatusChanged": {
                if (room.players[data.user_id]) room.players[data.user_id].status = data.status
                if (room.allReady() && (room.status === 'idle' || room.status === 'results') && !room.allReadyFlag) {
                    room.allReadyFlag = true
                    addSystemMsg("All players are ready", 'alert')
                    room.onAllReady()
                }
                if (!room.allReady()) room.allReadyFlag = false
            } break;
            case "UserModsChanged": {
                if (room.players[data.user_id]) room.players[data.user_id].mods = data.mods
            } break;
            case "UserStyleChanged": {
                const player = room.players[data.user_id]
                // flat here, nested on join
                if (player) player.style = { beatmap_id: data.beatmap_id, ruleset_id: data.ruleset_id }
            } break;
            case "UserTeamChanged": {
                if (room.players[data.user_id]) room.players[data.user_id].team = data.team
            } break;
            case "CountdownStarted": {
                if (data.type == null || data.type === 'match_start') {
                    room.countdown = { id: data.countdown_id, total: data.seconds, remaining: data.seconds }
                    room.status = 'countdown'
                }
            } break;
            case "CountdownStopped": {
                if (room.countdown && (data.countdown_id == null || data.countdown_id === room.countdown.id)) {
                    room.countdown = null
                    if (room.status === 'countdown') room.status = 'idle'
                    addSystemMsg('Match countdown cancelled')
                }
            } break;
            case "MatchStarted": {
                room.countdown = null
                room.status = "playing"
                room.allReadyFlag = false
                addSystemMsg('Match started', 'alert')
            } break;
            case "MatchAborted": {
                room.countdown = null
                room.status = "idle"
                addSystemMsg('Match aborted', 'warn')
            } break;
            case "MatchCompleted": {
                room.status = "results"
                room.onMatchCompleted(data.playlist_item_id)
            } break;
            case "RollCompleted": {
                let user = await room.GetUser(data.user_id)
                addSystemMsg(`${user.user.username} rolled ${data.result}/${data.max}`)
            } break;
            }
            room.updateMode()
            room.updateUI()
        }
    }
}
