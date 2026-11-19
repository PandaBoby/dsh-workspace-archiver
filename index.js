/**
 * dsh-workspace-archiver — Host half.
 *
 * The feature is entirely in the browser half. A sidebar menu click executes in
 * the Client tree, which cannot see Host services; the Client action calls
 * `ctx.uiWorkspace.archiveSession`, the official UI-facing seam. That delegates
 * to the Workspace Controller, which the Host serves through the generated
 * `workspace/archiveSession` Remote, landing on
 * `workspaceRegistry.archiveSession`.
 *
 * No `inject` here on purpose: an empty Host half that injects
 * `workspaceRegistry` would wait for a service it never touches. If you extend
 * this plugin with a Host-side entry point (for example an agent tool), declare
 * the service and walk `registry.list()` / `registry.archiveSession(id)` in one
 * loop; `registry.unarchiveSession(id)` exists for the reverse direction.
 *
 * This module exists because a bundle row mounts the package, and the browser
 * bundle is discovered from that package's `dsh.client` manifest.
 */

/** Plugin name used in Loader logs. */
export const name = 'workspace-archiver'

/** Activation hook. The Host half registers nothing. */
export function apply() {}
