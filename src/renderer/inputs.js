export function integerInput(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    const text = String(value ?? '').trim()
    const number = Number(text)
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${label} must be an integer between ${min} and ${max}`)
    return number
}

export function beatmapInput(value) {
    const text = String(value ?? '').trim()
    if (/^\d+$/.test(text)) return { id: integerInput(text, 'Beatmap ID', { min: 1 }) }
    let url
    try { url = new URL(text) } catch { throw new Error('Enter a beatmap ID or an osu! beatmap URL') }
    if (!['https:', 'http:'].includes(url.protocol) || !['osu.ppy.sh', 'dev.ppy.sh'].includes(url.hostname)) throw new Error('Use an osu! beatmap URL')
    const legacy = url.pathname.match(/^\/(?:b|beatmaps)\/(\d+)\/?$/)
    const difficulty = /^\/beatmapsets\/\d+\/?$/.test(url.pathname) && url.hash.match(/^#(osu|taiko|fruits|mania)\/(\d+)$/)
    if (legacy) return { id: integerInput(legacy[1], 'Beatmap ID', { min: 1 }) }
    if (difficulty) return { id: integerInput(difficulty[2], 'Beatmap ID', { min: 1 }), ruleset: ['osu', 'taiko', 'fruits', 'mania'].indexOf(difficulty[1]) }
    throw new Error('Choose a specific difficulty: a beatmapset link without #mode/id is not a beatmap')
}

// Spaces inside usernames in quotes or mod setting arrays are not separators.
export function commandTokens(value) {
    const tokens = []
    let token = '', quote = '', bracket = 0
    for (const c of String(value).trim()) {
        if (quote) {
            if (c === quote) { if (bracket) token += c; quote = '' } else token += c
        } else if ((c === '"' || c === "'") && (bracket || !token)) { quote = c; if (bracket) token += c }
        else if (c === '[') { bracket++; token += c }
        else if (c === ']') { bracket--; if (bracket < 0) throw new Error('Unbalanced mod settings'); token += c }
        else if (/\s/.test(c) && !bracket) { if (token) { tokens.push(token); token = '' } }
        else token += c
    }
    if (quote || bracket) throw new Error('Unclosed quote or mod settings')
    if (token) tokens.push(token)
    return tokens
}
