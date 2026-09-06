const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const asar = require('@electron/asar')
const plist = require('plist')
const { validateModsJson } = require('./ensureMods')

const [platform, arch] = process.argv.slice(2)
assert(['win32', 'linux', 'darwin'].includes(platform), 'Specify a supported platform')
assert(['x64', 'arm64', 'ia32'].includes(arch), 'Specify a supported architecture')
const root = path.resolve(__dirname, '..')
const pkg = require('../package.json')
const output = path.join(root, 'out', `${pkg.name}-${platform}-${arch}`)
const contents = path.join(output, `${pkg.name}.app`, 'Contents')
const resources = platform === 'darwin' ? path.join(contents, 'Resources') : path.join(output, 'resources')
const archive = path.join(resources, 'app.asar')
const packaged = JSON.parse(asar.extractFile(archive, 'package.json').toString())
assert.equal(packaged.version, pkg.version)
assert.equal(packaged.main, pkg.main)

for (const file of [
    'main.js', 'preload.js', 'src/main/index.js', 'src/main/ipc.js',
    'src/auth.js', 'src/referee.js', 'src/referee/events.js',
    'src/referee/commands.js', 'src/renderer/index.html', 'src/renderer/index.js',
    'src/renderer/models.js', 'src/renderer/utils.js', 'src/renderer/mods.js',
    'src/renderer/config.html', 'src/renderer/mods.json', 'src/renderer/css/tailwind.css',
]) {
    // ASAR paths use the host separator, including on Windows.
    const relative = file.split('/').join(path.sep)
    assert.deepEqual(asar.extractFile(archive, relative), fs.readFileSync(path.join(root, relative)), file)
}
validateModsJson(asar.extractFile(archive, path.join('src', 'renderer', 'mods.json')).toString())

let executable
if (platform === 'win32') {
    executable = path.join(output, `${pkg.name}.exe`)
} else if (platform === 'darwin') {
    executable = path.join(contents, 'MacOS', pkg.name)
    const info = plist.parse(fs.readFileSync(path.join(contents, 'Info.plist'), 'utf8'))
    assert.equal(info.CFBundleShortVersionString, pkg.version)
    assert.equal(info.CFBundleExecutable, pkg.name)
    assert(info.CFBundleIconFile, 'macOS icon is missing')
    assert.deepEqual(fs.readFileSync(path.join(resources, info.CFBundleIconFile)),
        fs.readFileSync(path.join(root, 'assets', 'aplreflogo.icns')), 'macOS icon')
} else {
    executable = path.join(output, pkg.name)
}

const descriptor = fs.openSync(executable, 'r')
const header = Buffer.alloc(4096)
try { fs.readSync(descriptor, header, 0, header.length, 0) }
finally { fs.closeSync(descriptor) }
if (platform === 'win32') {
    assert.equal(header.toString('ascii', 0, 2), 'MZ')
    const pe = header.readUInt32LE(0x3c)
    assert.equal(header.readUInt32LE(pe), 0x4550)
    assert.equal(header.readUInt16LE(pe + 4), { x64: 0x8664, ia32: 0x14c, arm64: 0xaa64 }[arch])
} else if (platform === 'linux') {
    assert.equal(header.toString('hex', 0, 4), '7f454c46')
    assert.equal(header[5], 1, 'Expected little-endian ELF')
    assert.equal(header.readUInt16LE(18), { x64: 62, arm64: 183 }[arch])
} else {
    assert.equal(header.readUInt32LE(0), 0xfeedfacf)
    assert.equal(header.readUInt32LE(4), { x64: 0x1000007, arm64: 0x100000c }[arch])
}
if (platform !== 'win32') assert(fs.statSync(executable).mode & 0o111, 'Executable permission is missing')
console.log(`Verified ${pkg.name} ${pkg.version}: ${platform}/${arch}, source files, assets and executable header`)
