/**
 * dsh-workspace-archiver — browser half, zero-build bundle.
 *
 * Adds a workspace-level archive action and a restore submenu to a workspace
 * row's context menu:
 *
 * - **Archive and hide** posts to the Host route. The Host archives every
 *   member session, persists the membership, then removes the workspace
 *   registration; the row disappears. A blocked session leaves the workspace in
 *   place, so no unarchived session is stranded.
 * - **Restore archived workspace** lists Host-held hidden records and recreates
 *   the row, reattaching the stored sessions in the Host. The submenu lives on
 *   any visible workspace row; when every row is hidden, the Host command
 *   `/workspace-archiver` lists and restores them.
 *
 * The browser never touches `workspaceRegistry` or the session store: the
 * authenticated Host route owns the operation. The Client reads workspace rows
 * and archive state from `ctx.workspaces.list`, copy from `ctx.locale`, and
 * shows results through `ctx.contextMenus`.
 *
 * Everything lives inside `factory` on purpose: combo responses concatenate
 * several bundle scripts, so a bundle must not add top-level bindings.
 */

/**
 * @typedef {(key: string, params?: Record<string, unknown>) => string} Translate
 *
 * @typedef {object} WorkspaceSnapshot
 * @property {ReadonlyArray<{ workspaceId: string, path: string, sessionIds: readonly string[] }>} items
 * @property {readonly string[]} archivedSessionIds
 *
 * @typedef {object} MenuAction
 * @property {string} id
 * @property {string} label
 * @property {boolean} [danger]
 * @property {boolean} [separatorBefore]
 * @property {readonly MenuAction[]} [children]
 * @property {() => void | Promise<void>} [run]
 *
 * @typedef {object} WorkspaceMenuContribution
 * @property {string} id
 * @property {'workspace'} target
 * @property {number} order
 * @property {(target: { workspaceId: string }) => readonly unknown[]} [observe]
 * @property {(target: { workspaceId: string }, signal: AbortSignal) => Promise<readonly MenuAction[]>} resolve
 *
 * @typedef {object} HiddenSummary
 * @property {string} id
 * @property {string} title
 * @property {string} path
 * @property {number} sessionCount
 *
 * @typedef {object} ClientContext
 * @property {(callback: () => any, label?: string) => any} effect
 * @property {{ list: { getSnapshot(): WorkspaceSnapshot, subscribe(listener: () => void): () => void } }} workspaces
 * @property {{ list: { getSnapshot(): { byId: Record<string, { id: string, retainedBy?: { mainView?: number } }> } } }} sessions
 * @property {{ archiveSession(id: string): Promise<void> }} uiWorkspace
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
    const STATE_PATH = '/api/workspace-archiver/state'
    const ACTION_PATH = '/api/workspace-archiver/action'

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
      'menu.restore': 'Restore archived workspace ({n})',
      'menu.restoreItem': '{title} ({n} sessions)',
      'toast.hidden': 'Workspace hidden; its directory, logs, and restore record are kept',
      'toast.archived.one': 'Archived 1 session and hid the workspace; restore it from a workspace menu',
      'toast.archived.other': 'Archived {n} sessions and hid the workspace; restore it from a workspace menu',
      'toast.blocked': 'Workspace not hidden: {n} session(s) could not be archived (still running?)',
      'toast.notFound': 'The workspace is no longer available; reload the page',
      'toast.failed': 'The workspace operation failed; see the console for details',
      'toast.restored': 'Workspace restored with {n} session(s)',
      'toast.restoredPartial': 'Workspace restored with {n} session(s); {m} could not be reattached',
      'toast.restoreFailed': 'Restoring the workspace failed; see the console for details',
    }

    /** @type {Record<string, string>} */
    const zh = {
      'menu.hide': '隐藏此工作区',
      'menu.archive.one': '归档并隐藏此工作区（1 个会话）',
      'menu.archive.other': '归档并隐藏此工作区（{n} 个会话）',
      'menu.restore': '恢复已归档工作区（{n}）',
      'menu.restoreItem': '{title}（{n} 个会话）',
      'toast.hidden': '已隐藏工作区；目录、日志与恢复记录保留',
      'toast.archived.one': '已归档 1 个会话并隐藏工作区；可在工作区菜单中恢复',
      'toast.archived.other': '已归档 {n} 个会话并隐藏工作区；可在工作区菜单中恢复',
      'toast.blocked': '未隐藏工作区：{n} 个会话未能归档（可能仍在运行）',
      'toast.notFound': '工作区已不存在，请刷新页面',
      'toast.failed': '工作区操作失败；详情见控制台',
      'toast.restored': '已恢复工作区，重新挂载 {n} 个会话',
      'toast.restoredPartial': '已恢复工作区并重新挂载 {n} 个会话；{m} 个未能挂回',
      'toast.restoreFailed': '恢复工作区失败；详情见控制台',
    }

    /** Prevent a duplicate click while one operation for the same target is pending. @type {Set<string>} */
    const busy = new Set()

    /**
     * @param {string} path
     * @param {object} [init]
     * @returns {Promise<{ response: Response, body: any }>}
     */
    async function requestJson(path, init) {
      const response = await fetch(path, {
        cache: 'no-store',
        headers: { accept: 'application/json' },
        ...init,
      })
      let body
      try {
        body = await response.json()
      } catch {
        body = undefined
      }
      return { response, body }
    }

    /**
     * @param {AbortSignal} [signal]
     * @returns {Promise<HiddenSummary[]>}
     */
    async function fetchHidden(signal) {
      const { response, body } = await requestJson(STATE_PATH, signal === undefined ? {} : { signal })
      if (!response.ok || body?.ok !== true || !Array.isArray(body.hidden)) {
        throw new Error(`workspace-archiver state failed (${response.status})`)
      }
      return body.hidden.filter(record => (
        record !== null
        && typeof record === 'object'
        && typeof record.id === 'string'
        && typeof record.title === 'string'
        && typeof record.path === 'string'
        && typeof record.sessionCount === 'number'
      ))
    }

    /**
     * @param {object} payload
     * @returns {Promise<{ response: Response, body: any }>}
     */
    function postAction(payload) {
      return requestJson(ACTION_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
      })
    }

    /**
     * @param {ClientContext} ctx
     * @param {Translate} t
     * @param {string} workspaceId
     * @param {readonly string[]} memberIds
     */
    async function archiveWorkspace(ctx, t, workspaceId, memberIds) {
      const key = `archive:${workspaceId}`
      if (busy.has(key)) return
      busy.add(key)
      try {
        const { response, body } = await postAction({ action: 'archive', workspaceId })
        if (!response.ok || body?.ok !== true) {
          if (body?.code === 'workspace/blocked') {
            const count = Array.isArray(body.failures) ? body.failures.length : 0
            ctx.contextMenus.notify(t('toast.blocked', { n: count }), false)
          } else if (body?.code === 'workspace/not-found') {
            ctx.contextMenus.notify(t('toast.notFound'), false)
          } else {
            ctx.contextMenus.notify(t('toast.failed'), false)
          }
          console.warn('[workspace-archiver] archive failed:', body)
          return
        }
        // The Host already archived every member. If the conversation panel is
        // showing one of them, ask the official UI service once so the panel
        // clears; the call is idempotent on an archived session.
        const current = Object.values(ctx.sessions.list.getSnapshot().byId)
          .find(session => (session.retainedBy?.mainView ?? 0) > 0)?.id
        if (current !== undefined && memberIds.includes(current)) {
          try {
            await ctx.uiWorkspace.archiveSession(current)
          } catch (error) {
            console.warn('[workspace-archiver] could not clear the open session view:', error)
          }
        }
        ctx.contextMenus.notify(
          body.archived === 0
            ? t('toast.hidden')
            : t(body.archived === 1 ? 'toast.archived.one' : 'toast.archived.other', { n: body.archived }),
          true,
        )
      } catch (error) {
        console.warn('[workspace-archiver] archive request failed:', error)
        ctx.contextMenus.notify(t('toast.failed'), false)
      } finally {
        busy.delete(key)
      }
    }

    /**
     * @param {ClientContext} ctx
     * @param {Translate} t
     * @param {HiddenSummary} record
     */
    async function restoreWorkspace(ctx, t, record) {
      const key = `restore:${record.id}`
      if (busy.has(key)) return
      busy.add(key)
      try {
        const { response, body } = await postAction({ action: 'restore', hiddenId: record.id })
        if (!response.ok || body?.ok !== true) {
          ctx.contextMenus.notify(t('toast.restoreFailed'), false)
          console.warn('[workspace-archiver] restore failed:', body)
          return
        }
        const failed = Array.isArray(body.failures) ? body.failures.length : 0
        ctx.contextMenus.notify(
          failed === 0
            ? t('toast.restored', { n: body.attached })
            : t('toast.restoredPartial', { n: body.attached, m: failed }),
          true,
        )
      } catch (error) {
        console.warn('[workspace-archiver] restore request failed:', error)
        ctx.contextMenus.notify(t('toast.restoreFailed'), false)
      } finally {
        busy.delete(key)
      }
    }

    /**
     * Build the contribution. `observe` re-resolves the item when the archive
     * set or the language changes while the menu is open. The restore submenu
     * refreshes from the Host route on every open, so a restore from another
     * surface is never stale.
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
        resolve: async ({ workspaceId }, signal) => {
          const snapshot = ctx.workspaces.list.getSnapshot()
          const workspace = snapshot.items.find(item => item.workspaceId === workspaceId)
          if (workspace === undefined) return []
          const archived = new Set(snapshot.archivedSessionIds)
          const sessionIds = workspace.sessionIds.filter(id => !archived.has(id))

          /** @type {MenuAction[]} */
          const actions = [{
            id: 'archive-workspace',
            danger: true,
            label: sessionIds.length === 0
              ? t('menu.hide')
              : t(sessionIds.length === 1 ? 'menu.archive.one' : 'menu.archive.other', { n: sessionIds.length }),
            run: () => archiveWorkspace(ctx, t, workspaceId, [...workspace.sessionIds]),
          }]

          let hidden = []
          try {
            hidden = await fetchHidden(signal)
          } catch (error) {
            // A missing/slow Host half must not remove the archive action; the
            // command fallback still lists hidden workspaces.
            if (signal.aborted) throw error
          }
          if (hidden.length > 0) {
            actions.push({
              id: 'restore-workspaces',
              label: t('menu.restore', { n: hidden.length }),
              separatorBefore: true,
              children: hidden.map(record => ({
                id: `restore:${record.id}`,
                label: t('menu.restoreItem', { title: record.title || record.path, n: record.sessionCount }),
                run: () => restoreWorkspace(ctx, t, record),
              })),
            })
          }
          return actions
        },
      }
    }

    return {
      name: PLUGIN_ID,
      inject: ['contextMenus', 'workspaces', 'sessions', 'uiWorkspace', 'locale'],
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
