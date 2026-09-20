const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
async function load(file, globals = {}) {
    const context = vm.createContext({ console, URL, structuredClone, ...globals })
    const cache = new Map()
    async function link(name) {
        if (cache.has(name)) return cache.get(name)
        const mod = new vm.SourceTextModule(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), { context, identifier: name })
        cache.set(name, mod)
        await mod.link((s, p) => link(path.posix.normalize(path.posix.join(path.posix.dirname(p.identifier), s))))
        return mod
    }
    const mod = await link(file)
    await mod.evaluate()
    return mod.namespace
}
const plain = value => JSON.parse(JSON.stringify(value))
function fixture() {
    const calls = [], messages = []
    const item = { id: 7, beatmap_id: 123, freestyle: false, required_mods: [{ acronym: 'DT', settings: { speed_change: 1.2 } }], allowed_mods: [] }
    const room = { id: 42, name: 'Test', mode: 3, status: 'idle', type: 'team_versus', refs: {}, currentItem: () => item,
        GetUser: async key => ({ id: typeof key === 'number' ? key : 12, user: { username: 'Mumei' } }) }
    let active = room
    const mods = Array.from({ length: 4 }, () => ({ Mods: [{ Acronym: 'HD', Settings: [], IncompatibleMods: [] }] }))
    const ctx = { getRoom: () => active, me: () => ({ id: 901 }), modsReady: Promise.resolve(mods), system: s => messages.push(s),
        closeRoom: () => { active = null }, stopTimer: () => calls.push(['stopLocal']), startTimer: async seconds => { calls.push(['startLocal', seconds]); return { success: true } },
        osu: new Proxy({}, { get: (_, name) => async (...args) => { calls.push([name, ...args]); return { success: true, data: name === 'ListRooms' ? { room_ids: [42, 77] } : null } } }) }
    return { ctx, room, item, calls, messages }
}

test('every advertised command has an executable definition, including formerly missing commands', async () => {
    const { CMD_DEFS, runRefereeCommand, cmdRoot } = await load('src/renderer/commands.js')
    assert.equal(new Set(CMD_DEFS.map(d => d.n)).size, CMD_DEFS.length)
    for (const name of ['listrefs', 'help', 'stop', 'freestyle', 'settings', 'listrooms']) assert.ok(CMD_DEFS.some(d => d.n === name))
    for (const def of CMD_DEFS) {
        assert.equal(typeof def.run, 'function')
        const f = fixture()
        const args = (def.p || []).filter(p => !p.opt).map(p => p.v ?? p.o?.[0][0] ?? ({ beatmap: '123', mods: 'HD', name: 'Test room', user: 'Mumei' }[p.k]) ?? '1')
        const result = await runRefereeCommand([cmdRoot(def), ...args].join(' '), f.ctx)
        assert.equal(result.success, true, `${def.n}: ${result.error}`)
    }
})
test('Freestyle sends a partial update and does not overwrite map/mod settings', async () => {
    const { runRefereeCommand } = await load('src/renderer/commands.js')
    const f = fixture()
    assert.equal((await runRefereeCommand('!mp freestyle on', f.ctx)).success, true)
    assert.deepEqual(plain(f.calls), [['EditCurrentPlaylistItem', 42, { freestyle: true }]])
    assert.equal(f.item.required_mods[0].settings.speed_change, 1.2)
})
test('Freestyle is rejected during play and invalid values never reach the server', async () => {
    const { runRefereeCommand } = await load('src/renderer/commands.js')
    const f = fixture(); f.room.status = 'playing'
    assert.equal((await runRefereeCommand('!mp freestyle on', f.ctx)).success, false)
    f.room.status = 'idle'
    assert.equal((await runRefereeCommand('!mp freestyle maybe', f.ctx)).success, false)
    assert.equal(f.calls.length, 0)
})
test('server countdown cancellation and local timer cancellation stay separate', async () => {
    const { runRefereeCommand } = await load('src/renderer/commands.js')
    const f = fixture()
    await runRefereeCommand('!mp stop', f.ctx)
    assert.deepEqual(plain(f.calls), [['StopMatchCountdown', 42]])
    await runRefereeCommand('!mp aborttimer', f.ctx)
    assert.deepEqual(plain(f.calls[1]), ['stopLocal'])
})
test('roll aliases, map rulesets and empty input route correctly', async () => {
    const { runRefereeCommand } = await load('src/renderer/commands.js')
    const f = fixture()
    for (const cmd of ['!roll 42', '/roll 42', '!mp roll 42']) assert.equal((await runRefereeCommand(cmd, f.ctx)).success, true)
    assert.ok(f.calls.every(c => c[0] === 'Roll' && c[2].max === 42))
    await runRefereeCommand('!MP MAP 123', f.ctx)
    assert.equal(f.calls.at(-1)[2].ruleset_id, 3)
    const before = f.calls.length
    assert.equal((await runRefereeCommand('', f.ctx)).success, false)
    assert.equal(f.calls.length, before)
})
test('referee targets accept names, bare IDs and #IDs, but never self-grant', async () => {
    const { changeReferee } = await load('src/renderer/referees.js')
    const f = fixture()
    for (const input of ['Mumei', '12', '#12']) assert.equal((await changeReferee(f.ctx, input)).success, true)
    assert.ok(f.calls.every(c => c[0] === 'AddReferee' && c[1] === 42 && c[2] === 12))
    const before = f.calls.length
    assert.equal((await changeReferee(f.ctx, '#901')).success, false)
    assert.equal((await changeReferee(f.ctx, '#12oops')).success, false)
    assert.equal(f.calls.length, before)
})
test('host and offline-recipient errors remain failures with specific guidance', async () => {
    const { changeReferee } = await load('src/renderer/referees.js')
    const f = fixture()
    f.ctx.osu = { AddReferee: async () => ({ success: false, error: 'Error 18: You are not the host of the room.' }) }
    let result = await changeReferee(f.ctx, 'Mumei')
    assert.equal(result.success, false); assert.match(result.error, /Only the room host/)
    f.ctx.osu.AddReferee = async () => ({ success: false, error: "An unexpected error occurred invoking 'AddReferee' on the server." })
    result = await changeReferee(f.ctx, 'Mumei')
    assert.equal(result.success, false); assert.match(result.error, /open and sign in to APL Ref first/)
    assert.equal(f.messages.length, 0); assert.equal(Object.keys(f.room.refs).length, 0)
})
test('room changes during target lookup cannot grant referee access to a different room', async () => {
    const { changeReferee } = await load('src/renderer/referees.js')
    const f = fixture()
    f.room.GetUser = async () => { f.ctx.getRoom = () => ({ id: 99 }); return { id: 12 } }
    assert.equal((await changeReferee(f.ctx, '#12')).success, false)
    assert.equal(f.calls.length, 0)
})
test('ListRooms consumes the official room_ids response and rejects failed queries', async () => {
    const { refereeRoomIds } = await load('src/renderer/referees.js')
    assert.deepEqual(Array.from(refereeRoomIds({ success: true, data: { room_ids: [42, 42, 77, -1, 'bad'] } })), [42, 77])
    assert.throws(() => refereeRoomIds({ success: false, error: 'Not connected' }), /Not connected/)
})
test('queue close reclaims the desktop column and retains explicit choice across resizing', async () => {
    const listeners = new Map()
    const document = { addEventListener: (n, cb) => listeners.set(n, cb), querySelector: () => null }
    const { createQueuePanel } = await load('src/renderer/ui/queue.js', { document })
    const element = () => ({ hidden: false, dataset: {}, attrs: {}, listeners: {}, classList: { toggle() {} }, focus() {}, setAttribute(k, v) { this.attrs[k] = v }, addEventListener(n, cb) { this.listeners[n] = cb } })
    const root = element(), panel = element(), toggle = element(), close = element(), backdrop = element()
    const media = { matches: true, addEventListener(_, cb) { this.change = cb } }
    createQueuePanel(root, panel, toggle, close, backdrop, media)
    assert.equal(panel.hidden, false); assert.equal(root.dataset.queueOpen, 'true')
    close.listeners.click()
    assert.equal(panel.hidden, true); assert.equal(root.dataset.queueOpen, 'false'); assert.equal(toggle.attrs['aria-expanded'], 'false')
    media.matches = false; media.change()
    assert.equal(panel.hidden, true)
    toggle.listeners.click(); assert.equal(backdrop.hidden, false)
    listeners.get('keydown')({ key: 'Escape' }); assert.equal(panel.hidden, true)
})
