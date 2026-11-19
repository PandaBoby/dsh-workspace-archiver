/**
 * Authenticated browser routes for the workspace archiver.
 *
 * `connection.fetch.register` is the same Host Fetch surface the credential
 * settings routes use: the Connection layer owns Host/Origin checks and browser
 * authentication before the request reaches these handlers. The routes add no
 * separate token handling, and they are not model-visible.
 *
 * The handler never returns session contents or the hidden file path; state
 * carries titles, workspace paths, counts, and opaque hidden ids.
 */

const STATE_PATH = '/api/workspace-archiver/state'
const ACTION_PATH = '/api/workspace-archiver/action'

/**
 * @param {unknown} value
 * @param {number} [status]
 * @returns {Response}
 */
function json(value, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

/**
 * @param {{ ok: boolean, code?: string }} result
 * @returns {number}
 */
function archiveStatus(result) {
  if (result.ok) return 200
  if (result.code === 'workspace/not-found') return 404
  if (result.code === 'workspace/blocked') return 409
  return 500
}

/**
 * @param {{ ok: boolean, code?: string }} result
 * @returns {number}
 */
function restoreStatus(result) {
  if (result.ok) return 200
  if (result.code === 'hidden/not-found') return 404
  if (result.code === 'workspace/create-failed') return 409
  return 500
}

/**
 * Register the two exact routes.
 * @param {{ fetch?: { register?: (route: object) => () => Promise<void> } }} connection
 * @param {import('./archiver.js').WorkspaceArchiver} archiver
 * @param {{ warn: (...args: unknown[]) => void }} [logger]
 * @returns {() => void} cleanup for the owning effect.
 */
export function registerWorkspaceArchiverRoutes(connection, archiver, logger = console) {
  const register = connection?.fetch?.register
  if (typeof register !== 'function') return () => {}

  const disposeState = register({
    path: STATE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      try {
        return json(await archiver.state())
      } catch (error) {
        logger.warn?.('[workspace-archiver] state route failed:', error)
        return json({ ok: false, code: 'internal', message: String(error instanceof Error ? error.message : error) }, 500)
      }
    },
  })

  const disposeAction = register({
    path: ACTION_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      /** @type {Record<string, unknown>} */
      let payload
      try {
        payload = await request.json()
      } catch {
        return json({ ok: false, code: 'bad-json', message: 'request body must be JSON' }, 400)
      }
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        return json({ ok: false, code: 'bad-json', message: 'request body must be a JSON object' }, 400)
      }

      try {
        if (payload.action === 'archive') {
          if (typeof payload.workspaceId !== 'string' || payload.workspaceId === '') {
            return json({ ok: false, code: 'bad-request', message: 'workspaceId is required' }, 400)
          }
          const result = await archiver.archive(payload.workspaceId)
          return json(result, archiveStatus(result))
        }
        if (payload.action === 'restore') {
          if (typeof payload.hiddenId !== 'string' || payload.hiddenId === '') {
            return json({ ok: false, code: 'bad-request', message: 'hiddenId is required' }, 400)
          }
          const result = await archiver.restore(payload.hiddenId)
          return json(result, restoreStatus(result))
        }
        return json({
          ok: false,
          code: 'bad-action',
          message: 'action must be "archive" or "restore"',
        }, 400)
      } catch (error) {
        logger.warn?.('[workspace-archiver] action route failed:', error)
        return json({ ok: false, code: 'internal', message: String(error instanceof Error ? error.message : error) }, 500)
      }
    },
  })

  return () => {
    void disposeState()
    void disposeAction()
  }
}
