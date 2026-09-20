// Render functions for a Room. Pure DOM output; all data comes from the Room
// instance plus a ctx object (prefs, beatmap cache, action callbacks).
import { $, $$, h, put, icon, renderList, countUp, fmtLen, fmtNum, fmtTime, initials, hueOf } from './dom.js'
import { targetPoints, drawsAllowed, awardOf, tally, matchWinner, awardLabel, awardColor } from '../tracking.js'

export const RULESETS = ['osu!', 'taiko', 'catch', 'mania']
const STATUS_LABEL = { idle: 'idle', ready: 'ready', playing: 'playing', finished_play: 'finished', spectating: 'spectating' }
const GROUP_LABEL = { red: 'Red', blue: 'Blue', none: 'No team', empty: 'Empty slots' }

// ── data helpers ───────────────────────────────────────────────────────
export function mapInfo(bm, beatmap_id) {
    const hue = (beatmap_id * 137) % 360
    if (!bm || bm.error) return { artist: '', title: `Beatmap ${beatmap_id}`, version: bm?.error ? 'not found' : 'loading…', mapper: '', stars: null, length: null, bpm: null, cs: null, ar: null, od: null, hp: null, cover: null, hue, loading: !bm }
    return {
        artist: bm.beatmapset?.artist ?? '', title: bm.beatmapset?.title ?? `Beatmap ${beatmap_id}`, version: bm.version ?? '', mapper: bm.beatmapset?.creator ?? '',
        stars: bm.difficulty_rating, length: bm.total_length, bpm: bm.bpm, cs: bm.cs, ar: bm.ar, od: bm.accuracy, hp: bm.drain,
        cover: bm.beatmapset?.covers?.list ?? bm.beatmapset?.covers?.card ?? null, hue,
    }
}
export const mapName = (room, ctx, it) => { if (!it) return '—'; const m = mapInfo(ctx.getBeatmap(it.beatmap_id), it.beatmap_id); return `${m.title} [${m.version}]` }
export function poolLabel(it) {
    if (it.freestyle) return 'FS'
    const req = (it.required_mods || []).map(m => m.acronym)
    if (req.length) return req.join('')
    if ((it.allowed_mods || []).length) return 'FM'
    return 'NM'
}
function settingsText(m) {
    if (!m.settings || !Object.keys(m.settings).length) return ''
    return Object.entries(m.settings).map(([k, v]) => k === 'speed_change' ? `${v}×` : `${k}=${v}`).join(' ')
}
export function modChip(m, cls = 'chip chip-mod') {
    const s = settingsText(m)
    return h('span', { class: cls, title: s ? `${m.acronym}: ${s}` : m.acronym }, m.acronym, s ? h('span', { class: 'opacity-75 normal-case tracking-normal' }, s) : null)
}
function coverStyle(m) { return m.cover ? `--h:${m.hue}; --img:url("${m.cover}")` : `--h:${m.hue}` }

// ── view switching / top bar ───────────────────────────────────────────
export function showView(inRoom) {
    $('#view-room').hidden = !inRoom
    $('#view-landing').hidden = inRoom
    $$('.room-only').forEach(el => el.hidden = !inRoom)
    $$('.not-room').forEach(el => el.hidden = inRoom)
}
export function renderTopbar(room, ctx) {
    if (room) {
        $('#tb-room-name').textContent = room.name
        $('#tb-id').textContent = room.id
        $('#tb-chat').textContent = room.chat_channel_id
        $('#tb-locked').hidden = !room.locked
        $('#chat-ch').textContent = room.chat_channel_id
    }
    $('#tb-conn').dataset.on = ctx.connected
    $('#tb-conn-text').textContent = ctx.connected ? 'Connected' : 'Reconnecting…'
    $('#conn-banner').hidden = ctx.connected || !room
}

// ── players ────────────────────────────────────────────────────────────
function playerItems(room) {
    const slots = room.player_slots.map((pid, i) => ({ pid: pid && room.players[pid] ? pid : null, index: i }))
    if (room.type !== 'team_versus') return slots.map(x => ({ key: x.pid ? 'p' + x.pid : 'e' + x.index, ...x }))
    const items = []
    for (const team of ['red', 'blue', 'none']) {
        const rows = slots.filter(x => x.pid && (room.players[x.pid].team || 'none') === team)
        if (!rows.length && team === 'none') continue
        items.push({ key: 'h-' + team, header: team, count: rows.length, spec: rows.filter(x => room.players[x.pid].status === 'spectating').length })
        items.push(...rows.map(x => ({ key: 'p' + x.pid, ...x })))
    }
    const empty = slots.filter(x => !x.pid)
    if (empty.length) { items.push({ key: 'h-empty', header: 'empty', count: empty.length }); items.push(...empty.map(x => ({ key: 'e' + x.index, ...x }))) }
    return items
}
export function renderPlayers(room, ctx) {
    renderList($('#player-list'), playerItems(room), it => it.key, it => createPlayerRow(it, ctx), (el, it) => updatePlayerRow(el, it, room, ctx))
    const filled = room.player_slots.filter(pid => pid && room.players[pid]).length
    $('#player-count').textContent = room.max_participants ? `${filled}/${room.max_participants}` : `${filled}`
    $('#btn-size').textContent = room.max_participants ? `${room.max_participants} slots` : 'no limit'
    const lock = $('#btn-lock')
    lock.replaceChildren(icon(room.locked ? 'lock' : 'unlock', 'icon-sm'))
    lock.title = room.locked ? 'Unlock teams and slots' : 'Lock teams and slots (players cannot switch)'
    lock.style.color = room.locked ? 'var(--warn)' : ''
}
function createPlayerRow(it, ctx) {
    if (it.header) return h('div', { class: 'pgroup', 'data-team': it.header }, h('span', { class: 'sq' }), h('span', {}, GROUP_LABEL[it.header]), h('span', { class: 'cnt font-mono' }), h('span', { class: 'spec font-mono normal-case tracking-normal' }))
    if (!it.pid) return h('div', { class: 'player empty' }, h('span', { class: 'slotno' }, it.index + 1), 'empty')
    const id = it.pid
    return h('div', { class: 'player' },
        h('button', { class: 'stripe', title: 'Swap team', onclick: () => ctx.actions.swapTeam(id) }),
        h('span', { class: 'slotno' }),
        h('div', { class: 'flex-1 min-w-0' },
            h('div', { class: 'flex items-center gap-1.5 min-w-0' }, h('span', { class: 'name truncate text-[13px] font-medium' }), h('span', { class: 'status-pill' })),
            h('div', { class: 'mods flex items-center gap-1 mt-0.5 min-h-[1.125rem] flex-wrap' })),
        h('div', { class: 'actions flex items-center gap-0.5' },
            h('button', { class: 'btn btn-icon btn-sm btn-ghost', title: 'Kick', onclick: () => ctx.actions.kick(id) }, icon('kick', 'icon-sm')),
            h('button', { class: 'btn btn-icon btn-sm btn-ghost', title: 'Ban', style: 'color: var(--danger)', onclick: () => ctx.actions.ban(id) }, icon('ban', 'icon-sm'))))
}
function updatePlayerRow(el, it, room, ctx) {
    if (it.header) {
        el.querySelector('.cnt').textContent = it.count
        el.querySelector('.spec').textContent = it.spec ? `· ${it.spec} spectating` : ''
        return
    }
    if (!it.pid) return
    const p = room.players[it.pid]
    const team = p.team || 'none'
    el.dataset.team = team; el.dataset.status = p.status || 'idle'
    el.querySelector('.slotno').textContent = it.index + 1
    el.querySelector('.name').textContent = p.user?.username ?? `#${it.pid}`
    const sp = el.querySelector('.status-pill')
    sp.dataset.s = p.status || 'idle'; sp.textContent = STATUS_LABEL[p.status] || p.status || 'idle'
    const now = room.currentItem()
    let style = null
    if (now?.freestyle) {
        const bid = p.style?.beatmap_id ?? now.beatmap_id
        const m = mapInfo(ctx.getBeatmap(bid), bid)
        style = h('span', { class: 'text-[11px] text-muted font-mono' }, m.stars != null ? `[${m.version}] ${m.stars.toFixed(2)}★` : `[${m.version}]`)
    }
    const mods = p.mods || []
    put(el.querySelector('.mods'), ...(mods.length ? mods.map(m => modChip(m)) : [h('span', { class: 'chip', style: 'opacity:.6' }, 'NM')]), style)
    const stripe = el.querySelector('.stripe')
    stripe.disabled = room.type !== 'team_versus'
    stripe.title = room.type === 'team_versus' ? `Move to ${team === 'red' ? 'blue' : 'red'} team` : ''
}
export function renderRefs(room, ctx) {
    const me = ctx.me()
    put($('#ref-list'), ...Object.values(room.refs).map(u => {
        const isMe = me && u.id === me.id
        const name = u.user?.username ?? `#${u.id}`
        return h('div', { class: 'refchip', title: name },
            h('span', { class: 'truncate' }, name),
            isMe ? h('span', { class: 'text-muted text-[11px]' }, 'you') : h('button', { class: 'rm', title: 'Remove referee', onclick: () => ctx.actions.removeRef(u.id) }, icon('x', 'icon-sm')))
    }))
}

// ── match section ──────────────────────────────────────────────────────
function setRing(svg, frac) {
    const C = 2 * Math.PI * 9
    const fg = svg.querySelector('.fg')
    fg.style.strokeDasharray = C
    fg.style.strokeDashoffset = C * (1 - Math.max(0, Math.min(1, frac)))
}
export function renderMatch(room, ctx) {
    const st = $('#state')
    const ring = st.querySelector('.ring'), dot = st.querySelector('.dot'), text = $('#state-text')
    st.dataset.s = room.status
    if (room.status === 'countdown' && room.countdown) {
        ring.hidden = false; dot.hidden = true
        setRing(ring, room.countdown.remaining / room.countdown.total)
        put(text, 'Starting in ', h('span', { class: 'num' }, fmtLen(room.countdown.remaining)))
    } else {
        ring.hidden = true; dot.hidden = false
        text.textContent = { idle: 'Idle', playing: 'Playing', results: 'Results', countdown: 'Starting…' }[room.status] || room.status
    }
    $('#timer-chip').hidden = !room.timer
    if (room.timer) $('#timer-text').textContent = fmtLen(room.timer.remaining)

    const busy = room.status === 'playing' || room.status === 'countdown'
    const hasMap = !!room.currentItem()
    const start = $('#btn-start')
    start.disabled = busy || !hasMap
    start.classList.toggle('glow', !busy && room.allReady())
    start.title = start.disabled ? (busy ? 'Match in progress' : 'Add a map to the queue first') : (room.allReady() ? 'All players ready' : 'Start match')
    $('#btn-abort').disabled = !busy
    $('#abort-label').textContent = room.status === 'countdown' ? 'Cancel' : 'Abort'
    const freestyle = $('#btn-freestyle')
    const enabled = !!room.currentItem()?.freestyle
    freestyle.setAttribute('aria-pressed', String(enabled))
    freestyle.disabled = busy || !hasMap || !!ctx.ui.freestylePending
    $('#freestyle-label').textContent = ctx.ui.freestylePending ? 'Freestyle: Saving…' : `Freestyle: ${enabled ? 'On' : 'Off'}`
    renderNowMap(room, ctx)
}
export function renderNowMap(room, ctx) {
    const now = room.currentItem()
    const box = $('#now-map')
    if (!now) {
        put(box, h('div', { class: 'flex items-center gap-3 border border-dashed border-line px-3 py-3 text-sm text-muted' }, 'Queue is empty. ', h('button', { class: 'btn btn-sm btn-soft', onclick: () => ctx.actions.openMapDlg(null) }, icon('plus', 'icon-sm'), 'Add a map')))
        return
    }
    const M = mapInfo(ctx.getBeatmap(now.beatmap_id), now.beatmap_id)
    const stat = (label, val, cls = '') => val == null ? null : h('span', { class: 'stat' }, label ? h('span', {}, label) : null, h('b', { class: cls }, val))
    const req = now.required_mods || [], allowed = now.allowed_mods || []
    put(box, h('div', { class: 'flex gap-3 items-stretch min-w-0' },
        h('div', { class: 'cover w-32 h-[4.75rem] shrink-0 relative overflow-hidden hidden sm:block' + (M.cover ? ' has-img' : ''), style: coverStyle(M) }, h('span', { class: 'chip chip-over absolute left-1.5 bottom-1.5' }, poolLabel(now))),
        h('div', { class: 'flex-1 min-w-0 flex flex-col justify-between gap-1' },
            h('div', { class: 'min-w-0' },
                h('div', { class: 'flex items-center gap-2 min-w-0' }, h('span', { class: 'panel-title' }, 'Current map'), h('span', { class: 'chip chip-ruleset' }, RULESETS[now.ruleset_id] || 'osu!')),
                h('h2', { class: 'font-semibold text-[15px] truncate leading-tight mt-0.5' }, M.artist ? `${M.artist} – ${M.title} ` : `${M.title} `, h('span', { class: 'text-muted font-medium' }, `[${M.version}]`)),
                h('div', { class: 'text-xs text-muted truncate' }, M.mapper ? `mapped by ${M.mapper}` : '')),
            h('div', { class: 'flex items-center gap-x-3 gap-y-1 flex-wrap font-mono text-[11.5px] text-muted' },
                stat('★', M.stars?.toFixed(2), 'text-amber-400'), stat('', M.length != null ? fmtLen(M.length) : null), stat('', M.bpm != null ? `${M.bpm} BPM` : null), stat('CS', M.cs), stat('AR', M.ar), stat('OD', M.od), stat('HP', M.hp)),
            h('div', { class: 'flex items-center gap-1 flex-wrap' },
                ...req.map(m => modChip(m)),
                allowed.length ? h('span', { class: 'text-[10px] text-muted ml-1' }, 'allowed:') : null,
                ...allowed.map(m => modChip(m, 'chip chip-allowed')),
                now.freestyle ? h('span', { class: 'chip chip-fs' }, 'freestyle') : null,
                !req.length && !allowed.length && !now.freestyle ? h('span', { class: 'text-[11px] text-muted' }, 'No mods') : null)),
        h('div', { class: 'flex flex-col items-end justify-between shrink-0 gap-1' },
            h('button', { class: 'btn btn-sm btn-ghost font-mono text-[11px] text-muted', title: 'Copy beatmap ID', onclick: () => ctx.actions.copy(String(now.beatmap_id), 'Beatmap ID copied') }, '#' + now.beatmap_id, icon('copy', 'icon-sm')),
            h('button', { class: 'btn btn-sm btn-soft', onclick: () => ctx.actions.openMapDlg(now) }, icon('pencil', 'icon-sm'), 'Edit'))))
}

// ── queue ──────────────────────────────────────────────────────────────
export function renderQueue(room, ctx) {
    const queue = room.queue()
    const items = queue.length ? queue : [{ id: '__empty' }]
    renderList($('#queue-list'), items, it => it.id, it => createQueueItem(it, ctx), (el, it) => updateQueueItem(el, it, queue, ctx))
    $('#queue-count').textContent = queue.length ? `${queue.length} left` : ''
}
function createQueueItem(it, ctx) {
    if (it.id === '__empty') return h('div', { class: 'qitem empty' }, 'Nothing queued')
    return h('div', { class: 'qitem' },
        h('div', { class: 'cover' }),
        h('div', { class: 'flex-1 min-w-0' },
            h('div', { class: 'flex items-center gap-1.5 min-w-0' }, h('span', { class: 'pos' }), h('span', { class: 'chip chip-pool slot' }), h('span', { class: 'title truncate text-[12.5px] font-medium' })),
            h('div', { class: 'sub text-[11px] text-muted truncate font-mono mt-0.5' }),
            h('div', { class: 'mods flex items-center gap-1 mt-1 flex-wrap' })),
        h('div', { class: 'actions flex flex-col gap-0.5 shrink-0 -mr-1' },
            h('button', { class: 'btn btn-icon btn-sm btn-ghost', title: 'Edit', onclick: e => ctx.actions.openMapDlg(e.currentTarget.closest('.qitem').playlistItem) }, icon('pencil', 'icon-sm')),
            h('button', { class: 'btn btn-icon btn-sm btn-ghost', title: 'Remove', style: 'color: var(--danger)', onclick: e => ctx.actions.removeMap(e.currentTarget.closest('.qitem').playlistItem) }, icon('trash', 'icon-sm'))))
}
function updateQueueItem(el, it, queue, ctx) {
    if (it.id === '__empty') return
    el.playlistItem = it
    const idx = queue.indexOf(it)
    const M = mapInfo(ctx.getBeatmap(it.beatmap_id), it.beatmap_id)
    el.classList.toggle('now', idx === 0)
    const cover = el.querySelector('.cover')
    cover.style.cssText = coverStyle(M); cover.classList.toggle('has-img', !!M.cover)
    put(el.querySelector('.pos'), idx === 0 ? h('span', { class: 'chip chip-now' }, 'now') : String(idx + 1))
    el.querySelector('.slot').textContent = poolLabel(it)
    el.querySelector('.title').textContent = `${M.title} [${M.version}]`
    el.querySelector('.sub').textContent = [M.artist, M.stars != null ? `★${M.stars.toFixed(2)}` : null, M.length != null ? fmtLen(M.length) : null, RULESETS[it.ruleset_id] || 'osu!'].filter(Boolean).join(' · ')
    put(el.querySelector('.mods'), ...(it.required_mods || []).map(m => modChip(m)), ...(it.allowed_mods || []).map(m => modChip(m, 'chip chip-allowed')), it.freestyle ? h('span', { class: 'chip chip-fs' }, 'freestyle') : null)
}

// ── scores ─────────────────────────────────────────────────────────────
function awardSelect(room, ctx, res) {
    const tv = room.type === 'team_versus', tr = ctx.prefs.tracking
    const opts = tv ? [['red', room.local.teams.red], ['blue', room.local.teams.blue]] : res.scores.map(sc => [String(sc.uid), sc.username])
    if (drawsAllowed(tr)) opts.push(['draw', 'Draw'])
    opts.push(['skip', 'Not counted'], ['', 'Pending'])
    const cur = awardOf(room, res) == null ? '' : String(awardOf(room, res))
    return h('select', { class: 'input h-6 w-auto text-[11px] py-0 shrink-0', title: 'Change award', onchange: e => { const v = e.target.value; ctx.actions.award(res, v === '' ? null : /^\d+$/.test(v) ? +v : v) } },
        ...opts.map(([v, l]) => h('option', { value: v, selected: v === cur }, l)))
}
function teamCol(room, team, latest, animate) {
    const rows = latest.scores.filter(s => s.team === team)
    const total = latest.totals[team] || 0
    const el = h('div', { class: 'team-col' + (latest.winner === team ? ' win' : ''), 'data-team': team },
        h('div', { class: 'flex items-baseline justify-between gap-2 mb-1.5 min-w-0' },
            h('div', { class: 'font-semibold text-sm truncate flex items-center gap-1.5', style: 'color: var(--tc)' }, latest.winner === team ? icon('crown', 'icon-sm') : null, room.local.teams[team]),
            h('div', { class: 'total' }, animate ? '0' : fmtNum(total))),
        ...(rows.length ? rows.map(s => h('div', { class: 'srow' }, h('span', { class: 'truncate flex items-baseline min-w-0' }, h('span', { class: 'truncate' }, s.username), h('span', { class: 'meta' }, `${s.acc.toFixed(2)}% · ${s.combo}x`)), h('span', { class: 'sc' }, animate ? '0' : fmtNum(s.score)))) : [h('div', { class: 'empty-note' }, 'No scores')]))
    if (animate) { countUp(el.querySelector('.total'), total); el.querySelectorAll('.sc').forEach((sc, i) => countUp(sc, rows[i].score)) }
    return el
}
export function renderScores(room, ctx, animate = false) {
    const latest = room.results[room.results.length - 1]
    const tv = room.type === 'team_versus'
    const tr = ctx.prefs.tracking
    const teams = room.local.teams
    const tallyEl = $('#tally')
    if (!tr.enabled) {
        put(tallyEl, room.results.length ? h('span', { class: 'text-[11px] text-muted font-mono' }, `${room.results.length} map${room.results.length === 1 ? '' : 's'} played`) : null)
    } else if (tv) {
        const { t } = tally(room), n = targetPoints(tr), won = matchWinner(room, tr)
        const pips = room.results.map(r => awardOf(room, r)).filter(a => a && a !== 'skip').map(a => h('span', { class: 'pip ' + a }))
        if (tr.format === 'bestof') for (let i = pips.length; i < tr.bestOf; i++) pips.push(h('span', { class: 'pip' }))
        put(tallyEl,
            h('span', { class: 'font-semibold text-[13px] truncate max-w-[9rem]', style: 'color: var(--team-red)' }, teams.red),
            h('span', { class: 'font-mono font-bold text-base tabular' }, `${t.red} : ${t.blue}`),
            h('span', { class: 'font-semibold text-[13px] truncate max-w-[9rem]', style: 'color: var(--team-blue)' }, teams.blue),
            t.draw ? h('span', { class: 'text-[11px] text-muted font-mono' }, `${t.draw} draw${t.draw === 1 ? '' : 's'}`) : null,
            h('span', { class: 'flex items-center gap-1 ml-1' }, pips),
            h('span', { class: 'text-[11px] text-muted font-mono' }, tr.format === 'bestof' ? `BO${tr.bestOf}` : `first to ${n}`),
            won ? h('span', { class: 'chip', style: `background: var(--team-${won}); color: #fff` }, 'match won') : null)
    } else {
        const { per } = tally(room)
        const entries = Object.entries(per).sort((a, b) => b[1] - a[1]).slice(0, 4)
        put(tallyEl, ...entries.map(([id, n]) => h('span', { class: 'chip chip-pool normal-case tracking-normal' }, `${awardLabel(room, +id)} ×${n}`)),
            h('span', { class: 'text-[11px] text-muted font-mono ml-1' }, `first to ${targetPoints(tr)}`))
    }

    const board = $('#score-board')
    if (!latest) {
        put(board, h('div', { class: 'empty-note' }, 'No results yet. Scores appear here after each map.'))
    } else if (tv) {
        const diff = Math.abs(latest.totals.red - latest.totals.blue)
        put(board,
            h('div', { class: 'grid grid-cols-2 gap-2' }, teamCol(room, 'red', latest, animate), teamCol(room, 'blue', latest, animate)),
            h('div', { class: 'diff-line' }, latest.item ? `${mapName(room, ctx, latest.item)} · ` : '', latest.winner === 'tie' ? 'Tie' : h('span', { class: 'font-semibold', style: `color: var(--team-${latest.winner})` }, `${teams[latest.winner]} +${fmtNum(diff)}`)))
    } else {
        put(board,
            h('div', { class: 'flex flex-col' }, ...latest.scores.map((sc, i) => h('div', { class: 'srow' + (i === 0 ? ' win' : '') },
                h('span', { class: 'flex items-center gap-2 min-w-0' }, h('span', { class: 'font-mono text-[11px] text-muted w-4' }, i + 1), i === 0 ? icon('crown', 'icon-sm text-amber-400') : null, h('span', { class: 'truncate' }, sc.username), h('span', { class: 'meta' }, `${sc.acc.toFixed(2)}% · ${sc.combo}x`)),
                h('span', { class: 'sc' }, animate ? '0' : fmtNum(sc.score))))),
            h('div', { class: 'diff-line' }, latest.item ? mapName(room, ctx, latest.item) : ''))
        if (animate) board.querySelectorAll('.sc').forEach((el, i) => countUp(el, latest.scores[i].score))
    }

    const awardEl = $('#score-award')
    awardEl.hidden = !(tr.enabled && latest)
    if (tr.enabled && latest) {
        const a = awardOf(room, latest)
        if (a == null) {
            put(awardEl, h('span', { class: 'text-xs text-muted mr-1' }, tr.auto ? 'Tied score. Award manually:' : 'Award this map:'),
                ...(tv
                    ? [h('button', { class: 'btn btn-sm btn-soft', style: 'color: var(--team-red)', onclick: () => ctx.actions.award(latest, 'red') }, teams.red),
                        h('button', { class: 'btn btn-sm btn-soft', style: 'color: var(--team-blue)', onclick: () => ctx.actions.award(latest, 'blue') }, teams.blue)]
                    : latest.scores.map(sc => h('button', { class: 'btn btn-sm btn-soft', onclick: () => ctx.actions.award(latest, sc.uid) }, sc.username))),
                drawsAllowed(tr) ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => ctx.actions.award(latest, 'draw') }, 'Draw') : null,
                h('button', { class: 'btn btn-sm btn-ghost', onclick: () => ctx.actions.award(latest, 'skip') }, 'Do not count'))
        } else {
            put(awardEl, h('span', { class: 'text-xs text-muted' }, 'Awarded to'), h('span', { class: 'text-xs font-semibold', style: awardColor(a) }, awardLabel(room, a)),
                tr.auto ? h('span', { class: 'text-[11px] text-muted' }, '(automatic)') : null,
                h('button', { class: 'btn btn-sm btn-ghost ml-1', onclick: () => ctx.actions.award(latest, null) }, 'Change'))
        }
    }

    const hist = $('#score-history')
    hist.hidden = !ctx.ui.historyOpen
    $('#btn-history').classList.toggle('on', ctx.ui.historyOpen)
    const past = room.results.slice(0, -1).reverse()
    put(hist, ...(past.length ? past.map((res, i) => {
        const n = room.results.length - 1 - i
        const w = tv ? (res.winner === 'tie' ? 'Tie' : `${teams[res.winner]} +${fmtNum(Math.abs(res.totals.red - res.totals.blue))}`) : `${res.scores[0]?.username ?? '—'} · ${fmtNum(res.scores[0]?.score ?? 0)}`
        return h('div', { class: 'hrow' },
            h('span', { class: 'font-mono text-[11px] text-muted w-10 shrink-0' }, `map ${n}`),
            h('span', { class: 'truncate flex-1' }, res.item ? mapName(room, ctx, res.item) : '—'),
            h('span', { class: 'font-mono text-[11px] shrink-0 text-muted' }, w),
            tr.enabled ? awardSelect(room, ctx, res) : null)
    }) : [h('div', { class: 'empty-note' }, 'No earlier maps yet.')]))
}

// ── events log ─────────────────────────────────────────────────────────
export function renderEvents(events, ctx) {
    renderList($('#event-log'), events.slice(0, 80), e => e.id,
        e => h('div', { class: 'evt' }, h('div', { class: 'flex justify-between gap-2' }, h('span', { class: 'font-semibold', style: 'color: var(--ink)' }, e.name), h('span', {}, fmtTime(new Date(e.ts)))), h('div', { class: 'break-all whitespace-pre-wrap' }, e.text)),
        () => {})
    $('#events-count').textContent = events.length
    $('#event-log').hidden = !ctx.ui.eventsOpen
    $('#events-chev').style.transform = ctx.ui.eventsOpen ? 'rotate(180deg)' : ''
}

// ── chat (DOM only, no store) ──────────────────────────────────────────
const messageIds = new Set()
export function clearChat() { $('#chat-log').replaceChildren(); messageIds.clear() }
export function appendChat({ messageId, uid, username, avatar_url, text, team, isRef, ts = Date.now() }) {
    if (messageId != null) {
        if (messageIds.has(String(messageId))) return
        messageIds.add(String(messageId))
        if (messageIds.size > 2000) messageIds.delete(messageIds.values().next().value)
    }
    const log = $('#chat-log')
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80
    const prev = log.lastElementChild
    const cont = prev && prev.dataset.uid == uid && (ts - +prev.dataset.ts) < 120000
    const avatar = avatar_url
        ? h('img', { class: 'avatar avatar-sm', src: avatar_url, alt: '' })
        : h('div', { class: 'avatar avatar-sm', style: `--h:${hueOf(username)}` }, initials(username))
    const el = h('div', { class: 'msg' + (cont ? ' cont' : ''), 'data-uid': uid, 'data-ts': ts },
        avatar,
        h('div', { class: 'min-w-0 flex-1' },
            cont ? null : h('div', { class: 'flex items-baseline gap-1 flex-wrap' },
                h('span', { class: 'who', 'data-team': isRef ? 'ref' : (team || '') }, username),
                isRef ? h('span', { class: 'chip chip-ref' }, 'ref') : null,
                h('span', { class: 'time' }, fmtTime(new Date(ts)))),
            h('div', { class: 'txt' }, text)))
    log.append(el)
    if (nearBottom) log.scrollTop = log.scrollHeight
}
export function appendSys(text, tone, action) {
    const log = $('#chat-log')
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80
    const el = h('div', { class: 'sys' + (tone ? ' ' + tone : '') }, text, action ? ' ' : null, action ? h('button', { onclick: action.run }, action.label) : null)
    log.append(el)
    if (nearBottom) log.scrollTop = log.scrollHeight
}
