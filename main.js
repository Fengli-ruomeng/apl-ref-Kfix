// The launching terminal (npm / electron-forge) can go away while the app keeps
// running; console writes then fail with EPIPE. Never let that crash the app.
for (const stream of [process.stdout, process.stderr]) {
    stream?.on?.('error', err => { if (err?.code !== 'EPIPE') throw err })
}

const { start } = require('./src/main')
start()
