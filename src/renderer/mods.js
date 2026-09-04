const DA_ORDER = [0, 2, 3, 1, 4]

export function buildModChange(args, mode, modes) {
    if (!Array.isArray(args) || args.length < 1) {
        throw new Error('Usage: !mp mods MD MD or !mp mods MD+MD')
    }

    const modeInfo = modes?.[mode]
    if (!modeInfo || !Array.isArray(modeInfo.Mods)) {
        throw new Error(`Mod metadata is unavailable for ruleset ${mode}`)
    }

    let requested = args[0].split('+')
    if (requested.length === 1 && args.length >= 2) requested = args

    const requiredMods = []
    let allowedMods = []

    for (const rawValue of requested) {
        const raw = String(rawValue).trim()
        if (raw.length < 2) throw new Error(`Invalid mod acronym: ${raw}`)

        const acronym = raw.slice(0, 2).toUpperCase()
        if (acronym === 'FM') {
            allowedMods = modeInfo.Mods
                .filter(mod => mod.ValidForMultiplayerAsFreeMod && mod.Type !== 'System' && mod.UserPlayable)
                .map(mod => ({ acronym: mod.Acronym }))
            continue
        }
        if (acronym === 'NM') continue

        const modInfo = modeInfo.Mods.find(mod => mod.Acronym === acronym)
        if (!modInfo) throw new Error(`Invalid mod acronym for this ruleset: ${acronym}`)

        if (raw.length === 2) {
            requiredMods.push({ acronym })
            continue
        }

        let values
        try {
            values = JSON.parse(raw.slice(2))
        } catch {
            throw new Error(`Invalid settings for ${acronym}: expected a JSON array`)
        }
        if (!Array.isArray(values)) throw new Error(`Invalid settings for ${acronym}: expected a JSON array`)

        const settingNames = (modInfo.Settings ?? []).map(setting => setting.Name)
        if (values.length > settingNames.length) {
            throw new Error(`Invalid settings for ${acronym}: too many arguments`)
        }

        const settings = {}
        const order = acronym === 'DA' ? DA_ORDER : settingNames.map((_, index) => index)
        for (const [index, value] of values.entries()) {
            const settingName = settingNames[order[index]]
            if (!settingName) throw new Error(`Invalid settings for ${acronym}: unknown argument ${index + 1}`)
            settings[settingName] = value
        }
        requiredMods.push({ acronym, settings })
    }

    const requiredAcronyms = new Set(requiredMods.map(mod => mod.acronym))
    allowedMods = allowedMods.filter(mod => !requiredAcronyms.has(mod.acronym))

    const incompatible = new Set(modeInfo.Mods
        .filter(mod => requiredAcronyms.has(mod.Acronym))
        .flatMap(mod => mod.IncompatibleMods ?? []))
    allowedMods = allowedMods.filter(mod => !incompatible.has(mod.acronym))

    return {
        required_mods: requiredMods,
        allowed_mods: allowedMods
    }
}
