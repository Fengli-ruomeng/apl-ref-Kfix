// Match score tracking (local only). A result is one finished playlist item;
// its award (red / blue / draw / skip / player id / null = pending) lives in
// room.local.awards keyed by playlist item id.

export const targetPoints = tr => tr.format === 'bestof' ? Math.ceil(tr.bestOf / 2) : tr.pointsToWin
export const drawsAllowed = tr => tr.format === 'custom' && tr.allowDraws

export const awardOf = (room, res) => {
    const a = room.local.awards[res.id]
    return a === undefined ? null : a
}

export function tally(room) {
    const t = { red: 0, blue: 0, draw: 0 }, per = {}
    for (const res of room.results) {
        const a = awardOf(room, res)
        if (a === 'red' || a === 'blue' || a === 'draw') t[a]++
        else if (typeof a === 'number') per[a] = (per[a] || 0) + 1
    }
    return { t, per }
}

export function matchWinner(room, tr) {
    if (!tr.enabled || room.type !== 'team_versus') return null
    const { t } = tally(room), n = targetPoints(tr)
    if (t.red >= n && t.red > t.blue) return 'red'
    if (t.blue >= n && t.blue > t.red) return 'blue'
    return null
}

export function autoAward(room, tr, res) {
    if (room.type === 'team_versus') {
        if (res.totals.red === res.totals.blue) return drawsAllowed(tr) ? 'draw' : null
        return res.totals.red > res.totals.blue ? 'red' : 'blue'
    }
    const [a, b] = res.scores
    if (!a) return null
    if (b && a.score === b.score) return drawsAllowed(tr) ? 'draw' : null
    return a.uid
}

export function awardLabel(room, award) {
    if (award === 'red' || award === 'blue') return room.local.teams[award]
    if (award === 'draw') return 'Draw'
    if (award === 'skip') return 'Not counted'
    if (typeof award === 'number') return room.players[award]?.user?.username ?? room.results.flatMap(r => r.scores).find(s => s.uid === award)?.username ?? `#${award}`
    return 'Pending'
}
export const awardColor = award => award === 'red' || award === 'blue' ? `color: var(--team-${award})` : ''

// Builds a result from the osu! API scores payload for a playlist item.
export function buildResult(room, item, scoresPayload) {
    const tv = room.type === 'team_versus'
    const scores = (scoresPayload?.scores ?? []).map(s => {
        const uid = s.user_id ?? s.user?.id
        const p = room.players[uid]
        return {
            uid,
            username: s.user?.username ?? p?.user?.username ?? `#${uid}`,
            team: tv ? (p?.team ?? 'none') : 'none',
            score: s.total_score ?? 0,
            acc: (s.accuracy ?? 0) * 100,
            combo: s.max_combo ?? 0,
            passed: s.passed !== false,
        }
    }).sort((a, b) => b.score - a.score)
    const totals = { red: 0, blue: 0 }
    for (const s of scores) if (totals[s.team] != null) totals[s.team] += s.score
    const winner = tv ? (totals.red === totals.blue ? 'tie' : totals.red > totals.blue ? 'red' : 'blue') : (scores[0]?.uid ?? null)
    return { id: item?.id ?? Date.now(), item: item ? { ...item } : null, scores, totals, winner, at: Date.now() }
}
