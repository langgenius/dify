import type { CatalogDoc, CatalogOp } from './types'
import { createHash } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import { dirname, join } from 'node:path'
import { BaseError, notLoggedIn } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { errorMessage } from '@/errors/message'
import { definePlugin } from '@/kernel/plugin'
import { env } from '@/plugins/env'
import { io } from '@/plugins/io'
import { session } from '@/plugins/session'
import { pid, resolvePlatform } from '@/sys'
import { bareHost } from '@/util/host'
import { BINARY } from '@/version/info'
import { parseCatalog } from './types'

export const CATALOG_DIR_NAME = 'catalog'
const HOST_SEPARATOR_REPLACEMENT = '_'
const FILE_MODE = 0o600
const DIR_MODE = 0o700
const UNREADABLE_CACHE_PREFIX = 'ignoring unreadable catalog cache '
const ENOENT = 'ENOENT'

export type { CatalogDoc, CatalogOp, Example, JsonSchema } from './types'
export { CATALOG_HEADER, CATALOG_PATH, parseCatalog } from './types'

export type CatalogService = {
  readonly path: string
  readonly loaded: boolean
  readonly fingerprint: string
  readonly op: (id: string) => CatalogOp | undefined
  readonly opOrThrow: (id: string) => CatalogOp
  readonly ops: () => Readonly<Record<string, CatalogOp>>
  readonly replace: (bytes: Uint8Array) => Promise<void>
  readonly clear: () => Promise<void>
}

export function fingerprintOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function cachePath(cacheDir: string, server: string): string {
  const key = bareHost(server).split(':').join(HOST_SEPARATOR_REPLACEMENT)
  return join(cacheDir, CATALOG_DIR_NAME, `${key}.json`)
}

function isMissingFile(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === ENOENT
}

// The cache is a file two processes may race on, so it is replaced rather than
// rewritten in place: a reader either sees the whole old document or the whole new one.
async function writeAtomically(path: string, bytes: Uint8Array): Promise<void> {
  const tmp = `${path}.tmp.${pid()}.${Date.now()}`
  try {
    await fsp.mkdir(dirname(path), { recursive: true, mode: DIR_MODE })
    await fsp.writeFile(tmp, bytes, { mode: FILE_MODE })
    resolvePlatform().atomicReplace(tmp, path)
  } catch (cause) {
    try {
      await fsp.unlink(tmp)
    } catch {
      /* tmp may never have been created */
    }
    throw new BaseError({
      code: ErrorCode.Unknown,
      message: `failed to write the catalog cache ${path}`,
      cause,
    })
  }
}

export const catalog = definePlugin({
  name: 'catalog',
  needs: [env, session, io],
  build: async (ctx): Promise<CatalogService> => {
    const { cacheDir } = await ctx.get(env)
    const sessionService = await ctx.get(session)
    const login = await sessionService.current()
    const path = login === null ? undefined : cachePath(cacheDir, login.server)

    let bytes: Uint8Array | undefined
    let doc: CatalogDoc | undefined

    if (path !== undefined) {
      try {
        bytes = await fsp.readFile(path)
        doc = parseCatalog(bytes)
      } catch (err) {
        // A cache this build cannot read is a miss, not a dead end: the next
        // fetch replaces it. Only a file that was never there stays silent.
        bytes = undefined
        doc = undefined
        if (!isMissingFile(err)) {
          const out = await ctx.get(io)
          out.notice(`${UNREADABLE_CACHE_PREFIX}${path}: ${errorMessage(err)}`)
        }
      }
    }

    return {
      get path(): string {
        if (path === undefined) throw notLoggedIn()
        return path
      },
      get loaded(): boolean {
        return doc !== undefined
      },
      get fingerprint(): string {
        return bytes === undefined ? '' : fingerprintOf(bytes)
      },
      op: (id: string) => doc?.ops[id],
      opOrThrow: (id: string) => {
        const op = doc?.ops[id]
        if (op !== undefined) return op
        throw new BaseError({
          code: ErrorCode.UnknownOp,
          message: `unknown op "${id}"`,
          hint: `run ${BINARY} ops`,
        })
      },
      ops: () => doc?.ops ?? {},
      replace: async (newBytes: Uint8Array) => {
        if (path === undefined) throw notLoggedIn()
        const parsed = parseCatalog(newBytes)
        await writeAtomically(path, newBytes)
        bytes = newBytes
        doc = parsed
      },
      clear: async () => {
        if (path === undefined) throw notLoggedIn()
        try {
          await fsp.unlink(path)
        } catch (err) {
          if (!isMissingFile(err)) throw err
        }
        bytes = undefined
        doc = undefined
      },
    }
  },
})
