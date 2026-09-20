import { $, h, put, toast, confirmUI } from './dom.js'
import { refereeRoomIds } from '../referees.js'
import { requireSuccess } from '../requests.js'

export function createRefereeRooms(ctx) {
    const rooms = new Set()
    const changes = new Map()
    let loading = false, joining = false, generation = 0
    function render() {
        const ids = [...rooms].filter(id => id !== ctx.getRoom()?.id)
        $('#referee-invitations').hidden = !ids.length
        put($('#referee-room-list'), ...ids.map(id => h('button', { type: 'button', class: 'btn btn-sm btn-soft', disabled: joining,
            onclick: () => join(id) }, `Join #${id}`)))
        $('#referee-refresh').disabled = loading || joining
        $('#find-referee-rooms').disabled = loading || joining
    }
    function invite(id) {
        if (!Number.isSafeInteger(id) || id <= 0) return
        generation++
        changes.set(id, { generation, present: true })
        rooms.add(id); render()
        if (ctx.getRoom()?.id !== id) toast(`Referee invitation received for room #${id}. Use Join to open it.`, 5000)
    }
    function setRooms(ids) { rooms.clear(); for (const id of ids) rooms.add(id); render() }
    function remove(id) { generation++; changes.set(id, { generation, present: false }); rooms.delete(id); render() }
    async function refresh(notifyEmpty = false) {
        if (loading) return
        loading = true; render()
        const before = generation
        try {
            const ids = refereeRoomIds(await ctx.osu.ListRooms())
            const next = new Set(ids)
            for (const [id, change] of changes) if (change.generation > before) {
                if (change.present) next.add(id)
                else next.delete(id)
            }
            setRooms([...next])
            if (notifyEmpty && ![...next].some(id => id !== ctx.getRoom()?.id)) toast('No other referee rooms are available')
            for (const [id, change] of changes) if (change.generation <= before) changes.delete(id)
        } catch (error) { toast(error.message) }
        finally { loading = false; render() }
    }
    async function join(id) {
        if (joining) return
        joining = true; render()
        try {
            const current = ctx.getRoom()
            if (current && current.id !== id && !(await confirmUI('Switch referee room', `Switch from #${current.id} to #${id}? The current local timer and chat view will be reset.`, { ok: 'Switch', danger: false }))) return
            const snapshot = requireSuccess(await ctx.osu.JoinRoom(id), 'Join referee room')
            ctx.install(snapshot)
        } catch (error) { toast(error.message, 5000) }
        finally { joining = false; render() }
    }
    $('#referee-refresh').addEventListener('click', () => refresh(true))
    $('#find-referee-rooms').addEventListener('click', () => refresh(true))
    return { render, invite, remove, setRooms, refresh }
}
