/**
 * Syntax gate shared by local development and CI.
 *
 * The bundle ships as plain JavaScript, so this is the only "compiler" in the
 * repository: parse the browser artifact as a classic script, import the Host
 * module as ESM, and make sure the JSON the Loader and Plugin Manager read is
 * well-formed. It never executes browser code.
 */
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const root = new URL('../../', import.meta.url)
const read = name => readFile(new URL(name, root), 'utf8')

const pkg = JSON.parse(await read('package.json'))

const client = await read('client.js')
new vm.Script(client, { filename: 'client.js' })

const host = await import(new URL('index.js', root))
if (typeof host.name !== 'string' || host.name.length === 0) {
  throw new Error('index.js must export a non-empty name')
}
if (typeof host.apply !== 'function') {
  throw new Error('index.js must export apply()')
}

for (const name of ['locale/en.json', 'locale/zh.json']) {
  JSON.parse(await read(name))
}

const patch = await read('cordis.patch.yml')
if (!patch.includes(`name: ${pkg.name}`)) {
  throw new Error(`cordis.patch.yml does not mount ${pkg.name}`)
}

console.log(`syntax check passed: ${pkg.name}@${pkg.version}`)
