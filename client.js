/**
 * dsh-workspace-archiver — browser half, zero-build bundle.
 *
 * Registers one structured action on a workspace row's context menu through
 * `ctx.contextMenus`. DSH 0.2.2-rc.5 exposes no `sidebar.workspaces.menu.item`
 * and no `ctx.ui` service; the workspace row dispatches `{ kind: 'workspace' }`
 * itself (`dsh-client-ui-workspace/src/client/rows/Rows.tsx`), so a contribution
 * for that target appears in the row's `…` menu and on right-click without a
 * component of ours.
 *
 * A click runs in the Client tree, so it cannot call Host services. Archive and
 * restore use the official UI seam `ctx.uiWorkspace` — the same service the
 * shipped archive button calls. It delegates to the Workspace Controller, which
 * reaches the Host through the generated `workspace/archiveSession` Remote and
 * lands on `workspaceRegistry.archiveSession` behind the normal permission
 * checks; it also clears the conversation panel when the archived Session is
 * the open one. State reads use `ctx.workspaces.list`.
 *
 * Deliberate limits:
 * - Sessions with running work are refused, not stopped, and counted in the
 *   notice; DSH's own archive flow asks the user to confirm that per Session.
 * - The workspace row remains after every member is archived: DSH derives one
 *   group per registered workspace (`dsh-client-ui-workspace/src/client/tree.ts`,
 *   `groupByWorkspace`), so this action clears the session list, not the folder.
 *
 * Everything lives inside `factory` on purpose: combo responses concatenate
 * several bundle scripts, so a bundle must not add top-level bindings.
 */

/**
 * @typedef {(key: string, params?: Record<string, unknown>) => string} Translate
 *
 * @typedef {object} WorkspaceSnapshot
 * @property {ReadonlyArray<{ workspaceId: string, sessionIds: readonly string[] }>} items
 * @property {readonly string[]} archivedSessionIds
 *
 * @typedef {object} MenuAction
 * @property {string} id
 * @property {string} label
 * @property {() => void | Promise<void>} [run]
 *
 * @typedef {object} WorkspaceMenuContribution
 * @property {string} id
 * @property {'workspace'} target
 * @property {number} order
 * @property {(target: { workspaceId: string }) => readonly unknown[]} [observe]
 * @property {(target: { workspaceId: string }) => readonly MenuAction[]} resolve
 *
 * @typedef {object} ClientContext
 * @property {(callback: () => any, label?: string) => any} effect
 * @property {{ list: { getSnapshot(): WorkspaceSnapshot, subscribe(listener: () => void): () => void } }} workspaces
 * @property {{ archiveSession(id: string, options?: { stopActivity?: boolean }): Promise<void>, unarchiveSession(id: string): Promise<void> }} uiWorkspace
 * @property {{
 *   register(contribution: WorkspaceMenuContribution): () => void,
 *   notify(text: string, success?: boolean, action?: {
 *     label: string,
 *     run: () => void | Promise<void>,
 *     failureLabel: string,
 *   }): void,
 * }} contextMenus
 * @property {{
 *   bind(ns: string): Translate,
 *   register(ns: string, dicts: Record<string, Record<string, string>>): () => void,
 *   getSnapshot(): unknown,
 *   subscribe(listener: () => void): () => void,
 * }} locale
 */

window.__ModuleLoader__.load({
  id: 'dsh-workspace-archiver',
  factory() {
    const PLUGIN_ID = 'dsh-workspace-archiver'
    const NS = 'workspace-archiver'

    /** Ascending menu order: after Rename (100), before Delete (300). */
    const MENU_ORDER = 200

    /**
     * Copy registered through `ctx.locale`. Chinese defines the key set; the
     * English dictionary must carry the same keys.
     * @type {Record<string, string>}
     */
    const en = {
      'menu.archive.one': 'Archive the session in this workspace',
      'menu.archive.other': 'Archive {n} sessions in this workspace',
      'toast.archived.one': 'Archived 1 session',
      'toast.archived.other': 'Archived {n} sessions',
      'toast.partial': 'Archived {n} of {total} sessions; {skipped} still running or failed',
      'toast.none': 'Nothing was archived; {skipped} session(s) still running or failed',
      'toast.undo': 'Undo',
      'toast.undoFailed': 'Could not undo the archive',
    }

    /** @type {Record<string, string>} */
    const zh = {
      'menu.archive.one': '归档此工作区中的会话',
      'menu.archive.other': '归档此工作区中的 {n} 个会话',
      'toast.archived.one': '已归档 1 个会话',
      'toast.archived.other': '已归档 {n} 个会话',
      'toast.partial': '已归档 {n}/{total} 个会话；{skipped} 个仍在运行或归档失败',
      'toast.none': '未归档任何会话；{skipped} 个仍在运行或归档失败',
      'toast.undo': '撤销',
      'toast.undoFailed': '撤销归档失败',
    }

    /**
     * One archive run per workspace at a time. A second click while the first
     * run still awaits the Host would archive the same ids again: idempotent,
     * but it would post a second notice and a second undo.
     * @type {Set<string>}
     */
    const inFlight = new Set()

    /**
     * Build the contribution. `observe` re-resolves the item when the archive
     * set or the language changes while the menu is open.
     * @param {ClientContext} ctx
     * @param {Translate} t
     * @returns {WorkspaceMenuContribution}
     */
    function createContribution(ctx, t) {
      return {
        id: `${PLUGIN_ID}.archive-workspace`,
        target: 'workspace',
        order: MENU_ORDER,
        observe: () => [ctx.workspaces.list, ctx.locale],
        resolve: ({ workspaceId }) => {
          const snapshot = ctx.workspaces.list.getSnapshot()
          const workspace = snapshot.items.find(item => item.workspaceId === workspaceId)
          if (workspace === undefined) return []
          // Archived sessions are already hidden from the default view;
          // counting them again would promise work the action will not do.
          const archived = new Set(snapshot.archivedSessionIds)
          const sessionIds = workspace.sessionIds.filter(id => !archived.has(id))
          if (sessionIds.length === 0) return []
          return [{
            id: 'archive-workspace',
            label: t(sessionIds.length === 1 ? 'menu.archive.one' : 'menu.archive.other', { n: sessionIds.length }),
            run: () => archiveWorkspaceSessions(ctx, t, workspaceId, sessionIds),
          }]
        },
      }
    }

    /**
     * Archive every candidate, one Remote call at a time.
     *
     * Sequential on purpose: each `workspace/archiveSession` reply carries the
     * complete archive set, and the Client model installs only the newest reply
     * (`archiveRequestSeq` in `dsh-api-workspace-controller/client/model.ts`).
     * Parallel calls make that projection depend on reply order; `await`
     * removes the question and bounds the work sent to one Host.
     *
     * Failures are collected, never thrown out of the click handler: a running
     * Session refuses with `workspace/session-active` and must not abort the
     * rest. Details go to the console; the notice carries counts and Undo.
     * @param {ClientContext} ctx
     * @param {Translate} t
     * @param {string} workspaceId
     * @param {readonly string[]} sessionIds
     */
    async function archiveWorkspaceSessions(ctx, t, workspaceId, sessionIds) {
      if (inFlight.has(workspaceId)) return
      inFlight.add(workspaceId)
      try {
        /** @type {string[]} */
        const archived = []
        /** @type {Array<{ sessionId: string, reason: unknown }>} */
        const failures = []
        for (const sessionId of sessionIds) {
          try {
            // No `stopActivity`: the Host refuses a busy Session instead of
            // interrupting it. Bulk-stopping running work is exactly the step
            // DSH asks the user to confirm per Session.
            await ctx.uiWorkspace.archiveSession(sessionId)
            archived.push(sessionId)
          } catch (reason) {
            failures.push({ sessionId, reason })
          }
        }
        for (const failure of failures) {
          console.warn(`[workspace-archiver] could not archive ${failure.sessionId}:`, failure.reason)
        }
        if (archived.length === 0) {
          ctx.contextMenus.notify(t('toast.none', { skipped: failures.length }), false)
          return
        }
        ctx.contextMenus.notify(
          failures.length === 0
            ? t(archived.length === 1 ? 'toast.archived.one' : 'toast.archived.other', { n: archived.length })
            : t('toast.partial', { n: archived.length, total: sessionIds.length, skipped: failures.length }),
          true,
          {
            label: t('toast.undo'),
            failureLabel: t('toast.undoFailed'),
            run: () => unarchiveAll(ctx, archived),
          },
        )
      } finally {
        inFlight.delete(workspaceId)
      }
    }

    /**
     * Undo one run by unarchiving exactly the ids that run archived. Every id
     * is attempted before the first failure is rethrown, so one missing entry
     * cannot strand the rest of the batch.
     * @param {ClientContext} ctx
     * @param {readonly string[]} sessionIds
     */
    async function unarchiveAll(ctx, sessionIds) {
      /** @type {unknown} */
      let firstFailure
      for (const sessionId of sessionIds) {
        try {
          await ctx.uiWorkspace.unarchiveSession(sessionId)
        } catch (reason) {
          firstFailure ??= reason
        }
      }
      if (firstFailure !== undefined) throw firstFailure
    }

    return {
      name: PLUGIN_ID,
      inject: ['contextMenus', 'workspaces', 'uiWorkspace', 'locale'],
      /**
       * @param {ClientContext} ctx
       */
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(
          () => ctx.locale.register(NS, { en, zh }),
          `${PLUGIN_ID}: dictionaries`,
        )
        ctx.effect(
          () => ctx.contextMenus.register(createContribution(ctx, t)),
          `${PLUGIN_ID}: workspace menu`,
        )
      },
    }
  },
})
