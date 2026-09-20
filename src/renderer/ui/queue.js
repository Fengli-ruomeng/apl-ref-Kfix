// One explicit open/closed state controls both the desktop column and drawer.
export function createQueuePanel(root, panel, toggle, close, backdrop, media = window.matchMedia('(min-width: 80rem)')) {
    let choice = null
    let visible = false
    function render() {
        panel.hidden = !visible
        root.dataset.queueOpen = String(visible)
        toggle.setAttribute('aria-expanded', String(visible))
        toggle.classList.toggle('on', visible)
        toggle.title = visible ? 'Hide map queue' : 'Show map queue'
        backdrop.hidden = !visible || media.matches
    }
    function setOpen(open, manual = true) {
        visible = !!open
        if (manual) choice = visible
        render()
    }
    function dismiss() { setOpen(false); toggle.focus() }
    toggle.addEventListener('click', () => setOpen(!visible))
    close.addEventListener('click', dismiss)
    backdrop.addEventListener('click', dismiss)
    media.addEventListener('change', () => { if (choice === null) visible = media.matches; render() })
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !media.matches && visible && !document.querySelector('dialog[open]')) dismiss()
    })
    setOpen(media.matches, false)
    return { setOpen, get open() { return visible } }
}
