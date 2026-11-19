/**
 * dsh-workspace-archiver — browser half, zero-build bundle.
 *
 * Archives a workspace row: every unarchived session of the workspace is
 * archived, then the workspace registration is removed, so the row actually
 * leaves the sidebar. DSH has no workspace-level archive API; removing the
 * registration is the only public operation that makes the row disappear.
 *
 * The two steps use official seams:
 * - `ctx.uiWorkspace.archiveSession` — the same UI service the shipped archive
 *   button calls; it also clears the conversation panel when the archived
 *   Session is open.
 * - `ctx.workspaces.delete` — the Client face of the shipped **Delete
 *   workspace** action; the Host keeps the directory and every session log.
 *
 * Order matters: sessions are archived first. If any archive is refused (a
 * running session, a missing permission), the workspace is left in place and
 * the notice reports how many sessions blocked the action. Only a fully
 * archived workspace is removed, so a failed run can never leave unarchived
 * sessions stranded under Ungrouped.
 *
 * Limits (also in README):
 * - The registration cannot be hidden in place, so this is a one-way archive.
 *   Re-adding the directory creates a new, empty workspace; old sessions stay
 *   archived and fall under Ungrouped if unarchived. Membership is not
 *   restored by any public Client API.
 * - Sessions with running work are refused, not stopped. DSH's own per-session
 *   archive flow asks the user to confirm stopping work; this bundle does not
 *   stop it silently.
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
 * @property {boolean} [danger]
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
 * @property {{
 *   list: { getSnapshot(): WorkspaceSnapshot, subscribe(listener: () => void): () => void },
 *   delete(workspaceId: string): Promise<void>,
 * }} workspaces
 * @property {{ archiveSession(id: string, options?: { stopActivity?: boolean }): Promise<void> }} uiWorkspace
 * @property {{
 *   register(contribution: WorkspaceMenuContribution): () => void,
 *   notify(text: string, success?: boolean): void,
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
      'menu.hide': 'Hide this workspace',
      'menu.archive.one': 'Archive and hide this workspace (1 session)',
      'menu.archive.other': 'Archive and hide this workspace ({n} sessions)',
      'toast.hidden': 'Workspace hidden; its directory and session logs are kept',
      'toast.archived.one': 'Archived 1 session and hid the workspace; its directory and logs are kept',
      'toast.archived.other': 'Archived {n} sessions and hid the workspace; its directory and logs are kept',
      'toast.blocked': 'Workspace not hidden: {n} session(s) could not be archived (still running?)',
      'toast.removeFailed': 'Sessions were archived, but removing the workspace registration failed',
    }

    /** @type {Record<string, string>} */
    const zh = {
      'menu.hide': '隐藏此工作区',
      'menu.archive.one': '归档并隐藏此工作区（1 个会话）',
      'menu.archive.other': '归档并隐藏此工作区（{n} 个会话）',
      'toast.hidden': '已隐藏工作区；目录与会话日志保留',
      'toast.archived.one': '已归档 1 个会话并隐藏工作区；目录与日志保留',
      'toast.archived.other': '已归档 {n} 个会话并隐藏工作区；目录与日志保留',
      'toast.blocked': '未隐藏工作区：{n} 个会话未能归档（可能仍在运行）',
      'toast.removeFailed': '会话已归档，但移除工作区注册失败',
    }

    /**
     * One archive run per workspace at a time. A second click while the first
     * run still awaits the Host would archive/delete twice; the duplicate is
     * dropped instead.
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
          // Archived sessions are already hidden from the default view; only
          // the remaining ones decide how much work the action performs.
          const archived = new Set(snapshot.archivedSessionIds)
          const sessionIds = workspace.sessionIds.filter(id => !archived.has(id))
          return [{
            id: 'archive-workspace',
            danger: true,
            label: sessionIds.length === 0
              ? t('menu.hide')
              : t(sessionIds.length === 1 ? 'menu.archive.one' : 'menu.archive.other', { n: sessionIds.length }),
            run: () => archiveWorkspace(ctx, t, workspaceId, sessionIds),
          }]
        },
      }
    }

    /**
     * Archive every remaining session, then remove the workspace registration.
     *
     * The registration is removed only when every archive succeeded: a failed
     * archive must not leave unarchived sessions stranded under Ungrouped. Each
     * refusal is logged with its session id; the notice carries the count.
     * @param {ClientContext} ctx
     * @param {Translate} t
     * @param {string} workspaceId
     * @param {readonly string[]} sessionIds
     */
    async function archiveWorkspace(ctx, t, workspaceId, sessionIds) {
      if (inFlight.has(workspaceId)) return
      inFlight.add(workspaceId)
      try {
        /** @type {Array<{ sessionId: string, reason: unknown }>} */
        const failures = []
        let archived = 0
        for (const sessionId of sessionIds) {
          try {
            // No `stopActivity`: the Host refuses a busy Session instead of
            // interrupting it. Stopping work is a per-session confirmation in
            // DSH's own archive flow, not something a bulk click should do.
            await ctx.uiWorkspace.archiveSession(sessionId)
            archived += 1
          } catch (reason) {
            failures.push({ sessionId, reason })
          }
        }
        for (const failure of failures) {
          console.warn(`[workspace-archiver] could not archive ${failure.sessionId}:`, failure.reason)
        }
        if (failures.length > 0) {
          ctx.contextMenus.notify(t('toast.blocked', { n: failures.length }), false)
          return
        }
        try {
          await ctx.workspaces.delete(workspaceId)
        } catch (reason) {
          console.warn('[workspace-archiver] could not remove the workspace registration:', reason)
          ctx.contextMenus.notify(t('toast.removeFailed'), false)
          return
        }
        ctx.contextMenus.notify(
          archived === 0
            ? t('toast.hidden')
            : t(archived === 1 ? 'toast.archived.one' : 'toast.archived.other', { n: archived }),
          true,
        )
      } finally {
        inFlight.delete(workspaceId)
      }
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
