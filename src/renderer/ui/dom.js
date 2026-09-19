// Small DOM toolkit shared by the renderer: element builder, keyed list
// rendering (so CSS transitions survive re-renders), dialogs, toasts, icons.

export const $ = (s, r = document) => r.querySelector(s)
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s))

const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
    sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
    more: '<circle cx="12" cy="5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="19" r="1.3" fill="currentColor"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    kick: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
    pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    play: '<path d="M6 4v16l14-8z" fill="currentColor"/>',
    stop: '<rect width="12" height="12" x="6" y="6" rx="2" fill="currentColor"/>',
    timer: '<path d="M10 2h4"/><path d="m12 14 3-3"/><circle cx="12" cy="14" r="8"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
    userplus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    arrowup: '<path d="m18 15-6-6-6 6"/>',
    arrowdown: '<path d="m6 9 6 6 6-6"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    crown: '<path d="m2 6 4 12h12l4-12-6 5-4-7-4 7z"/>',
}
export function icon(name, cls = 'icon') {
    const t = document.createElement('template')
    t.innerHTML = `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`
    return t.content.firstElementChild
}
export function mountIcons(root = document) {
    $$('[data-icon]', root).forEach(el => el.replaceChildren(icon(el.dataset.icon, el.dataset.iconClass || 'icon')))
}

export function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue
        if (k === 'class') el.className = v
        else if (k === 'style') el.style.cssText = v
        else if (k === 'html') el.innerHTML = v
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
        else el.setAttribute(k, v === true ? '' : v)
    }
    for (const c of children.flat(Infinity)) {
        if (c == null || c === false) continue
        el.append(c instanceof Node ? c : document.createTextNode(String(c)))
    }
    return el
}
export const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(c => c != null && c !== false))

export const fmtTime = d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
export const fmtLen = s => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`
export const fmtNum = n => Math.round(n).toLocaleString('en-US')
export const uid = () => Math.random().toString(36).slice(2, 9)
export const initials = n => String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?'
export const hueOf = str => { let x = 0; for (const c of String(str)) x = (x * 31 + c.charCodeAt(0)) % 360; return x }

export function store(key, val) {
    try {
        if (val === undefined) { const v = localStorage.getItem(key); return v == null ? undefined : JSON.parse(v) }
        localStorage.setItem(key, JSON.stringify(val))
    } catch { return undefined }
}

// Keyed list render: nodes persist between updates so @starting-style / .leave transitions can run.
export function renderList(container, items, keyOf, create, update) {
    const existing = new Map()
    for (const el of Array.from(container.children)) {
        if (el.dataset.leaving) continue
        existing.set(el.dataset.key, el)
    }
    let cursor = container.firstChild
    for (const item of items) {
        const key = String(keyOf(item))
        let el = existing.get(key)
        if (el) existing.delete(key)
        else { el = create(item); el.dataset.key = key }
        update(el, item)
        while (cursor && cursor.dataset && cursor.dataset.leaving) cursor = cursor.nextSibling
        if (el !== cursor) container.insertBefore(el, cursor)
        else cursor = cursor.nextSibling
    }
    for (const el of existing.values()) leave(el)
}
export function leave(el) {
    if (el.dataset.leaving) return
    el.dataset.leaving = '1'
    el.classList.add('leave')
    let done = false
    const fin = () => { if (done) return; done = true; el.remove() }
    el.addEventListener('transitionend', fin, { once: true })
    setTimeout(fin, 400)
}
export function countUp(el, to, dur = 900) {
    const start = performance.now()
    const step = now => {
        const k = Math.min(1, (now - start) / dur)
        const e = 1 - Math.pow(1 - k, 3)
        el.textContent = fmtNum(to * e)
        if (k < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
}

export function toast(msg, ms = 2600) {
    const el = h('div', { class: 'toast' }, msg)
    $('#toasts').append(el)
    setTimeout(() => leave(el), ms)
}
export function copyText(text, msg) {
    const p = navigator.clipboard?.writeText(text)
    if (p) p.then(() => toast(msg), () => toast('Copy failed'))
    else toast('Copy failed')
}
export function setResult(id, result) {
    const el = document.getElementById(id)
    if (!el) return
    if (!result) { el.textContent = ''; el.className = 'result-msg'; return }
    el.className = 'result-msg ' + (result.success ? 'ok' : 'err')
    el.textContent = result.success ? (result.message || 'OK') : ('Error: ' + result.error)
}

export function openDlg(sel) { const d = $(sel); if (!d.open) d.showModal(); return d }
export function closeDlg(sel) { const d = $(sel); if (d.open) d.close() }
export function confirmUI(title, body, { ok = 'Confirm', danger = true } = {}) {
    return new Promise(resolve => {
        $('#confirm-title').textContent = title
        $('#confirm-body').textContent = body
        const okb = $('#confirm-ok')
        okb.textContent = ok
        okb.className = 'btn ' + (danger ? 'btn-danger-solid' : 'btn-primary')
        const d = $('#dlg-confirm')
        const settle = v => { d.removeEventListener('close', onClose); resolve(v) }
        const onClose = () => settle(false)
        okb.onclick = () => { settle(true); d.close() }
        $('#confirm-cancel').onclick = () => d.close()
        d.addEventListener('close', onClose)
        d.showModal()
    })
}
export function buildSeg(el, options, value, onPick) {
    el.replaceChildren(...options.map(o => h('button', { type: 'button', 'data-value': o.value, class: String(o.value) === String(value) ? 'on' : '', onclick: () => { setSeg(el, o.value); onPick?.(o.value) } }, o.label)))
    el.dataset.value = value
}
export function setSeg(el, value) {
    el.dataset.value = value
    for (const b of el.children) b.classList.toggle('on', String(b.dataset.value) === String(value))
}
export function insertAtCursor(ta, text) {
    const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e)
    ta.selectionStart = ta.selectionEnd = s + text.length
    ta.focus()
    ta.dispatchEvent(new Event('input', { bubbles: true }))
}
export function wireMenu(btnSel, menuSel, { stayOpen = false } = {}) {
    const btn = $(btnSel), menu = $(menuSel)
    btn.addEventListener('click', e => { e.stopPropagation(); const open = menu.hidden; closeMenus(); menu.hidden = !open })
    if (stayOpen) menu.addEventListener('click', e => e.stopPropagation())
    return menu
}
export function closeMenus() { $$('.menu').forEach(m => m.hidden = true) }

let actx
export function ding(kind, enabled) {
    if (!enabled) return
    try {
        actx ??= new (window.AudioContext || window.webkitAudioContext)()
        const t = actx.currentTime
        const notes = kind === 'matchEnd' ? [660, 880, 1100] : kind === 'timerEnd' ? [540, 540] : [784, 988]
        notes.forEach((f, i) => {
            const o = actx.createOscillator(), g = actx.createGain()
            o.type = 'sine'; o.frequency.value = f
            g.gain.setValueAtTime(0.0001, t + i * .13)
            g.gain.exponentialRampToValueAtTime(.12, t + i * .13 + .01)
            g.gain.exponentialRampToValueAtTime(.0001, t + i * .13 + .28)
            o.connect(g).connect(actx.destination)
            o.start(t + i * .13); o.stop(t + i * .13 + .3)
        })
    } catch { /* no audio device */ }
}
