/**
 * `/workspace-archiver` — the fallback entry when every workspace row is
 * hidden, so the workspace-row restore submenu has no row to anchor on.
 *
 * It runs against the receiving agent without creating a model message; the
 * Host adapter renders the result in the transcript. No attachments.
 */

/**
 * @param {import('./archiver.js').WorkspaceArchiver} archiver
 * @returns {object} command definition accepted by `ctx.commands.register`.
 */
export function createWorkspaceArchiverCommand(archiver) {
  return {
    name: 'workspace-archiver',
    description: 'List or restore archived workspaces',
    input: { hint: '[restore <id|index>]' },
    handler: async ({ rawInput }) => {
      const input = rawInput.trim()
      const { hidden } = await archiver.state()

      if (input === '' || input === 'list') {
        if (hidden.length === 0) {
          return { kind: 'success', text: 'No archived workspaces.' }
        }
        const lines = hidden.map((record, index) => (
          `${index + 1}. ${record.title || record.path} — ${record.path} `
          + `(${record.sessionCount} session${record.sessionCount === 1 ? '' : 's'}) `
          + `[${record.id}]`
        ))
        return {
          kind: 'success',
          text: `Archived workspaces:\n${lines.join('\n')}\n\nRestore with /workspace-archiver restore <id|index>.`,
        }
      }

      const match = /^restore\s+(\S+)$/u.exec(input)
      if (match === null) {
        return {
          kind: 'error',
          text: 'Usage: /workspace-archiver [list | restore <id|index>]',
        }
      }

      const target = match[1]
      const index = /^\d+$/u.test(target) ? Number(target) : undefined
      const record = index === undefined
        ? hidden.find(candidate => candidate.id === target)
        : hidden[index - 1]
      if (record === undefined) {
        return { kind: 'error', text: `No archived workspace matches "${target}".` }
      }

      const result = await archiver.restore(record.id)
      if (!result.ok) {
        return { kind: 'error', text: `Restore failed: ${result.code}${result.message === undefined ? '' : ` (${result.message})`}` }
      }
      const failed = result.failures.length
      const text = failed === 0
        ? `Restored "${record.title || record.path}" with ${result.attached} session${result.attached === 1 ? '' : 's'}.`
        : `Restored "${record.title || record.path}"; ${result.attached} session${result.attached === 1 ? '' : 's'} reattached, `
          + `${failed} could not be restored (their logs are kept).`
      return { kind: 'success', text }
    },
  }
}
