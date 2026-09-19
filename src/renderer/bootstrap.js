// The sandbox preload exposes the IPC bridge asynchronously. Do not import
// modules that access window.api until both the bridge and version are ready.
async function boot() {
    const deadline = Date.now() + 15000
    while (!window.api?.send || !window.api?.api || window.version == null) {
        if (Date.now() > deadline) throw new Error('The desktop bridge did not load. Close and reopen the app.')
        await new Promise(resolve => setTimeout(resolve, 25))
    }
    await import('./index.js')
}
boot().catch(error => {
    console.error('Renderer startup failed:', error)
    const message = document.createElement('div')
    message.setAttribute('role', 'alert')
    message.textContent = `Could not start APL Ref: ${error.message}`
    document.body.replaceChildren(message)
})
