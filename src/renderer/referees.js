import { integerInput } from './inputs.js'
import { requireSuccess } from './requests.js'

export async function resolveUserTarget(token, room) {
    const text = String(token ?? '').trim().replace(/^@/, '')
    if (!text) throw new Error('Enter a username or user ID')
    const key = text.startsWith('#') || /^\d+$/.test(text)
        ? integerInput(text.replace(/^#/, ''), 'User ID', { min: 1, max: 2147483647 }) : text
    const user = await room.GetUser(key)
    const id = integerInput(user?.id, 'User ID', { min: 1, max: 2147483647 })
    return { id, username: user.user?.username ?? `#${id}` }
}

export function refereeError(error, remove = false) {
    const message = String(error?.message ?? error).replace(/^(?:Add|Remove) referee:\s*/i, '')
    if (/Error 18\b|not the host/i.test(message)) return `Only the room host can add or remove referees. Being a referee is not enough. ${message}`
    if (!remove && /unexpected error|error on the server|untracked entity/i.test(message)) {
        return `The server rejected AddReferee. Ask the recipient to open and sign in to APL Ref first (opening osu! alone is not enough), then retry as the room host. ${message}`
    }
    return message
}

export async function changeReferee(ctx, token, remove = false) {
    const room = ctx.getRoom()
    if (!room) return { success: false, error: 'Join a room first' }
    try {
        const target = await resolveUserTarget(token, room)
        if (target.id === ctx.me()?.id) throw new Error('You cannot add or remove yourself as a referee')
        if (ctx.getRoom() !== room) throw new Error('Room changed; retry in the intended room')
        const result = await ctx.osu[remove ? 'RemoveReferee' : 'AddReferee'](room.id, target.id)
        requireSuccess(result, remove ? 'Remove referee' : 'Add referee')
        const message = remove ? `${target.username} no longer has referee access.`
            : `${target.username} has referee access to #${room.id}. They must join this room in their referee client to use its controls.`
        if (ctx.getRoom() === room) ctx.system?.(message)
        return { ...result, message }
    } catch (error) { return { success: false, error: refereeError(error, remove) } }
}

export function refereeRoomIds(response) {
    const data = requireSuccess(response, 'List referee rooms')
    return [...new Set((data?.room_ids ?? []).filter(id => Number.isSafeInteger(id) && id > 0))]
}
