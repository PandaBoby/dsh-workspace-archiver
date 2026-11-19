/**
 * Behaviour of the browser half, exercised through the exact artifact the Host
 * serves: `client.js` registers its factory with the shell's module loader.
 * The fake context implements only the inspected contracts, so the test fails
 * if the plugin starts depending on a service or field it did not declare.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

let registration

globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      registration = entry
    },
  },
}

await import('../client.js')

const TARGET = { workspaceId: 'ws-1', path: '/tmp/project', displayTitle: 'project' }

/**
 * Build one fake Client context plus the recording collaborators.
 * @param {object} options - workspace row, pre-archived ids, per-session failure hook.
 * @returns the harness.
 */
function createHarness({ workspace = { workspaceId: 'ws-1', title: 'project', path: '/tmp/project', sessionIds: ['s-1', 's-2', 's-3'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }, archived = [], fail = () => undefined } = {}) {
  /** @type {Record<string, Record<string, string>>} */
  const dicts = {}
  const notifications = []
  const archives = []
  const unarchives = []
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
    uiWorkspace: {
      async archiveSession(sessionId) {
        const reason = fail(sessionId)
        if (reason !== undefined) throw reason
        archives.push(sessionId)
      },
      async unarchiveSession(sessionId) {
        unarchives.push(sessionId)
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

  const plugin = registration.factory(() => ({}))
  plugin.apply(ctx)
  return {
    ctx,
    dicts,
    plugin,
    notifications,
    archives,
    unarchives,
    get contribution() {
      return contribution
    },
    get lastNotice() {
      return notifyArgs
    },
  }
}

test('registers the package bundle and a workspace menu contribution', () => {
  assert.equal(registration.id, 'dsh-workspace-archiver')
  const harness = createHarness()
  assert.equal(harness.plugin.name, 'dsh-workspace-archiver')
  assert.deepEqual([...harness.plugin.inject], ['contextMenus', 'workspaces', 'uiWorkspace', 'locale'])
  assert.equal(harness.contribution.target, 'workspace')
  assert.equal(harness.contribution.order, 200)
  assert.equal(harness.contribution.id, 'dsh-workspace-archiver.archive-workspace')
})

test('labels the action with the non-archived session count', async () => {
  const harness = createHarness({ archived: ['s-3'] })
  const actions = await harness.contribution.resolve(TARGET, new AbortController().signal)
  assert.equal(actions.length, 1)
  assert.equal(actions[0].label, 'Archive 2 sessions in this workspace')
  assert.equal(actions[0].id, 'archive-workspace')
})

test('uses the singular label and notice for one session', async () => {
  const harness = createHarness({
    workspace: { workspaceId: 'ws-1', title: 'project', path: '/tmp/project', sessionIds: ['only'], createdAt: '', updatedAt: '' },
  })
  const [action] = await harness.contribution.resolve(TARGET, new AbortController().signal)
  assert.equal(action.label, 'Archive the session in this workspace')
  await action.run()
  assert.deepEqual(harness.archives, ['only'])
  assert.equal(harness.lastNotice[0], 'Archived 1 session')
  assert.equal(harness.lastNotice[1], true)
})

test('archives every candidate sequentially and offers undo for exactly those ids', async () => {
  const harness = createHarness()
  const [action] = await harness.contribution.resolve(TARGET, new AbortController().signal)
  await action.run()
  assert.deepEqual(harness.archives, ['s-1', 's-2', 's-3'])
  assert.equal(harness.lastNotice[0], 'Archived 3 sessions')
  assert.equal(harness.lastNotice[1], true)
  const undo = harness.lastNotice[2]
  assert.equal(undo.label, 'Undo')
  assert.equal(undo.failureLabel, 'Could not undo the archive')
  await undo.run()
  assert.deepEqual(harness.unarchives, ['s-1', 's-2', 's-3'])
})

test('keeps going when one session is busy and reports the partial result', async () => {
  const busy = Object.assign(new Error('session still running'), {
    name: 'WorkspaceArchiveError',
    rpcError: { code: 'workspace/session-active', message: 'session still running' },
  })
  const harness = createHarness({ fail: sessionId => sessionId === 's-2' ? busy : undefined })
  const warn = console.warn
  const warnings = []
  console.warn = (...args) => {
    warnings.push(args)
  }
  try {
    const [action] = await harness.contribution.resolve(TARGET, new AbortController().signal)
    await action.run()
  } finally {
    console.warn = warn
  }
  assert.deepEqual(harness.archives, ['s-1', 's-3'])
  assert.equal(warnings.length, 1)
  assert.equal(harness.lastNotice[0], 'Archived 2 of 3 sessions; 1 still running or failed')
  assert.equal(harness.lastNotice[1], true)
  await harness.lastNotice[2].run()
  assert.deepEqual(harness.unarchives, ['s-1', 's-3'])
})

test('reports a failed run without an undo action', async () => {
  const busy = Object.assign(new Error('busy'), { name: 'WorkspaceArchiveError', rpcError: { code: 'workspace/session-active' } })
  const harness = createHarness({ fail: () => busy })
  const warn = console.warn
  console.warn = () => {}
  try {
    const [action] = await harness.contribution.resolve(TARGET, new AbortController().signal)
    await action.run()
  } finally {
    console.warn = warn
  }
  assert.deepEqual(harness.archives, [])
  assert.deepEqual(harness.lastNotice, ['Nothing was archived; 3 session(s) still running or failed', false])
})

test('drops a second run of the same workspace while the first is in flight', async () => {
  const harness = createHarness()
  const [action] = await harness.contribution.resolve(TARGET, new AbortController().signal)
  await Promise.all([action.run(), action.run()])
  assert.deepEqual(harness.archives, ['s-1', 's-2', 's-3'])
  assert.equal(harness.notifications.length, 1)
})

test('hides the action when every session is already archived', async () => {
  const harness = createHarness({ archived: ['s-1', 's-2', 's-3'] })
  assert.deepEqual(await harness.contribution.resolve(TARGET, new AbortController().signal), [])
})

test('hides the action for a workspace that is no longer registered', async () => {
  const harness = createHarness({ workspace: null })
  assert.deepEqual(await harness.contribution.resolve(TARGET, new AbortController().signal), [])
})

test('keeps English and Chinese dictionaries key-for-key aligned', () => {
  const harness = createHarness()
  assert.deepEqual(Object.keys(harness.dicts.zh).sort(), Object.keys(harness.dicts.en).sort())
  for (const value of Object.values(harness.dicts.en)) assert.ok(value.length > 0)
  for (const value of Object.values(harness.dicts.zh)) assert.ok(value.length > 0)
})
