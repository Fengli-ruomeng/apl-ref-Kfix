// Referee-side settings that never go to osu!: team names and map awards
// per room, tracking/sound preferences globally.
import { store } from './ui/dom.js'

const PREFS_KEY = 'aplref.prefs'
const roomKey = id => `aplref.room.${id}`

export const DEFAULT_PREFS = {
    tracking: { enabled: false, auto: false, format: 'bestof', bestOf: 9, pointsToWin: 5, allowDraws: false },
    sounds: { allReady: false, matchEnd: false, timerEnd: false },
    secStart: 10,
    secTimer: 90,
}

export function loadPrefs() {
    const saved = store(PREFS_KEY) || {}
    return {
        ...DEFAULT_PREFS, ...saved,
        tracking: { ...DEFAULT_PREFS.tracking, ...(saved.tracking || {}) },
        sounds: { ...DEFAULT_PREFS.sounds, ...(saved.sounds || {}) },
    }
}
export function savePrefs(prefs) { store(PREFS_KEY, prefs) }

export function teamsFromName(name) {
    const m = /\((.+?)\)\s*vs\.?\s*\((.+?)\)/i.exec(name || '')
    return m ? { red: m[1].trim(), blue: m[2].trim() } : { red: 'Red', blue: 'Blue' }
}

export function loadRoomLocal(roomId, roomName) {
    const saved = store(roomKey(roomId)) || {}
    return { teams: saved.teams || teamsFromName(roomName), awards: saved.awards || {} }
}
export function saveRoomLocal(roomId, local) { store(roomKey(roomId), local) }
