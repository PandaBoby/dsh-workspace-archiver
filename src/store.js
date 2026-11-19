/**
 * Durable hidden-workspace records.
 *
 * The workspace registry has no hidden state: removing a workspace deletes its
 * whole record, including `sessionIds`. This store keeps the membership needed
 * to restore it, next to the DSH home rather than inside the registry.
 *
 * The file contains workspace paths, titles, and session ids; it never contains
 * credentials. Writes are serialized and replaced atomically so a crash cannot
 * leave half a JSON document behind.
 */
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * @typedef {object} HiddenWorkspace
 * @property {string} id - Hidden-record id, independent of the workspace id.
 * @property {string} workspaceId - Workspace id that was removed.
 * @property {string} path - Absolute workspace directory.
 * @property {string} title - Workspace title at archive time.
 * @property {readonly string[]} sessionIds - Member sessions in display order.
 * @property {readonly string[]} [archivedByRun] - Sessions this run archived; older records may omit it.
 * @property {string} [anchor] - Workspace id that followed it, for order restore.
 * @property {string} createdAt - ISO timestamp.
 */

/**
 * Default location under the DSH home. `$DSH_HOME` wins when set, matching the
 * harness's own home resolution; otherwise `~/.dsh`.
 * @returns {string} absolute path to the hidden-record file.
 */
export function defaultHiddenFile() {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'workspace-archiver', 'hidden.json')
}

/**
 * @param {unknown} value
 * @returns {value is HiddenWorkspace}
 */
function isHiddenWorkspace(value) {
  if (value === null || typeof value !== 'object') return false
  const record = /** @type {Record<string, unknown>} */ (value)
  return typeof record.id === 'string'
    && typeof record.workspaceId === 'string'
    && typeof record.path === 'string'
    && typeof record.title === 'string'
    && Array.isArray(record.sessionIds)
    && record.sessionIds.every(id => typeof id === 'string')
    && (record.archivedByRun === undefined
      || (Array.isArray(record.archivedByRun) && record.archivedByRun.every(id => typeof id === 'string')))
    && typeof record.createdAt === 'string'
    && (record.anchor === undefined || typeof record.anchor === 'string')
}

/**
 * Open one hidden-record file. Reads are cached after the first successful
 * load; every mutation writes the complete array through a serialized queue.
 * @param {string} file - absolute JSON file path.
 * @param {{ warn: (...args: unknown[]) => void }} [logger] - diagnostics sink.
 * @returns the store.
 */
export function createHiddenStore(file, logger = console) {
  /** @type {HiddenWorkspace[] | undefined} */
  let cache
  /** @type {Promise<unknown>} */
  let tail = Promise.resolve()

  /** @returns {Promise<HiddenWorkspace[]>} */
  async function load() {
    if (cache !== undefined) return cache
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'))
      cache = Array.isArray(parsed) ? parsed.filter(isHiddenWorkspace) : []
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error)?.code !== 'ENOENT') {
        logger.warn('[workspace-archiver] could not read hidden workspaces; starting empty:', error)
      }
      cache = []
    }
    return cache
  }

  /** @param {HiddenWorkspace[]} records */
  async function write(records) {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 })
    const temporary = `${file}.tmp-${process.pid}`
    await writeFile(temporary, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, file)
    await chmod(file, 0o600)
    cache = records
  }

  /**
   * Serialize one mutation behind the previous one.
   * @template T
   * @param {() => Promise<T>} operation
   * @returns {Promise<T>}
   */
  function serialize(operation) {
    const result = tail.then(operation, operation)
    tail = result.then(() => undefined, () => undefined)
    return result
  }

  return {
    /** @returns {Promise<HiddenWorkspace[]>} */
    async list() {
      return [...await load()]
    },

    /**
     * @param {string} id
     * @returns {Promise<HiddenWorkspace | undefined>}
     */
    async get(id) {
      return (await load()).find(record => record.id === id)
    },

    /**
     * @param {HiddenWorkspace} record
     * @returns {Promise<HiddenWorkspace>}
     */
    add(record) {
      return serialize(async () => {
        const records = await load()
        await write([...records.filter(candidate => candidate.id !== record.id), record])
        return record
      })
    },

    /**
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    remove(id) {
      return serialize(async () => {
        const records = await load()
        const next = records.filter(candidate => candidate.id !== id)
        if (next.length === records.length) return false
        await write(next)
        return true
      })
    },
  }
}
