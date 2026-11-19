/**
 * Packaging contract: the manifest, bundle patch, artifacts, display metadata,
 * and icon that Plugin Manager and client-modules read without activating the
 * plugin. These are static checks; rendered display needs a live page.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = relative => readFile(new URL(relative, import.meta.url), 'utf8')

test('manifest declares one bundle and one web client half', async () => {
  const pkg = JSON.parse(await read('../package.json'))
  assert.equal(pkg.name, 'dsh-workspace-archiver')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.dsh.client.immediately, true)
  assert.equal(pkg.exports['./client'], './client.js')
  assert.equal(pkg.exports['./icon'], './icon.svg')
  assert.ok(pkg.engines.dsh.includes('0.2.2'))
  assert.equal(pkg.engines.node, '>=20')
})

test('manifest carries the public repository metadata', async () => {
  const pkg = JSON.parse(await read('../package.json'))
  assert.equal(pkg.author, 'PandaBoby')
  assert.equal(pkg.license, 'MIT')
  assert.equal(pkg.publishConfig.access, 'public')
  assert.equal(pkg.repository.url, 'git+https://github.com/PandaBoby/dsh-workspace-archiver.git')
  assert.equal(pkg.homepage, 'https://github.com/PandaBoby/dsh-workspace-archiver#readme')
  assert.equal(pkg.bugs.url, 'https://github.com/PandaBoby/dsh-workspace-archiver/issues')
  assert.equal(pkg.scripts.check, 'node test/support/check-syntax.mjs')
  assert.equal(pkg.scripts.pretest, 'npm run check')
  assert.match(pkg.scripts.test, /node --test test\/bundle\.test\.mjs test\/client\.test\.mjs/)
})

test('published files cover every runtime and display resource', async () => {
  const pkg = JSON.parse(await read('../package.json'))
  for (const required of [
    'index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'locale/*.json', 'docs', 'test',
    'README.md', 'README.en.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md',
    'CODE_OF_CONDUCT.md', 'LICENSE',
  ]) {
    assert.ok(pkg.files.includes(required), `files is missing ${required}`)
  }
})

test('bundle patch mounts the package the client scan reads', async () => {
  const patch = await read('../cordis.patch.yml')
  assert.match(patch, /name: dsh-workspace-archiver/)
  assert.match(patch, /id: workspace-archiver/)
})

test('client artifact is a loader script with no Harness module requests', async () => {
  const client = await read('../client.js')
  assert.match(client, /window\.__ModuleLoader__\.load\(/)
  assert.match(client, /dsh-workspace-archiver/)
  assert.doesNotMatch(client, /require\(["']@deepseek-ai\//)
  assert.doesNotMatch(client, /\bReact\b/)
})

test('host artifact is a hand-written ESM module with no behaviour', async () => {
  const host = await read('../index.js')
  assert.match(host, /export const name = 'workspace-archiver'/)
  assert.match(host, /export function apply\(\) \{\}/)
  assert.doesNotMatch(host, /export const inject/)
})

test('both locales carry display metadata and the detail document', async () => {
  for (const locale of ['en', 'zh']) {
    const dict = JSON.parse(await read(`../locale/${locale}.json`))
    assert.equal(typeof dict.meta.title, 'string')
    assert.ok(dict.meta.title.length > 0)
    assert.equal(typeof dict.meta.description, 'string')
    assert.ok(dict.meta.description.length > 40)
    assert.equal(dict.meta.detail, 'docs/DETAIL.md')
  }
})

test('detail document names exactly one preview image', async () => {
  const detail = (await read('../docs/DETAIL.md')).trim()
  const lines = detail.split('\n')
  assert.equal(lines.length, 1)
  assert.match(lines[0], /^!\[[^\]]+\]\(preview\.svg\)$/)
  const preview = await read('../docs/preview.svg')
  assert.match(preview, /width="640"/)
  assert.match(preview, /height="300"/)
  assert.doesNotMatch(preview, /<text|<script|<style|foreignObject|<image/)
})

test('icon is self-contained artwork at the documented optical size', async () => {
  const icon = await read('../icon.svg')
  assert.match(icon, /^<svg[^>]*width="36"[^>]*height="36"[^>]*viewBox="0 0 36 36"/)
  assert.doesNotMatch(icon, /<text|<script|<style|foreignObject|<image/)
  const bytes = Buffer.byteLength(icon)
  assert.ok(bytes < 256 * 1024, `icon is ${bytes} bytes`)
})

test('READMEs are bilingual and link to each other', async () => {
  const zh = await read('../README.md')
  const en = await read('../README.en.md')
  assert.match(zh, /href="README\.en\.md"/)
  assert.match(en, /href="README\.md"/)
  assert.match(zh, /已知限制/)
  assert.match(en, /Known limitations/)
  assert.match(zh, /actions\/workflows\/ci\.yml/)
  assert.match(en, /actions\/workflows\/ci\.yml/)
  assert.match(zh, /docs\/preview\.svg/)
  assert.match(en, /docs\/preview\.svg/)
})

test('community, release, and verification documents exist', async () => {
  const license = await read('../LICENSE')
  assert.match(license, /MIT License/)
  for (const file of ['CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md']) {
    const text = await read(`../${file}`)
    assert.ok(text.length > 200, `${file} looks empty`)
  }
  const ci = await read('../.github/workflows/ci.yml')
  assert.match(ci, /npm test/)
  assert.match(ci, /node: \[20, 22, 24\]/)
  const verification = await read('../docs/verification.md')
  assert.match(verification, /Not verified/)
})
