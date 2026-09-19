// Macros: an ordered script, one step per line. Lines starting with ! or /
// run as commands, every other line is sent to the room chat.
import { $, h, icon, put, store, toast, confirmUI, initials, hueOf } from './ui/dom.js'
import { executeMacroSteps } from './requests.js'

const KEY = 'aplref.macros'

export const DEFAULT_MACROS = [
    { id: 'roll', label: 'ROLL', color: 'neutral', script: '!roll', confirm: false },
    { id: 'warm', label: 'WARMUP', color: 'neutral', script: '!mp aborttimer\nWarmup phase: {red} picks the first warmup, {blue} the second. One warmup each.\n!mp timer 120', confirm: false },
    { id: 'rp', label: 'RED PROTECT', color: 'red', script: '!mp aborttimer\n{red}, please protect a map.\n!mp timer 90', confirm: false },
    { id: 'bp', label: 'BLUE PROTECT', color: 'blue', script: '!mp aborttimer\n{blue}, please protect a map.\n!mp timer 90', confirm: false },
    { id: 'rb', label: 'RED BAN', color: 'red', script: '!mp aborttimer\n{red}, please ban a map.\n!mp timer 90', confirm: false },
    { id: 'bb', label: 'BLUE BAN', color: 'blue', script: '!mp aborttimer\n{blue}, please ban a map.\n!mp timer 90', confirm: false },
    { id: 'rk', label: 'RED PICK', color: 'red', script: '!mp aborttimer\n{red}, please pick a map.\n!mp timer 120', confirm: false },
    { id: 'bk', label: 'BLUE PICK', color: 'blue', script: '!mp aborttimer\n{blue}, please pick a map.\n!mp timer 120', confirm: false },
    { id: 'ready', label: 'READY CHECK', color: 'green', script: '!mp aborttimer\nNext map: {map} ({mods}). Please ready up.\n!mp timer 60', confirm: false },
    { id: 'start', label: 'START 10', color: 'green', script: '!mp aborttimer\n!mp start 10', confirm: false },
    { id: 'abort', label: 'ABORT', color: 'danger', script: '!mp abort', confirm: true },
]
export const MACRO_COLORS = ['neutral', 'red', 'blue', 'green', 'amber', 'danger']
export const PLACEHOLDER_KEYS = ['{red}', '{blue}', '{map}', '{next}', '{mods}']

export const macroSteps = m => String(m.script ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => ({ cmd: /^[!/]/.test(l), text: l }))
export const macroHasCmd = m => macroSteps(m).some(st => st.cmd)

export function loadMacros() { const saved = store(KEY); return Array.isArray(saved) ? saved : structuredClone(DEFAULT_MACROS) }
export function saveMacros(list) { store(KEY, list) }

// ctx: { macros, resolve(text), sendChat(text), runCommand(text), me: {username} }
export function createMacroUI(ctx) {
    const st = { sel: 0, running: false }
    const save = () => saveMacros(ctx.macros)

    async function run(m, i) {
        if (!ctx.active()) return toast('Join a room first')
        if (st.running) return toast('A macro is already running')
        const steps = macroSteps(m)
        if (!steps.length) return toast('This macro has no steps')
        st.running = true
        renderBar()
        try {
        if (m.confirm) {
            const body = steps.map(s => s.cmd ? 'Run:  ' + ctx.resolve(s.text) : 'Send: “' + ctx.resolve(s.text) + '”').join('\n')
            if (!(await confirmUI(ctx.resolve(m.label), body, { ok: 'Run macro', danger: m.color === 'danger' }))) return
        }
        const btn = $('#macro-bar').children[i]
        if (btn) { btn.classList.remove('flash'); void btn.offsetWidth; btn.classList.add('flash') }
        return await executeMacroSteps(steps, ctx)
        } catch (error) { toast('Macro stopped: ' + error.message, 5000); return { success: false, error: error.message } }
        finally { st.running = false; renderBar() }
    }

    function renderBar() {
        const bar = $('#macro-bar')
        put(bar, ...ctx.macros.map((m, i) => h('button', {
            type: 'button', class: `macro macro-${m.color}`,
            disabled: st.running,
            title: [i < 9 ? `Alt+${i + 1}` : null, ...macroSteps(m).map(s => s.cmd ? ctx.resolve(s.text) : '“' + ctx.resolve(s.text) + '”')].filter(Boolean).join('\n'),
            onclick: () => run(m, i),
        }, h('span', { class: 'dot' }), h('span', {}, ctx.resolve(m.label) || 'Untitled'), macroHasCmd(m) ? icon('zap', 'icon-sm opacity-70') : null, i < 9 ? h('kbd', {}, String(i + 1)) : null)))
        if (!ctx.macros.length) bar.append(h('span', { class: 'empty-note' }, 'No macros. Use Edit to add one.'))
    }

    function renderList() {
        put($('#mac-list'), ...ctx.macros.map((m, i) => h('button', { type: 'button', class: 'macrow' + (i === st.sel ? ' on' : ''), onclick: () => { st.sel = i; renderList(); renderForm() } },
            h('span', { class: `dot macro-${m.color}` }),
            h('span', { class: 'truncate flex-1 text-left' }, ctx.resolve(m.label) || 'Untitled'),
            macroHasCmd(m) ? icon('zap', 'icon-sm text-muted') : null,
            i < 9 ? h('kbd', {}, String(i + 1)) : null)))
    }
    function renderForm() {
        const m = ctx.macros[st.sel]
        $('#mac-form').hidden = !m; $('#mac-empty').hidden = !!m
        if (!m) return
        $('#mac-label').value = m.label; $('#mac-script').value = m.script; $('#mac-confirm').checked = !!m.confirm
        for (const b of $('#mac-colors').children) b.classList.toggle('on', b.dataset.color === m.color)
        $('#mac-up').disabled = st.sel === 0
        $('#mac-down').disabled = st.sel === ctx.macros.length - 1
        renderPreview()
    }
    function renderPreview() {
        const m = ctx.macros[st.sel]
        if (!m) return
        const me = ctx.me()
        const steps = macroSteps(m)
        put($('#mac-preview'), ...(steps.length ? steps.map(s => s.cmd
            ? h('div', { class: 'sys cmd' }, '→ ' + ctx.resolve(s.text))
            : h('div', { class: 'msg' }, h('div', { class: 'avatar avatar-sm', style: `--h:${hueOf(me.username)}` }, initials(me.username)), h('div', { class: 'min-w-0' }, h('div', { class: 'flex items-baseline gap-1' }, h('span', { class: 'who', 'data-team': 'ref' }, me.username), h('span', { class: 'chip chip-ref' }, 'ref')), h('div', { class: 'txt' }, ctx.resolve(s.text)))))
            : [h('div', { class: 'empty-note' }, 'Empty macro. Add at least one line.')]))
    }
    function changed() {
        const m = ctx.macros[st.sel]
        if (!m) return
        m.label = $('#mac-label').value; m.script = $('#mac-script').value; m.confirm = $('#mac-confirm').checked
        save(); renderList(); renderPreview(); renderBar()
    }
    function refreshAll() { save(); renderList(); renderForm(); renderBar() }
    function open() { st.sel = Math.min(st.sel, Math.max(0, ctx.macros.length - 1)); renderList(); renderForm(); $('#dlg-macros').showModal() }

    // one-time wiring of the editor dialog
    put($('#mac-colors'), ...MACRO_COLORS.map(c => h('button', { type: 'button', class: `swatch macro-${c}`, 'data-color': c, title: c, onclick: () => { const m = ctx.macros[st.sel]; if (!m) return; m.color = c; refreshAll() } })))
    $('#mac-ph').append(...PLACEHOLDER_KEYS.map(p => h('button', { type: 'button', class: 'phchip', title: `Inserts ${p}, resolved when the macro runs`, onclick: () => insertAt($('#mac-script'), p) }, p)))
    ;['#mac-label', '#mac-script'].forEach(s => $(s).addEventListener('input', changed))
    $('#mac-confirm').addEventListener('change', changed)
    $('#mac-new').addEventListener('click', () => { ctx.macros.push({ id: Math.random().toString(36).slice(2, 9), label: 'NEW MACRO', color: 'neutral', script: '', confirm: false }); st.sel = ctx.macros.length - 1; refreshAll(); $('#mac-label').select() })
    $('#mac-delete').addEventListener('click', async () => { const m = ctx.macros[st.sel]; if (!m) return; if (!(await confirmUI('Delete macro', `Delete “${ctx.resolve(m.label)}”?`, { ok: 'Delete' }))) return; ctx.macros.splice(st.sel, 1); st.sel = Math.max(0, st.sel - 1); refreshAll() })
    $('#mac-up').addEventListener('click', () => { const i = st.sel; if (i <= 0) return; [ctx.macros[i - 1], ctx.macros[i]] = [ctx.macros[i], ctx.macros[i - 1]]; st.sel = i - 1; refreshAll() })
    $('#mac-down').addEventListener('click', () => { const i = st.sel; if (i >= ctx.macros.length - 1) return; [ctx.macros[i + 1], ctx.macros[i]] = [ctx.macros[i], ctx.macros[i + 1]]; st.sel = i + 1; refreshAll() })
    $('#mac-reset').addEventListener('click', async () => { if (!(await confirmUI('Reset macros', 'Replace your macros with the default set?', { ok: 'Reset', danger: false }))) return; ctx.macros.splice(0, ctx.macros.length, ...structuredClone(DEFAULT_MACROS)); st.sel = 0; refreshAll() })
    $('#mac-close').addEventListener('click', () => $('#dlg-macros').close())
    $('#btn-macros').addEventListener('click', open)
    document.addEventListener('keydown', e => {
        if (!(e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key))) return
        if (document.querySelector('dialog[open]') || !ctx.active()) return
        const m = ctx.macros[+e.key - 1]
        if (m) { e.preventDefault(); run(m, +e.key - 1) }
    })

    return { renderBar, run, open }
}

function insertAt(ta, text) {
    const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e)
    ta.selectionStart = ta.selectionEnd = s + text.length
    ta.focus()
    ta.dispatchEvent(new Event('input', { bubbles: true }))
}
