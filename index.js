/**
 * dsh-workspace-archiver — Host half.
 *
 * Makes "archive a workspace" reversible:
 *
 * 1. archive every member session through `workspaceRegistry`;
 * 2. persist the workspace path, title, order anchor, and session ids;
 * 3. remove the registration so the sidebar row disappears;
 * 4. on restore, recreate the workspace, reattach the stored sessions with
 *    `Workspace.attachSession`, unarchive them, and restore its order.
 *
 * The browser half calls the authenticated routes; the `/workspace-archiver`
 * slash command is the fallback when every workspace row is hidden. The hidden
 * record file lives under the DSH home and contains no credentials.
 */
import { WorkspaceArchiver } from './src/archiver.js'
import { createWorkspaceArchiverCommand } from './src/command.js'
import { registerWorkspaceArchiverRoutes } from './src/routes.js'
import { createHiddenStore, defaultHiddenFile } from './src/store.js'

/** Plugin name used in Loader logs. */
export const name = 'workspace-archiver'

/** Services the Host half needs: routes, the registry, and the command surface. */
export const inject = ['connection', 'workspaceRegistry', 'commands']

/**
 * Mount the archiver and its two entry points.
 * @param {object} ctx Host context with the injected services.
 * @param {{ hiddenFile?: string }} [config] optional override for tests or a
 * custom DSH home; the bundle patch normally leaves it unset.
 */
export function apply(ctx, config) {
  const hiddenFile = typeof config?.hiddenFile === 'string' && config.hiddenFile !== ''
    ? config.hiddenFile
    : defaultHiddenFile()
  const store = createHiddenStore(hiddenFile, ctx.logger ?? console)
  const archiver = new WorkspaceArchiver(ctx.workspaceRegistry, store, ctx.logger ?? console)

  ctx.effect(
    () => registerWorkspaceArchiverRoutes(ctx.connection, archiver, ctx.logger ?? console),
    'workspace-archiver: browser routes',
  )
  ctx.effect(
    () => ctx.commands.register(createWorkspaceArchiverCommand(archiver)),
    'workspace-archiver: slash command',
  )
}
