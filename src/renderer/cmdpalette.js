// !mp command palette (parameter forms) and input autocomplete.
// Both build a command string and hand it to ctx.runCommand, so the real
// !mp runner in index.js stays the single source of truth.
import { $, h, put, toast, confirmUI } from './ui/dom.js'

export const CMD_DEFS = [
    { g: 'Match', n: 'start', d: 'Start the match after a countdown', p: [{ k: 'seconds', l: 'Countdown (seconds, 0 = now)', t: 'number', v: 10 }] },
    { g: 'Match', n: 'abort', d: 'Abort the running match', danger: true },
    { g: 'Match', n: 'timer', d: 'Start a chat countdown', p: [{ k: 'seconds', l: 'Seconds', t: 'number', v: 90 }] },
    { g: 'Match', n: 'aborttimer', d: 'Stop the chat countdown' },
    { g: 'Players', n: 'invite', d: 'Invite a player', p: [{ k: 'user', l: 'Username or #id', t: 'user' }] },
    { g: 'Players', n: 'kick', d: 'Kick a player', p: [{ k: 'user', l: 'Player', t: 'player' }], danger: true },
    { g: 'Players', n: 'ban', d: 'Ban a player from the room', p: [{ k: 'user', l: 'Player', t: 'player' }], danger: true },
    { g: 'Players', n: 'team', d: 'Move a player to a team', p: [{ k: 'user', l: 'Player', t: 'player' }, { k: 'team', l: 'Team', t: 'select', o: [['red', 'Red'], ['blue', 'Blue']] }] },
    { g: 'Players', n: 'move', d: 'Move a player to a slot', p: [{ k: 'user', l: 'Player', t: 'player' }, { k: 'slot', l: 'Slot number', t: 'number', v: 1 }] },
    { g: 'Room', n: 'name', d: 'Rename the room', p: [{ k: 'name', l: 'Room name', t: 'text' }] },
    { g: 'Room', n: 'password', d: 'Set or clear the password', p: [{ k: 'password', l: 'Password (empty = none)', t: 'text', opt: true }] },
    { g: 'Room', n: 'size', d: 'Set the number of slots', p: [{ k: 'slots', l: 'Slots', t: 'number', v: 8 }] },
    { g: 'Room', n: 'set', d: 'Set team mode and size', p: [{ k: 'mode', l: 'Mode', t: 'select', o: [['0', 'Head-to-head'], ['1', 'Team versus']] }, { k: 'size', l: 'Slots (optional)', t: 'number', opt: true }] },
    { g: 'Room', n: 'lock', d: 'Lock teams and slots' },
    { g: 'Room', n: 'unlock', d: 'Unlock teams and slots' },
    { g: 'Map', n: 'map', d: 'Change the current map', p: [{ k: 'beatmap', l: 'Beatmap ID', t: 'number' }, { k: 'ruleset', l: 'Ruleset (optional)', t: 'select', o: [['', 'Keep current'], ['0', 'osu!'], ['1', 'taiko'], ['2', 'catch'], ['3', 'mania']], opt: true }] },
    { g: 'Map', n: 'mods', d: 'Set required mods (FM = freemod, NM = none)', p: [{ k: 'mods', l: 'Mods', t: 'text', ph: 'HD HR   |   FM   |   NM   |   DT[1.5]' }] },
    { g: 'Map', n: 'allowed_mods', d: 'Set the allowed (free) mods', p: [{ k: 'mods', l: 'Mods', t: 'text', ph: 'HD HR EZ FL' }] },
    { g: 'Referees', n: 'addref', d: 'Add a referee', p: [{ k: 'user', l: 'Username or #id', t: 'user' }] },
    { g: 'Referees', n: 'removeref', d: 'Remove a referee', p: [{ k: 'user', l: 'Username or #id', t: 'user' }] },
    { g: 'Other', n: 'roll', root: '!roll', d: 'Roll a random number', p: [{ k: 'max', l: 'Maximum', t: 'number', v: 100 }] },
    { g: 'Other', n: 'close', d: 'Close the room', danger: true },
]
export const cmdRoot = d => d.root || `!mp ${d.n}`

// ctx: { players() -> [{id, username}], runCommand(text) }
export function createCommandUI(ctx) {
    const st = { sel: 0, vals: {}, acIdx: -1, acItems: [] }
    const input = $('#chat-input')
    const playerToken = p => /\s/.test(p.username) ? '#' + p.id : p.username

    function buildCmd(def, vals) {
        const parts = [cmdRoot(def)]
        for (const prm of def.p || []) { const v = String(vals[prm.k] ?? '').trim(); if (v !== '') parts.push(v) }
        return parts.join(' ')
    }

    // ── palette ──
    function openPanel(open = true) {
        $('#cmd-panel').hidden = !open
        $('#btn-cmds').classList.toggle('on', open)
        if (open) { hideAc(); renderPanelList(); renderPanelDetail() }
    }
    function renderPanelList() {
        const nodes = []
        let g = null
        CMD_DEFS.forEach((d, i) => {
            if (d.g !== g) { g = d.g; nodes.push(h('div', { class: 'g' }, g)) }
            nodes.push(h('button', { type: 'button', class: i === st.sel ? 'on' : '', onclick: () => { st.sel = i; st.vals = {}; renderPanelList(); renderPanelDetail() } }, d.n))
        })
        put($('#cmd-list'), ...nodes)
    }
    function renderPanelDetail() {
        const def = CMD_DEFS[st.sel]
        const vals = st.vals
        for (const prm of def.p || []) if (vals[prm.k] === undefined && prm.v !== undefined) vals[prm.k] = prm.v
        const preview = h('div', { class: 'sys cmd' })
        const refresh = () => preview.textContent = '→ ' + buildCmd(def, vals)
        const field = prm => {
            let ctl
            if (prm.t === 'select') {
                if (vals[prm.k] === undefined) vals[prm.k] = prm.o[0][0]
                ctl = h('select', { class: 'input', onchange: e => { vals[prm.k] = e.target.value; refresh() } }, ...prm.o.map(([v, l]) => h('option', { value: v, selected: String(vals[prm.k]) === v }, l)))
            } else if (prm.t === 'player') {
                const players = ctx.players()
                ctl = h('select', { class: 'input', onchange: e => { vals[prm.k] = e.target.value; refresh() } }, h('option', { value: '' }, players.length ? 'Choose a player' : 'No players in the room'), ...players.map(p => h('option', { value: playerToken(p), selected: vals[prm.k] === playerToken(p) }, p.username)))
            } else {
                ctl = h('input', { class: 'input' + (prm.t === 'number' ? ' font-mono' : ''), type: prm.t === 'number' ? 'number' : 'text', placeholder: prm.ph || '', value: vals[prm.k] ?? '', oninput: e => { vals[prm.k] = e.target.value; refresh() } })
            }
            return h('label', { class: 'block' }, h('span', { class: 'label' }, prm.l), ctl)
        }
        const run = async () => {
            const cmd = buildCmd(def, vals)
            const missing = (def.p || []).find(prm => !prm.opt && String(vals[prm.k] ?? '').trim() === '')
            if (missing) return toast(`${missing.l} is required`)
            if (def.danger && !(await confirmUI(`Run ${cmdRoot(def)}`, `${def.d}.\n${cmd}`, { ok: 'Run' }))) return
            openPanel(false)
            try { await ctx.runCommand(cmd) } catch (error) { toast(error.message, 5000) }
        }
        refresh()
        put($('#cmd-detail'),
            h('div', {}, h('div', { class: 'font-mono font-semibold text-sm' }, cmdRoot(def), ...(def.p || []).map(prm => h('span', { class: 'text-muted font-normal' }, ` <${prm.k}${prm.opt ? '?' : ''}>`))), h('div', { class: 'text-xs text-muted mt-0.5' }, def.d)),
            ...(def.p || []).map(field),
            preview,
            h('div', { class: 'flex justify-end gap-2 mt-auto' },
                h('button', { class: 'btn btn-sm btn-soft', onclick: () => { input.value = buildCmd(def, vals); openPanel(false); input.focus(); acUpdate() } }, 'Insert into input'),
                h('button', { class: 'btn btn-sm ' + (def.danger ? 'btn-danger' : 'btn-primary'), onclick: run }, 'Run')))
    }

    // ── autocomplete ──
    function suggest(text) {
        if (!/^[!/]/.test(text)) return null
        const toks = text.trimStart().split(/\s+/)
        const typing = toks[toks.length - 1].toLowerCase()
        const base = text.replace(/\S*$/, '')
        const row = (label, hint, insert) => ({ label, hint, insert })
        if (toks.length === 1) return { items: ['!mp', '!roll'].filter(r => r.startsWith(typing)).map(r => row(r, r === '!mp' ? 'Referee commands' : 'Roll a random number', r + ' ')) }
        let def, idx
        if (toks[0].toLowerCase() === '!mp') {
            if (toks.length === 2) return { items: CMD_DEFS.filter(d => !d.root && d.n.startsWith(typing)).map(d => row(d.n, d.d, `!mp ${d.n} `)) }
            def = CMD_DEFS.find(d => !d.root && d.n === toks[1].toLowerCase()); idx = toks.length - 3
        } else { def = CMD_DEFS.find(d => d.root === toks[0].toLowerCase()); idx = toks.length - 2 }
        if (!def) return null
        const prm = def.p?.[idx]
        let items = []
        if (prm?.t === 'player') items = ctx.players().filter(p => p.username.toLowerCase().startsWith(typing)).map(p => row(p.username, '#' + p.id, base + playerToken(p) + ' '))
        if (prm?.t === 'select') items = prm.o.filter(([v]) => v !== '' && v.startsWith(typing)).map(([v, l]) => row(v, l, base + v + ' '))
        return { def, idx, items }
    }
    function hideAc() { $('#ac').hidden = true; st.acIdx = -1; st.acItems = [] }
    function acUpdate() {
        const sug = suggest(input.value)
        if (!sug || (!sug.items.length && !sug.def)) return hideAc()
        st.acItems = sug.items.slice(0, 8)
        if (st.acIdx >= st.acItems.length) st.acIdx = -1
        const usage = sug.def ? h('div', { class: 'usage' }, h('span', {}, h('b', {}, cmdRoot(sug.def)), ...(sug.def.p || []).map((prm, i) => h('span', { class: i === sug.idx ? 'cur' : '' }, ` <${prm.k}${prm.opt ? '?' : ''}>`))), h('span', {}, sug.def.p?.[sug.idx] ? sug.def.p[sug.idx].l : sug.def.d)) : null
        put($('#ac'), usage,
            ...st.acItems.map((it, i) => h('div', { class: 'item' + (i === st.acIdx ? ' on' : ''), onmousedown: e => { e.preventDefault(); acAccept(i) } }, h('span', { class: 'n' }, it.label), h('span', { class: 'd' }, it.hint))),
            st.acItems.length ? h('div', { class: 'foot' }, 'Tab or ↓ to select · Enter to send') : null)
        $('#ac').hidden = false
    }
    function acAccept(i) {
        const it = st.acItems[i ?? (st.acIdx >= 0 ? st.acIdx : 0)]
        if (!it) return false
        input.value = it.insert; input.focus()
        st.acIdx = -1; acUpdate()
        return true
    }
    // returns true when the key was consumed by the suggestion list
    function acKey(e) {
        if ($('#ac').hidden) return false
        if (e.key === 'ArrowDown') { e.preventDefault(); if (st.acItems.length) { st.acIdx = (st.acIdx + 1) % st.acItems.length; acUpdate() } return true }
        if (e.key === 'ArrowUp') { e.preventDefault(); if (st.acItems.length) { st.acIdx = (st.acIdx - 1 + st.acItems.length) % st.acItems.length; acUpdate() } return true }
        if (e.key === 'Tab') { if (st.acItems.length) { e.preventDefault(); acAccept() } return true }
        if (e.key === 'Enter' && st.acIdx >= 0) { e.preventDefault(); acAccept(); return true }
        if (e.key === 'Escape') { hideAc(); return true }
        return false
    }

    input.addEventListener('input', acUpdate)
    input.addEventListener('focus', acUpdate)
    input.addEventListener('blur', () => setTimeout(hideAc, 120))
    $('#btn-cmds').addEventListener('click', e => { e.stopPropagation(); openPanel($('#cmd-panel').hidden) })
    $('#cmd-panel').addEventListener('click', e => e.stopPropagation())
    document.addEventListener('click', () => openPanel(false))

    return { openPanel, acKey, hideAc }
}
