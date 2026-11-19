/**
 * Host-side archive/restore behavior. The fake registry mirrors the exact
 * methods the Host half uses, so a regression to a Client-only operation or a
 * missing `attachSession` shows up here rather than only in a live profile.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { WorkspaceArchiver } from '../src/archiver.js'
import { apply, inject, name } from '../index.js'
import { createWorkspaceArchiverCommand } from '../src/command.js'
import { registerWorkspaceArchiverRoutes } from '../src/routes.js'
import { createHiddenStore } from '../src/store.js'

/** @returns {Promise<string>} a fresh temporary directory. */
async function tempDir() {
  return await mkdtemp(join(tmpdir(), 'dsh-workspace-archiver-'))
}

/**
 * @param {object} options
 * @param {Array<{ path: string, title?: string, sessionIds?: string[] }>} [options.initial]
 * @param {Set<string>} [options.busy]
 * @param {boolean} [options.failDelete]
 * @returns the fake registry plus its order snapshot.
 */
function createFakeRegistry({ initial = [], busy = new Set(), failDelete = false } = {}) {
  let sequence = 0
  const byId = new Map()
  /** @type {string[]} */
  let order = []
  const archived = new Set()

  const make = (path, title, sessionIds) => {
    const workspace = {
      id: `w${++sequence}`,
      path,
      title,
      sessionIds: [...sessionIds],
      async attachSession(sessionId) {
        if (!this.sessionIds.includes(sessionId)) this.sessionIds.unshift(sessionId)
      },
    }
    byId.set(workspace.id, workspace)
    order.push(workspace.id)
    return workspace
  }

  for (const item of initial) make(item.path, item.title ?? item.path, item.sessionIds ?? [])

  return {
    get: id => byId.get(id),
    list: () => order.map(id => byId.get(id)).filter(Boolean),
    get archivedSessionIds() {
      return [...archived]
    },
    async archiveSession(sessionId) {
      if (busy.has(sessionId)) {
        const error = new Error(`session ${sessionId} is active`)
        error.name = 'WorkspaceActiveSessionError'
        throw error
      }
      archived.add(sessionId)
    },
    async unarchiveSession(sessionId) {
      archived.delete(sessionId)
    },
    async delete(id) {
      if (failDelete) throw new Error('delete refused')
      const existed = byId.delete(id)
      order = order.filter(candidate => candidate !== id)
      return existed
    },
    async create(path, title) {
      const existing = [...byId.values()].find(workspace => workspace.path === path)
      if (existing !== undefined) return existing
      return make(path, title ?? path, [])
    },
    async insertBefore(id, beforeId) {
      order = order.filter(candidate => candidate !== id)
      const index = beforeId === undefined ? order.length : order.indexOf(beforeId)
      order.splice(index === -1 ? order.length : index, 0, id)
      return [...order]
    },
    order: () => [...order],
  }
}

test('wires the routes and command through the Host plugin entry', async () => {
  const directory = await tempDir()
  try {
    const routes = new Map()
    const commands = []
    const ctx = {
      logger: { warn() {} },
      workspaceRegistry: createFakeRegistry(),
      connection: {
        fetch: {
          register(route) {
            routes.set(route.path, route)
            return async () => {}
          },
        },
      },
      commands: {
        register(definition) {
          commands.push(definition)
          return () => {}
        },
      },
      effect(callback) {
        return callback()
      },
    }
    assert.equal(name, 'workspace-archiver')
    assert.deepEqual([...inject], ['connection', 'workspaceRegistry', 'commands'])
    apply(ctx, { hiddenFile: join(directory, 'hidden.json') })
    assert.deepEqual([...routes.keys()].sort(), [
      '/api/workspace-archiver/action',
      '/api/workspace-archiver/state',
    ])
    assert.equal(commands.length, 1)
    assert.equal(commands[0].name, 'workspace-archiver')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('archives sessions, persists the membership, removes the workspace, and restores it', async () => {
  const directory = await tempDir()
  try {
    const file = join(directory, 'hidden.json')
    const store = createHiddenStore(file, { warn() {} })
    const registry = createFakeRegistry({
      initial: [
        { path: '/tmp/a', title: 'A', sessionIds: ['s-1', 's-2'] },
        { path: '/tmp/b', title: 'B', sessionIds: ['s-3'] },
      ],
    })
    const archiver = new WorkspaceArchiver(registry, store, { warn() {} })

    const archived = await archiver.archive('w1')
    assert.equal(archived.ok, true)
    assert.equal(archived.archived, 2)
    assert.equal(registry.get('w1'), undefined)
    assert.deepEqual([...registry.archivedSessionIds], ['s-1', 's-2'])

    const state = await archiver.state()
    assert.equal(state.hidden.length, 1)
    assert.deepEqual(state.hidden[0], {
      id: state.hidden[0].id,
      title: 'A',
      path: '/tmp/a',
      sessionCount: 2,
      createdAt: state.hidden[0].createdAt,
    })

    // The record must survive a process restart.
    const reloaded = createHiddenStore(file, { warn() {} })
    assert.equal((await reloaded.list()).length, 1)

    const restored = await archiver.restore(state.hidden[0].id)
    assert.equal(restored.ok, true)
    assert.equal(restored.attached, 2)
    assert.equal(restored.unarchived, 2)
    assert.deepEqual(restored.failures, [])

    const workspace = registry.list().find(candidate => candidate.path === '/tmp/a')
    assert.deepEqual(workspace.sessionIds, ['s-1', 's-2'])
    assert.deepEqual([...registry.archivedSessionIds], [])
    assert.equal((await archiver.state()).hidden.length, 0)
    // The restored workspace is placed before the anchor that followed it.
    assert.deepEqual(registry.order(), [workspace.id, 'w2'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('keeps a separately archived session archived after restoring the workspace', async () => {
  const directory = await tempDir()
  try {
    const store = createHiddenStore(join(directory, 'hidden.json'), { warn() {} })
    const registry = createFakeRegistry({
      initial: [{ path: '/tmp/a', title: 'A', sessionIds: ['s-1', 's-2'] }],
    })
    const archiver = new WorkspaceArchiver(registry, store, { warn() {} })
    // The user archived s-2 before archiving the workspace; only s-1 belongs to
    // this run's undo set.
    await registry.archiveSession('s-2')

    const archived = await archiver.archive('w1')
    assert.equal(archived.ok, true)
    assert.equal(archived.archived, 1)
    const state = await archiver.state()
    const restored = await archiver.restore(state.hidden[0].id)
    assert.equal(restored.ok, true)
    assert.equal(restored.attached, 2)
    assert.equal(restored.unarchived, 1)

    const workspace = registry.list().find(candidate => candidate.path === '/tmp/a')
    assert.deepEqual(workspace.sessionIds, ['s-1', 's-2'])
    assert.deepEqual([...registry.archivedSessionIds], ['s-2'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('leaves the workspace in place when a session cannot be archived', async () => {
  const directory = await tempDir()
  try {
    const store = createHiddenStore(join(directory, 'hidden.json'), { warn() {} })
    const registry = createFakeRegistry({
      initial: [{ path: '/tmp/a', title: 'A', sessionIds: ['s-1', 's-2'] }],
      busy: new Set(['s-2']),
    })
    const archiver = new WorkspaceArchiver(registry, store, { warn() {} })

    const result = await archiver.archive('w1')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'workspace/blocked')
    assert.equal(result.failures.length, 1)
    assert.equal(result.failures[0].sessionId, 's-2')
    assert.notEqual(registry.get('w1'), undefined)
    assert.equal((await archiver.state()).hidden.length, 0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('removes the hidden record when deleting the workspace fails', async () => {
  const directory = await tempDir()
  try {
    const store = createHiddenStore(join(directory, 'hidden.json'), { warn() {} })
    const registry = createFakeRegistry({
      initial: [{ path: '/tmp/a', title: 'A', sessionIds: ['s-1'] }],
      failDelete: true,
    })
    const archiver = new WorkspaceArchiver(registry, store, { warn() {} })

    const result = await archiver.archive('w1')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'workspace/remove-failed')
    assert.notEqual(registry.get('w1'), undefined)
    assert.equal((await archiver.state()).hidden.length, 0)
    // The session stays archived; retrying the action also retries the delete.
    assert.deepEqual([...registry.archivedSessionIds], ['s-1'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('reports a missing workspace and a missing hidden record', async () => {
  const directory = await tempDir()
  try {
    const store = createHiddenStore(join(directory, 'hidden.json'), { warn() {} })
    const archiver = new WorkspaceArchiver(createFakeRegistry(), store, { warn() {} })
    assert.deepEqual(await archiver.archive('missing'), { ok: false, code: 'workspace/not-found' })
    assert.deepEqual(await archiver.restore('missing'), { ok: false, code: 'hidden/not-found' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('serves authenticated state and action routes', async () => {
  const directory = await tempDir()
  try {
    const routes = new Map()
    const connection = {
      fetch: {
        register(route) {
          routes.set(route.path, route)
          return async () => {}
        },
      },
    }
    const store = createHiddenStore(join(directory, 'hidden.json'), { warn() {} })
    const registry = createFakeRegistry({
      initial: [{ path: '/tmp/a', title: 'A', sessionIds: ['s-1'] }],
    })
    const archiver = new WorkspaceArchiver(registry, store, { warn() {} })
    const dispose = registerWorkspaceArchiverRoutes(connection, archiver, { warn() {} })
    assert.equal(routes.size, 2)

    const stateRoute = routes.get('/api/workspace-archiver/state')
    const stateResponse = await stateRoute.fetch(new Request('http://local/api/workspace-archiver/state'))
    assert.equal(stateResponse.status, 200)
    const initialState = await stateResponse.json()
    assert.equal(initialState.ok, true)
    assert.deepEqual(initialState.hidden, [])

    const actionRoute = routes.get('/api/workspace-archiver/action')
    const archiveResponse = await actionRoute.fetch(new Request('http://local/api/workspace-archiver/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'archive', workspaceId: 'w1' }),
    }))
    assert.equal(archiveResponse.status, 200)
    const archived = await archiveResponse.json()
    assert.equal(archived.ok, true)
    assert.equal(archived.archived, 1)

    const hidden = (await (await stateRoute.fetch(new Request('http://local/api/workspace-archiver/state'))).json()).hidden
    assert.equal(hidden.length, 1)

    const restoreResponse = await actionRoute.fetch(new Request('http://local/api/workspace-archiver/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'restore', hiddenId: hidden[0].id }),
    }))
    assert.equal(restoreResponse.status, 200)
    assert.equal((await restoreResponse.json()).attached, 1)

    const badResponse = await actionRoute.fetch(new Request('http://local/api/workspace-archiver/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'nonsense' }),
    }))
    assert.equal(badResponse.status, 400)
    dispose()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('lists and restores hidden workspaces from the slash command', async () => {
  const directory = await tempDir()
  try {
    const store = createHiddenStore(join(directory, 'hidden.json'), { warn() {} })
    const registry = createFakeRegistry({
      initial: [{ path: '/tmp/a', title: 'A', sessionIds: ['s-1', 's-2'] }],
    })
    const archiver = new WorkspaceArchiver(registry, store, { warn() {} })
    const command = createWorkspaceArchiverCommand(archiver)
    assert.equal(command.name, 'workspace-archiver')

    const empty = await command.handler({ rawInput: '' })
    assert.equal(empty.kind, 'success')
    assert.match(empty.text, /No archived workspaces/)

    await archiver.archive('w1')
    const listed = await command.handler({ rawInput: '' })
    assert.equal(listed.kind, 'success')
    assert.match(listed.text, /A — \/tmp\/a \(2 sessions\)/)
    assert.match(listed.text, /workspace-archiver restore/)

    const restored = await command.handler({ rawInput: 'restore 1' })
    assert.equal(restored.kind, 'success')
    assert.match(restored.text, /Restored "A" with 2 sessions/)
    assert.equal((await archiver.state()).hidden.length, 0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
