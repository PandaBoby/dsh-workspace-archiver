/**
 * Workspace archive/restore operation, kept independent of HTTP and commands so
 * the authenticated route and the slash command share one implementation.
 *
 * Archiving is Host-side on purpose: the Client cannot attach sessions to a
 * workspace, and an archive that only deleted the registration would lose the
 * membership. The record written before the delete is what makes restoration
 * possible: `workspaceRegistry.create` rebuilds the row, and
 * `Workspace.attachSession` puts each stored session back before the archive set
 * is cleared.
 */
import { randomUUID } from 'node:crypto'

/**
 * @typedef {import('./store.js').HiddenWorkspace} HiddenWorkspace
 *
 * @typedef {object} WorkspaceRegistry
 * @property {readonly string[]} archivedSessionIds
 * @property {(id: string) => WorkspaceEntity | undefined} get
 * @property {() => readonly WorkspaceEntity[]} list
 * @property {(id: string) => Promise<boolean>} delete
 * @property {(path: string, title?: string) => Promise<WorkspaceEntity>} create
 * @property {(id: string) => Promise<void>} archiveSession
 * @property {(id: string) => Promise<void>} unarchiveSession
 * @property {(id: string, beforeId?: string) => Promise<readonly string[]>} insertBefore
 *
 * @typedef {object} WorkspaceEntity
 * @property {string} id
 * @property {string} path
 * @property {string} title
 * @property {readonly string[]} sessionIds
 * @property {(sessionId: string) => Promise<void>} attachSession
 *
 * @typedef {object} HiddenSummary
 * @property {string} id
 * @property {string} title
 * @property {string} path
 * @property {number} sessionCount
 * @property {string} createdAt
 */

/**
 * @param {unknown} error
 * @returns {{ name?: string, message: string }}
 */
function describeError(error) {
  return {
    ...(error instanceof Error && error.name !== '' ? { name: error.name } : {}),
    message: error instanceof Error ? error.message : String(error),
  }
}

export class WorkspaceArchiver {
  /** @type {Promise<unknown>} */
  #tail = Promise.resolve()

  /**
   * @param {WorkspaceRegistry} registry
   * @param {ReturnType<import('./store.js').createHiddenStore>} store
   * @param {{ warn: (...args: unknown[]) => void }} [logger]
   */
  constructor(registry, store, logger = console) {
    this.registry = registry
    this.store = store
    this.logger = logger
  }

  /**
   * Serialize archive and restore mutations; a second archive cannot delete a
   * workspace while the first is still writing its hidden record.
   * @template T
   * @param {() => Promise<T>} operation
   * @returns {Promise<T>}
   */
  #run(operation) {
    const result = this.#tail.then(operation, operation)
    this.#tail = result.then(() => undefined, () => undefined)
    return result
  }

  /**
   * @param {HiddenWorkspace} record
   * @returns {HiddenSummary}
   */
  static summarize(record) {
    return {
      id: record.id,
      title: record.title,
      path: record.path,
      sessionCount: record.sessionIds.length,
      createdAt: record.createdAt,
    }
  }

  /**
   * Hidden workspace summaries, oldest first.
   * @returns {Promise<{ hidden: HiddenSummary[] }>}
   */
  async state() {
    const records = await this.store.list()
    records.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    return { hidden: records.map(WorkspaceArchiver.summarize) }
  }

  /**
   * Archive every member session, persist the membership record, then remove
   * the registration. Any archive failure leaves the workspace untouched.
   * @param {string} workspaceId
   * @returns {Promise<
   *   { ok: true, archived: number, hiddenId: string, title: string }
   *   | { ok: false, code: string, failures?: Array<{ sessionId: string, name?: string, message: string }>, message?: string }
   * >}
   */
  archive(workspaceId) {
    return this.#run(async () => {
      const workspace = this.registry.get(workspaceId)
      if (workspace === undefined) return { ok: false, code: 'workspace/not-found' }

      const alreadyArchived = new Set(this.registry.archivedSessionIds)
      const candidates = workspace.sessionIds.filter(id => !alreadyArchived.has(id))
      /** @type {Array<{ sessionId: string, name?: string, message: string }>} */
      const failures = []
      for (const sessionId of candidates) {
        try {
          await this.registry.archiveSession(sessionId)
        } catch (error) {
          failures.push({ sessionId, ...describeError(error) })
        }
      }
      if (failures.length > 0) {
        return { ok: false, code: 'workspace/blocked', failures }
      }

      const order = this.registry.list().map(candidate => candidate.id)
      const index = order.indexOf(workspaceId)
      const anchor = index === -1 ? undefined : order[index + 1]
      /** @type {HiddenWorkspace} */
      const record = {
        id: randomUUID(),
        workspaceId,
        path: workspace.path,
        title: workspace.title,
        sessionIds: [...workspace.sessionIds],
        archivedByRun: [...candidates],
        ...(anchor === undefined ? {} : { anchor }),
        createdAt: new Date().toISOString(),
      }

      try {
        await this.store.add(record)
      } catch (error) {
        this.logger.warn?.('[workspace-archiver] could not persist the hidden record:', error)
        return { ok: false, code: 'workspace/store-failed', message: describeError(error).message }
      }

      try {
        const deleted = await this.registry.delete(workspaceId)
        if (!deleted) {
          await this.store.remove(record.id)
          return { ok: false, code: 'workspace/remove-failed' }
        }
      } catch (error) {
        await this.store.remove(record.id).catch(() => {})
        this.logger.warn?.('[workspace-archiver] could not remove the workspace registration:', error)
        return { ok: false, code: 'workspace/remove-failed', message: describeError(error).message }
      }

      return { ok: true, archived: candidates.length, hiddenId: record.id, title: record.title }
    })
  }

  /**
   * Recreate the workspace (or reuse one already registered at the same path),
   * attach the stored sessions in their original order, unarchive them, and
   * clear the hidden record. Attachment failures are reported but do not block
   * the workspace from reappearing.
   * @param {string} hiddenId
   * @returns {Promise<
   *   { ok: true, workspaceId: string, attached: number, unarchived: number, failures: Array<{ sessionId: string, name?: string, message: string }> }
   *   | { ok: false, code: string, message?: string }
   * >}
   */
  restore(hiddenId) {
    return this.#run(async () => {
      const record = await this.store.get(hiddenId)
      if (record === undefined) return { ok: false, code: 'hidden/not-found' }

      const existing = this.registry.list().find(candidate => candidate.path === record.path)
      let workspace = existing
      let created = false
      if (workspace === undefined) {
        try {
          workspace = await this.registry.create(record.path, record.title)
          created = true
        } catch (error) {
          return { ok: false, code: 'workspace/create-failed', message: describeError(error).message }
        }
      }

      /** @type {Array<{ sessionId: string, name?: string, message: string }>} */
      const failures = []
      const attached = []
      // attachSession prepends; reverse iteration restores the stored order.
      for (const sessionId of [...record.sessionIds].reverse()) {
        try {
          await workspace.attachSession(sessionId)
          attached.push(sessionId)
        } catch (error) {
          failures.push({ sessionId, ...describeError(error) })
        }
      }

      // Only sessions archived by this run are unarchived; a session the user
      // had already archived must stay archived after restoring the workspace.
      const archivedByRun = new Set(record.archivedByRun ?? record.sessionIds)
      let unarchived = 0
      for (const sessionId of attached) {
        if (!archivedByRun.has(sessionId)) continue
        try {
          await this.registry.unarchiveSession(sessionId)
          unarchived += 1
        } catch (error) {
          failures.push({ sessionId, ...describeError(error) })
        }
      }

      if (created && record.anchor !== undefined && this.registry.get(record.anchor) !== undefined) {
        try {
          await this.registry.insertBefore(workspace.id, record.anchor)
        } catch (error) {
          this.logger.warn?.('[workspace-archiver] workspace restored but order restore failed:', error)
        }
      }

      try {
        await this.store.remove(hiddenId)
      } catch (error) {
        // The workspace is already visible; a stale record would only offer a
        // harmless second restore, so keep the successful result.
        this.logger.warn?.('[workspace-archiver] workspace restored but hidden record cleanup failed:', error)
      }

      return { ok: true, workspaceId: workspace.id, attached: attached.length, unarchived, failures }
    })
  }
}
