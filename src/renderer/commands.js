// The palette, autocomplete, help output and executor share this registry.
import { buildModChange } from './mods.js'
import { beatmapInput, commandTokens, integerInput } from './inputs.js'
import { resolveUserTarget, changeReferee, refereeRoomIds } from './referees.js'

const p = (k, l, t = 'text', extra = {}) => ({ k, l, t, ...extra })
const user = p('user', 'Username, user ID or #id', 'user')
const player = p('user', 'Player', 'player')
const success = () => ({ success: true })
const target = async (room, args) => (await resolveUserTarget(args.join(' '), room)).id
const definition = (g, n, d, params, run, extra = {}) => ({ g, n, d, p: params, run, ...extra })

export const CMD_DEFS = [
    definition('Match', 'start', 'Start the match after a countdown', [p('seconds', 'Countdown (seconds, 0 = now)', 'number', { v: 10 })],
        (c, r, a) => c.osu.StartMatch(r.id, { countdown: integerInput(a[0] ?? 0, 'Countdown') })),
    definition('Match', 'stop', 'Cancel the server start countdown; leave the chat timer running', [],
        (c, r) => c.osu.StopMatchCountdown(r.id)),
    definition('Match', 'abort', 'Abort the running match', [], (c, r) => c.osu.AbortMatch(r.id), { danger: true }),
    definition('Match', 'timer', 'Start a local chat countdown; this does not start the match', [p('seconds', 'Seconds', 'number', { v: 90 })],
        (c, r, a) => c.startTimer(integerInput(a[0] ?? 30, 'Timer seconds'))),
    definition('Match', 'aborttimer', 'Stop only the local chat countdown (use stop for the match countdown)', [],
        c => { c.stopTimer(); return success() }),
    definition('Players', 'invite', 'Invite a player', [user], async (c, r, a) => {
        const user = await resolveUserTarget(a.join(' '), r)
        const result = await c.osu.InvitePlayer(r.id, user.id)
        if (result.success && c.getRoom() === r) c.system(`Invitation sent to ${user.username}.`)
        return result
    }),
    definition('Players', 'kick', 'Kick a player', [player], async (c, r, a) => c.osu.KickPlayer(r.id, await target(r, a)), { danger: true }),
    definition('Players', 'ban', 'Ban a player from the room', [player], async (c, r, a) => c.osu.BanUser(r.id, await target(r, a)), { danger: true }),
    definition('Players', 'team', 'Move a player to a team', [player, p('team', 'Team', 'select', { o: [['red', 'Red'], ['blue', 'Blue']] })], async (c, r, a) => {
        const team = a.at(-1)?.toLowerCase()
        if (!['red', 'blue'].includes(team)) throw new Error('Choose red or blue')
        return c.osu.MoveUser(r.id, { user_id: await target(r, a.slice(0, -1)), team })
    }),
    definition('Players', 'move', 'Move a player to a slot', [player, p('slot', 'Slot number', 'number', { v: 1 })], async (c, r, a) =>
        c.osu.MoveUser(r.id, { user_id: await target(r, a.slice(0, -1)), slot: integerInput(a.at(-1), 'Slot', { min: 1, max: 16 }) - 1 })),
    definition('Room', 'name', 'Rename the room', [p('name', 'Room name')], (c, r, a) => {
        if (!a.length) throw new Error('Enter a room name')
        return c.osu.ChangeRoomSettings(r.id, { name: a.join(' ') })
    }),
    definition('Room', 'password', 'Set or clear the password', [p('password', 'Password (empty = none)', 'text', { opt: true })],
        (c, r, a) => c.osu.ChangeRoomSettings(r.id, { password: a.join(' ') })),
    definition('Room', 'size', 'Set the number of slots', [p('slots', 'Slots (0 = no limit)', 'number', { v: 8 })],
        (c, r, a) => c.osu.ChangeRoomSettings(r.id, { max_participants: integerInput(a[0], 'Slots', { max: 16 }) })),
    definition('Room', 'set', 'Set team mode and size; this client has no score-mode argument', [p('mode', 'Mode', 'select', { o: [['0', 'Head-to-head'], ['1', 'Team versus']] }), p('size', 'Slots (optional)', 'number', { opt: true })], (c, r, a) => {
        if (a.length > 2) throw new Error('Usage: !mp set <0|1> [slots]. Score mode is not supported by this client.')
        const mode = integerInput(a[0], 'Mode', { max: 1 })
        const settings = { type: mode ? 'team_versus' : 'head_to_head' }
        if (a[1] != null) settings.max_participants = integerInput(a[1], 'Slots', { max: 16 })
        return c.osu.ChangeRoomSettings(r.id, settings)
    }),
    definition('Room', 'lock', 'Lock teams and slots', [], (c, r) => c.osu.SetLockState(r.id, { locked: true })),
    definition('Room', 'unlock', 'Unlock teams and slots', [], (c, r) => c.osu.SetLockState(r.id, { locked: false })),
    definition('Room', 'settings', 'Show the current room and map settings locally', [], (c, r) => {
        const m = r.currentItem()
        c.system(`#${r.id} ${r.name}\nMode: ${r.type}; slots: ${r.max_participants || 'unlimited'}; locked: ${r.locked}\nMap: ${m?.beatmap_id ?? 'none'}; Freestyle: ${m?.freestyle ? 'on' : 'off'}\nRequired mods: ${(m?.required_mods ?? []).map(x => x.acronym).join(' ') || 'NM'}\nAllowed mods: ${(m?.allowed_mods ?? []).map(x => x.acronym).join(' ') || 'none'}`)
        return success()
    }),
    definition('Map', 'map', 'Change the current map', [p('beatmap', 'Beatmap ID or URL'), p('ruleset', 'Ruleset (optional)', 'select', { o: [['', 'Keep current'], ['0', 'osu!'], ['1', 'taiko'], ['2', 'catch'], ['3', 'mania']], opt: true })], (c, r, a) => {
        const map = beatmapInput(a[0])
        return c.osu.EditCurrentPlaylistItem(r.id, { beatmap_id: map.id, ruleset_id: a[1] == null ? (map.ruleset ?? r.mode) : integerInput(a[1], 'Ruleset', { max: 3 }) })
    }),
    definition('Map', 'freestyle', 'Let players choose their own difficulty; independent of Freemod', [p('enabled', 'Freestyle', 'select', { o: [['on', 'On'], ['off', 'Off']] })], (c, r, a) => {
        if (!r.currentItem()) throw new Error('There is no current map')
        if (['playing', 'countdown'].includes(r.status)) throw new Error('Wait for the match to end or cancel the start countdown before changing Freestyle')
        const value = a[0]?.toLowerCase()
        if (a.length !== 1 || !['on', 'off', 'true', 'false', '1', '0'].includes(value)) throw new Error('Usage: !mp freestyle on|off')
        return c.osu.EditCurrentPlaylistItem(r.id, { freestyle: ['on', 'true', '1'].includes(value) })
    }),
    definition('Map', 'mods', 'Set required mods (FM = freemod, NM = none)', [p('mods', 'Mods', 'text', { ph: 'HD HR   |   FM   |   NM   |   DT[1.5]' })], async (c, r, a) =>
        c.osu.EditCurrentPlaylistItem(r.id, buildModChange(a, r.mode, await c.modsReady))),
    definition('Map', 'allowed_mods', 'Set allowed mods; NM clears them', [p('mods', 'Mods', 'text', { ph: 'HD HR EZ FL' })], async (c, r, a) => {
        const parsed = buildModChange(a, r.mode, await c.modsReady)
        return c.osu.EditCurrentPlaylistItem(r.id, { allowed_mods: [...parsed.required_mods, ...parsed.allowed_mods] })
    }),
    definition('Referees', 'addref', 'Room host only. Recipient should sign in to APL Ref first, then join this room after being added.', [user],
        (c, r, a) => changeReferee(c, a.join(' '))),
    definition('Referees', 'removeref', 'Revoke referee access (room host only)', [user], (c, r, a) => changeReferee(c, a.join(' '), true), { danger: true }),
    definition('Referees', 'listrefs', 'List referees known to this client', [], (c, r) => {
        c.system(Object.values(r.refs).map(x => `${x.user.username} (#${x.id})`).join('\n') || 'No referees')
        return success()
    }),
    definition('Referees', 'listrooms', 'List rooms you have referee access to', [], async c => {
        const ids = refereeRoomIds(await c.osu.ListRooms())
        c.onRooms?.(ids)
        c.system(ids.length ? `Referee rooms: ${ids.map(id => '#' + id).join(', ')}` : 'No referee rooms available')
        return success()
    }),
    definition('Other', 'roll', 'Roll a random number', [p('max', 'Maximum', 'number', { v: 100 })], (c, r, a) =>
        c.osu.Roll(r.id, { max: integerInput(a[0] ?? 100, 'Roll maximum', { min: 1 }) }), { root: '!roll', aliases: ['/roll'], mpAlias: true }),
    definition('Other', 'help', 'List every command supported by this client', [], c => {
        c.system(CMD_DEFS.map(d => `${cmdRoot(d)} — ${d.d}`).join('\n'))
        return success()
    }),
    definition('Other', 'close', 'Close the room', [], async (c, r) => {
        const result = await c.osu.CloseRoom(r.id)
        if (result.success && c.getRoom() === r) c.closeRoom()
        return result
    }, { danger: true }),
]

export const cmdRoot = d => d.root || `!mp ${d.n}`
export async function runRefereeCommand(message, context) {
    try {
        const room = context.getRoom()
        if (!room) throw new Error('Join a room first')
        const args = commandTokens(message)
        const root = args.shift()?.toLowerCase()
        if (!root) throw new Error('Enter a command')
        const name = root === '!mp' ? args.shift()?.toLowerCase() : null
        const def = CMD_DEFS.find(d => root === '!mp' ? d.n === name && (!d.root || d.mpAlias) : d.root === root || d.aliases?.includes(root))
        if (!def) throw new Error('Unknown command. Use !mp help to see the commands supported by this client.')
        return await def.run(context, room, args)
    } catch (error) { return { success: false, error: error.message } }
}
