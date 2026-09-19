export function requireSuccess(result, label = 'Request') {
    if (!result || result.success !== true || result.data?.error) {
        const detail = result?.error || result?.data?.error || 'No successful response'
        throw new Error(`${label}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
    }
    return result.data
}

// Resolve the entire script once. A failed step must not trigger later actions.
export async function executeMacroSteps(steps, context) {
    const roomId = context.contextId?.()
    const resolved = steps.map(s => ({ ...s, text: context.resolve(s.text) }))
    for (const step of resolved) {
        if (!context.active() || (context.contextId && context.contextId() !== roomId)) throw new Error('Room changed; remaining macro steps cancelled')
        const result = await (step.cmd ? context.runCommand(step.text) : context.sendChat(step.text))
        requireSuccess(result, step.cmd ? step.text : 'Send message')
    }
    return { success: true }
}
