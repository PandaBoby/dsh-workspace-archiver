/**
 * Behaviour of the browser half. `client.js` registers its factory with the
 * shell's module loader; the fake context implements only the inspected
 * contracts, and `fetch` is replaced with an in-memory route table.
 */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'

let registration

globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      registration = entry
    },
  },
}

const originalWarn = console.warn
console.warn = () => {}
after(() => {
  console.warn = originalWarn
})

await import('../client.js')

const TARGET = { workspaceId: 'ws-1', path: '/tmp/project', displayTitle: 'project' }
const WORKSPACE = {
  workspaceId: 'ws-1',
  title: 'project',
  path: '/tmp/project',
  sessionIds: ['s-1', 's-2', 's-3'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

/** @type {Array<Record<string, unknown>>} */
let posted = []
/** @type {(url: string, init?: RequestInit) => Promise<Response>} */
let fetchImpl = async () => {
  throw new Error('fetch not configured')
}
globalThis.fetch = (url, init) => fetchImpl(String(url), init)

/**
 * Install the two Host routes for one test.
 * @param {object} options
 * @param {Array<Record<string, unknown>>} [options.hidden]
 * @param {{ status?: number, body: object }} [options.archive]
 * @param {{ status?: number, body: object }} [options.restore]
 * @param {number} [options.stateStatus]
 */
function installFetch({ hidden = [], archive = { body: { ok: true, archived: 3 } }, restore = { body: { ok: true, attached: 2, failures: [] } }, stateStatus = 200 } = {}) {
  posted = []
  fetchImpl = async (url, init = {}) => {
    if (url.endsWith('/api/workspace-archiver/state')) {
      if (stateStatus !== 200) {
        return new Response(JSON.stringify({ ok: false }), { status: stateStatus })
      }
      // Legacy Host shape: no `ok` flag. The client must still render the
      // restore submenu.
      return new Response(JSON.stringify({ hidden }), { status: 200 })
    }
    if (url.endsWith('/api/workspace-archiver/action')) {
      const payload = JSON.parse(String(init.body))
      posted.push(payload)
      const result = payload.action === 'archive' ? archive : restore
      return new Response(JSON.stringify(result.body), { status: result.status ?? (result.body.ok === true ? 200 : 500) })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
}

/**
 * @param {object} options
 * @param {object} [options.workspace]
 * @param {string[]} [options.archived]
 */
function createHarness({ workspace = WORKSPACE, archived = [], currentSessionId = 's-2' } = {}) {
  /** @type {Record<string, Record<string, string>>} */
  const dicts = {}
  const notifications = []
  const uiArchives = []
  let contribution
  let notifyArgs

  const ctx = {
    effect(callback) {
      return callback()
    },
    locale: {
      getSnapshot: () => ({}),
      subscribe: () => () => {},
      register(_ns, registered) {
        dicts.en = registered.en
        dicts.zh = registered.zh
        return () => {}
      },
      bind: () => (key, params) => {
        const template = dicts.en[key] ?? key
        return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match)
      },
    },
    workspaces: {
      list: {
        getSnapshot: () => ({
          items: workspace === null ? [] : [workspace],
          archivedSessionIds: archived,
          pinnedSessionIds: [],
          state: 'idle',
          phase: 'ready',
        }),
        subscribe: () => () => {},
      },
    },
    sessions: {
      list: {
        getSnapshot: () => ({
          byId: currentSessionId === null
            ? {}
            : { [currentSessionId]: { id: currentSessionId, retainedBy: { mainView: 1 } } },
        }),
      },
    },
    uiWorkspace: {
      async archiveSession(sessionId) {
        uiArchives.push(sessionId)
      },
    },
    contextMenus: {
      register(value) {
        contribution = value
        return () => {}
      },
      notify(...args) {
        notifyArgs = args
        notifications.push(args)
      },
    },
  }

  const plugin = registration.factory()
  plugin.apply(ctx)
  return {
    ctx,
    dicts,
    plugin,
    notifications,
    uiArchives,
    get contribution() {
      return contribution
    },
    get lastNotice() {
      return notifyArgs
    },
  }
}

async function resolveActions(harness, { hidden = [], stateStatus } = {}) {
  installFetch({ hidden, stateStatus })
  return await harness.contribution.resolve(TARGET, new AbortController().signal)
}

test('registers the package bundle and a workspace menu contribution', () => {
  assert.equal(registration.id, 'dsh-workspace-archiver')
  const harness = createHarness()
  assert.equal(harness.plugin.name, 'dsh-workspace-archiver')
  assert.deepEqual([...harness.plugin.inject], ['contextMenus', 'workspaces', 'sessions', 'uiWorkspace', 'locale'])
  assert.equal(harness.contribution.target, 'workspace')
  assert.equal(harness.contribution.order, 200)
  assert.equal(harness.contribution.id, 'dsh-workspace-archiver.archive-workspace')
})

test('labels the archive action with the non-archived session count', async () => {
  const harness = createHarness({ archived: ['s-3'] })
  const actions = await resolveActions(harness)
  assert.equal(actions.length, 1)
  assert.equal(actions[0].label, 'Archive and hide this workspace (2 sessions)')
  assert.equal(actions[0].danger, true)
})

test('uses the hide label when every session is already archived', async () => {
  const harness = createHarness({ archived: ['s-1', 's-2', 's-3'] })
  const actions = await resolveActions(harness)
  assert.equal(actions[0].label, 'Hide this workspace')
})

test('posts archive to the Host and reports the archived count', async () => {
  const harness = createHarness()
  const [action] = await resolveActions(harness)
  await action.run()
  assert.deepEqual(posted, [{ action: 'archive', workspaceId: 'ws-1' }])
  assert.deepEqual(harness.uiArchives, ['s-2'])
  assert.deepEqual(harness.lastNotice, [
    'Archived 3 sessions and hid the workspace; restore it from a workspace menu',
    true,
  ])
})

test('does not touch the UI service when the open session is outside the workspace', async () => {
  const harness = createHarness({ currentSessionId: 's-9' })
  const [action] = await resolveActions(harness)
  await action.run()
  assert.deepEqual(harness.uiArchives, [])
})

test('reports the blocked count and does not claim success', async () => {
  const harness = createHarness()
  installFetch({
    archive: {
      status: 409,
      body: { ok: false, code: 'workspace/blocked', failures: [{ sessionId: 'a' }, { sessionId: 'b' }] },
    },
  })
  const [action] = await harness.contribution.resolve(TARGET, new AbortController().signal)
  await action.run()
  assert.deepEqual(harness.lastNotice, [
    'Workspace not hidden: 2 session(s) could not be archived (still running?)',
    false,
  ])
})

test('lists hidden workspaces and restores one from the submenu', async () => {
  const harness = createHarness()
  installFetch({
    hidden: [{ id: 'h-1', title: 'project', path: '/tmp/project', sessionCount: 2 }],
    restore: { body: { ok: true, attached: 2, failures: [] } },
  })
  const actions = await harness.contribution.resolve(TARGET, new AbortController().signal)
  assert.equal(actions.length, 2)
  assert.equal(actions[1].label, 'Restore archived workspace (1)')
  assert.equal(actions[1].children.length, 1)
  assert.equal(actions[1].children[0].label, 'project (2 sessions)')

  await actions[1].children[0].run()
  assert.deepEqual(posted, [{ action: 'restore', hiddenId: 'h-1' }])
  assert.deepEqual(harness.lastNotice, ['Workspace restored with 2 session(s)', true])
})

test('reports a partial restore when some sessions could not be reattached', async () => {
  const harness = createHarness()
  installFetch({
    hidden: [{ id: 'h-1', title: 'project', path: '/tmp/project', sessionCount: 2 }],
    restore: { body: { ok: true, attached: 1, failures: [{ sessionId: 's-2' }] } },
  })
  const actions = await harness.contribution.resolve(TARGET, new AbortController().signal)
  await actions[1].children[0].run()
  assert.deepEqual(harness.lastNotice, [
    'Workspace restored with 1 session(s); 1 could not be reattached',
    true,
  ])
})

test('keeps the archive action when the Host state route fails', async () => {
  const harness = createHarness()
  installFetch({ stateStatus: 500 })
  const actions = await harness.contribution.resolve(TARGET, new AbortController().signal)
  assert.equal(actions.length, 1)
  assert.equal(actions[0].label, 'Archive and hide this workspace (3 sessions)')
})

test('reports a failed archive request without throwing out of the menu', async () => {
  const harness = createHarness()
  installFetch()
  const [action] = await harness.contribution.resolve(TARGET, new AbortController().signal)
  fetchImpl = async () => {
    throw new Error('network down')
  }
  await action.run()
  assert.deepEqual(harness.lastNotice, ['The workspace operation failed; see the console for details', false])
})

test('reports a failed restore request without throwing out of the menu', async () => {
  const harness = createHarness()
  installFetch({
    hidden: [{ id: 'h-1', title: 'project', path: '/tmp/project', sessionCount: 1 }],
    restore: { status: 500, body: { ok: false, code: 'internal' } },
  })
  const actions = await harness.contribution.resolve(TARGET, new AbortController().signal)
  await actions[1].children[0].run()
  assert.deepEqual(harness.lastNotice, ['Restoring the workspace failed; see the console for details', false])
})

test('hides the action for a workspace that is no longer registered', async () => {
  const harness = createHarness({ workspace: null })
  assert.deepEqual(await resolveActions(harness), [])
})

test('keeps English and Chinese dictionaries key-for-key aligned', () => {
  const harness = createHarness()
  assert.deepEqual(Object.keys(harness.dicts.zh).sort(), Object.keys(harness.dicts.en).sort())
  for (const value of Object.values(harness.dicts.en)) assert.ok(value.length > 0)
  for (const value of Object.values(harness.dicts.zh)) assert.ok(value.length > 0)
})
