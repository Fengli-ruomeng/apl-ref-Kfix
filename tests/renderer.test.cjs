const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')

async function loadModule(file, globals = {}, stubs = {}) {
    const context = vm.createContext({ console, setTimeout, clearTimeout, URL, structuredClone, ...globals })
    const modules = new Map()
    async function load(name) {
        if (modules.has(name)) return modules.get(name)
        const source = stubs[name] ?? fs.readFileSync(path.join(root, name), 'utf8')
        const mod = new vm.SourceTextModule(source, { context, identifier: name })
        modules.set(name, mod)
        await mod.link((specifier, importer) => load(path.posix.normalize(path.posix.join(path.posix.dirname(importer.identifier), specifier))))
        return mod
    }
    const mod = await load(file)
    await mod.evaluate()
    return mod.namespace
}

test('beatmap input accepts IDs and difficulty URLs, preserves the selected ruleset', async () => {
    const { beatmapInput } = await loadModule('src/renderer/inputs.js')
    assert.equal(beatmapInput('3398826').id, 3398826)
    assert.equal(beatmapInput('https://osu.ppy.sh/beatmaps/3398826').id, 3398826)
    const mania = beatmapInput('https://osu.ppy.sh/beatmapsets/123#mania/456')
    assert.equal(mania.id, 456); assert.equal(mania.ruleset, 3)
    assert.throws(() => beatmapInput('123garbage'), /Enter a beatmap/)
    assert.throws(() => beatmapInput('https://osu.ppy.sh/beatmapsets/123'), /specific difficulty/)
})

test('command arguments support repeated whitespace, quoted names and mod arrays', async () => {
    const { commandTokens } = await loadModule('src/renderer/inputs.js')
    assert.deepEqual(Array.from(commandTokens(' !mp   team "submissive cat" blue ')), ['!mp', 'team', 'submissive cat', 'blue'])
    assert.deepEqual(Array.from(commandTokens('!mp mods HD DA[4, 9, 8, 5]')), ['!mp', 'mods', 'HD', 'DA[4, 9, 8, 5]'])
    assert.deepEqual(Array.from(commandTokens("!mp name Player's room")), ['!mp', 'name', "Player's", 'room'])
    assert.throws(() => commandTokens('!mp mods DT[1.5'), /Unclosed/)
})

test('zero is a valid timer value; negative, missing and partial numbers are rejected', async () => {
    const { integerInput } = await loadModule('src/renderer/inputs.js')
    assert.equal(integerInput('0', 'Timer'), 0)
    for (const value of ['', '-1', '10abc', '1.5']) assert.throws(() => integerInput(value, 'Timer'))
})

test('slot limits accept 0 or 2..16 and reject the sizes the server refuses', async () => {
    const { slotLimit } = await loadModule('src/renderer/inputs.js')
    assert.equal(slotLimit('0'), 0)
    assert.equal(slotLimit('8'), 8)
    assert.equal(slotLimit('16'), 16)
    assert.equal(slotLimit('   ', { allowEmpty: true }), undefined)
    assert.throws(() => slotLimit(''), /no limit/)
    for (const value of ['1', '17', '8.5', 'nope']) assert.throws(() => slotLimit(value), /Slots/)
})

test('both IPC failures and legacy HTTP error payloads are rejected', async () => {
    const { requireSuccess } = await loadModule('src/renderer/requests.js')
    assert.throws(() => requireSuccess({ success: false, error: 'Forbidden' }, 'Send'), /Forbidden/)
    assert.throws(() => requireSuccess({ success: true, data: { error: 'Unauthorized' } }), /Unauthorized/)
    assert.equal(requireSuccess({ success: true, data: null }), null)
})

test('macro stops after a rejected command and never sends the subsequent message', async () => {
    const { executeMacroSteps } = await loadModule('src/renderer/requests.js')
    const sent = []
    await assert.rejects(executeMacroSteps([{ cmd: true, text: '!mp invalid' }, { cmd: false, text: 'must not send' }], {
        active: () => true, resolve: v => v, runCommand: async () => ({ success: false, error: 'Rejected' }), sendChat: async text => sent.push(text),
    }), /Rejected/)
    assert.equal(sent.length, 0)
})

test('macro substitutions are frozen and room changes cancel the next step', async () => {
    const { executeMacroSteps } = await loadModule('src/renderer/requests.js')
    let roomId = 1, name = 'red'
    const messages = []
    const ctx = { active: () => true, contextId: () => roomId, resolve: () => name, sendChat: async text => { messages.push(text); name = 'blue'; return { success: true } } }
    await executeMacroSteps([{ text: '{red}' }, { text: '{red}' }], ctx)
    assert.deepEqual(messages, ['red', 'red'])
    ctx.sendChat = async () => { roomId = 2; return { success: true } }
    await assert.rejects(executeMacroSteps([{ text: 'one' }, { text: 'two' }], ctx), /Room changed/)
})

const modelStubs = {
    'src/renderer/utils.js': 'export const idFromUsername = () => null; export const addSystemMsg = () => {};',
    'src/renderer/local.js': 'export const loadRoomLocal = () => ({teams:{red:"Red",blue:"Blue"},awards:{}}); export const saveRoomLocal = () => {};',
}
function snapshot() {
    return { room_id: 1, chat_channel_id: 10, name: 'Test', playlist: [], referees: [{user_id:42}], players:[{user_id:42,team:'red',mods:[],status:'idle'}],state:{slots:[42],type:'team_versus'} }
}
test('profile hydration preserves newer player state and supports player/referee overlap', async () => {
    let resolve, calls = 0
    const pending = new Promise(r => { resolve = r })
    const { Room } = await loadModule('src/renderer/models.js', {window:{api:{api:{GetUser:()=>{ calls++; return pending }}}}}, modelStubs)
    const room = new Room(snapshot())
    room.players[42].status = 'ready'
    resolve({success:true,data:{id:42,username:'Player'}})
    await room.GetUser(42, true)
    assert.equal(room.players[42].status,'ready')
    assert.equal(room.refs[42].user.username,'Player')
    assert.equal(calls,1)
})

function apiStub() {
    return { window: { api: { api: { GetUser: async id => ({ success: true, data: { id, username: 'Player' + id } }) } } } }
}
async function flush() {
    for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve))
}
test('a room snapshot uses max_participants and does not grow a sized slot list', async () => {
    const { Room } = await loadModule('src/renderer/models.js', apiStub(), modelStubs)
    const sized = snapshot()
    sized.max_participants = 4
    sized.state.slots = [42, null, null, null]
    const room = new Room(sized)
    assert.equal(room.max_participants, 4)
    assert.deepEqual(room.player_slots, [42, null, null, null])
    assert.equal(room.players[42].team, 'red')

    const unlimited = snapshot()
    unlimited.max_participants = 0
    unlimited.state.slots = null
    const open = new Room(unlimited)
    assert.equal(open.max_participants, null)
    assert.deepEqual(open.player_slots, [42])
})

test('joins append a slot only while the room is unlimited, and one bad event does not drop the next', async () => {
    const notes = []
    const { Room, Event, EventQueue } = await loadModule('src/renderer/models.js', {
        ...apiStub(), console: { ...console, error: (...args) => notes.push(args.map(String).join(' ')) },
    }, modelStubs)
    const sized = snapshot()
    sized.max_participants = 2
    sized.state.slots = [42, null]
    const room = new Room(sized)
    const queue = new EventQueue(room)
    queue.add(new Event('UserJoined', { user_id: 7 }))
    await flush()
    assert.deepEqual(room.player_slots, [42, null])
    assert.equal(room.players[7].status, 'idle')
    assert.equal(room.players[7].team, 'none')

    const openData = snapshot()
    openData.max_participants = null
    openData.state.slots = null
    const open = new Room(openData)
    await flush()
    const openQueue = new EventQueue(open)
    open.GetUser = async () => { throw new Error('profile lookup failed') }
    openQueue.add(new Event('UserJoined', { user_id: 9 }))
    openQueue.add(new Event('UserLeft', { user_id: 42 }))
    await flush()
    assert.equal(open.players[42], undefined)
    assert.deepEqual(open.player_slots, [])

    openQueue.add(new Event('RoomSettingsChanged', { name: 'Renamed', password: '', type: 'head_to_head', max_participants: 0 }))
    openQueue.add(new Event('MatchStateChanged', { state: { locked: true, type: 'team_versus', slots: [null, null, null] } }))
    await flush()
    assert.equal(open.name, 'Renamed')
    assert.equal(open.locked, true)
    assert.equal(open.max_participants, 3)
    assert.deepEqual(open.player_slots, [null, null, null])
    assert.match(notes.join('\n'), /UserJoined/)
})

test('looking up a chat sender does not grant them a referee or player role', async () => {
    const { Room } = await loadModule('src/renderer/models.js', {window:{api:{api:{GetUser:async id=>({success:true,data:{id,username:'Viewer'}})}}}}, modelStubs)
    const data=snapshot();data.players=[];data.referees=[]
    const room=new Room(data)
    await room.GetUser(77)
    assert.equal(room.refs[77],undefined)
    assert.equal(room.players[77],undefined)
})
