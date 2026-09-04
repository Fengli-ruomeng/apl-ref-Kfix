const fs = require('node:fs/promises')
const path = require('node:path')

const SOURCE_URL = 'https://raw.githubusercontent.com/ppy/osu-web/master/database/mods.json'
const DESTINATION = path.resolve(__dirname, '..', 'src', 'renderer', 'mods.json')
const REQUIRED_RULESETS = [0, 1, 2, 3]

function validateModsJson(text) {
    const modes = JSON.parse(text)
    // order matters, renderer does MODS[room.mode]
    if (!Array.isArray(modes) || !REQUIRED_RULESETS.every(id =>
        modes[id]?.RulesetID === id && Array.isArray(modes[id].Mods) && modes[id].Mods.length > 0)) {
        throw new Error('mods.json does not contain definitions for all supported rulesets')
    }
    return modes
}

async function existingFileIsValid() {
    try {
        validateModsJson(await fs.readFile(DESTINATION, 'utf8'))
        return true
    } catch {
        return false
    }
}

async function writeAtomically(destination, text) {
    const temporary = `${destination}.${process.pid}.tmp`
    await fs.writeFile(temporary, text, 'utf8')
    await fs.rm(destination, { force: true })
    await fs.rename(temporary, destination)
}

async function ensureMods({ force = false } = {}) {
    if (!force && await existingFileIsValid()) {
        console.log('Using existing src/renderer/mods.json')
        return
    }

    const response = await fetch(SOURCE_URL)
    if (!response.ok) throw new Error(`Could not download mods.json: HTTP ${response.status}`)

    const text = await response.text()
    validateModsJson(text)

    await writeAtomically(DESTINATION, text)
    console.log('Downloaded src/renderer/mods.json')
}

module.exports = { ensureMods, validateModsJson, writeAtomically, DESTINATION }

if (require.main === module) {
    ensureMods().catch(error => {
        console.error(error)
        process.exitCode = 1
    })
}
