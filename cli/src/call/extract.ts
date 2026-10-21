import type { UnzipFileInfo } from 'fflate'
import type { Stats } from 'node:fs'
import type { FolderLimits } from './files'
import { lstat, mkdir, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { unzipSync } from 'fflate'
import { CALL_FLAG } from '@/call/flags'
import { BaseError, unknownError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { CREATE_ONLY, ERRNO, errnoOf } from '@/sys/fs'
import { BYTES_PER_MIB } from './files'

// Zip entry names use `/` on every platform.
const ZIP_SEPARATOR = '/'
const UNSAFE_SEGMENTS: ReadonlySet<string> = new Set(['', '.', '..'])
const UNSAFE_CHARACTERS: readonly string[] = ['\\', '\0']
const DRIVE_PREFIX = /^[a-z]:/i
const LISTED_CLASHES = 5
const EXTRACT_HINT = `pass --${CALL_FLAG.Extract} <path> naming a new folder`

export type ExtractOptions = {
  readonly bytes: Uint8Array
  readonly target: string
  readonly limits: FolderLimits
  readonly signal: AbortSignal
}

export type ExtractReceipt = {
  readonly path: string
  readonly files: number
  readonly size: number
}

type ZipFile = { readonly path: string; readonly bytes: Uint8Array }

type Unpacked = {
  // Every folder the files need, parents before children.
  readonly folders: readonly string[]
  readonly files: readonly ZipFile[]
}

type Created = { readonly path: string; readonly isFolder: boolean }

// `stat` follows a link and `lstat` does not; each call site picks one.
type ReadStats = (path: string) => Promise<Stats>

function badZip(message: string, cause?: unknown): BaseError {
  return new BaseError({ code: ErrorCode.ServerError, message, cause })
}

function usage(message: string): BaseError {
  return new BaseError({ code: ErrorCode.UsageInvalidFlag, message, hint: EXTRACT_HINT })
}

function isSafePath(path: string): boolean {
  if (DRIVE_PREFIX.test(path) || UNSAFE_CHARACTERS.some((c) => path.includes(c))) return false
  return !path.split(ZIP_SEPARATOR).some((segment) => UNSAFE_SEGMENTS.has(segment))
}

const folderOf = (name: string): string | undefined =>
  name.endsWith(ZIP_SEPARATOR) ? name.slice(0, -ZIP_SEPARATOR.length) : undefined

function ancestorsOf(path: string): string[] {
  const segments = path.split(ZIP_SEPARATOR)
  return segments.slice(1).map((_, i) => segments.slice(0, i + 1).join(ZIP_SEPARATOR))
}

async function statOrUndefined(read: ReadStats, path: string): Promise<Stats | undefined> {
  try {
    return await read(path)
  } catch (cause) {
    const code = errnoOf(cause)
    // Below a file there is nothing; the file itself is reported as the clash.
    if (code === ERRNO.NotFound || code === ERRNO.NotADirectory) return undefined
    throw unknownError(`cannot read ${path}`, cause)
  }
}

function unpack(bytes: Uint8Array, limits: FolderLimits): Unpacked {
  const maxBytes = limits.mebibytes * BYTES_PER_MIB
  // Case-folded so two names one file system would merge are caught on every system.
  const seen = new Set<string>()
  const names: string[] = []
  let fileCount = 0
  let size = 0
  // fflate calls this from its central directory, before it inflates the entry.
  const admit = (info: UnzipFileInfo): boolean => {
    const folder = folderOf(info.name)
    const path = folder ?? info.name
    if (!isSafePath(path)) throw badZip(`response zip has an unsafe entry name: ${info.name}`)
    const key = path.toLowerCase()
    if (seen.has(key)) throw badZip(`response zip has more than one entry named ${path}`)
    seen.add(key)
    names.push(info.name)
    if (folder !== undefined) return true
    fileCount += 1
    // A stored entry is copied by its compressed size, a deflated one into its declared size.
    size += Math.max(info.size, info.originalSize)
    if (fileCount > limits.files) throw badZip(`response zip has more than ${limits.files} files`)
    if (size > maxBytes) throw badZip(`response zip is larger than ${limits.mebibytes} MiB`)
    return true
  }

  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes, { filter: admit })
  } catch (cause) {
    if (cause instanceof BaseError) throw cause
    throw badZip('response is not a valid zip archive', cause)
  }

  const folders = new Set<string>()
  const files: ZipFile[] = []
  for (const name of names) {
    // fflate collects entries on a plain object, where a name like `__proto__` is lost.
    const content = Object.hasOwn(entries, name) ? entries[name] : undefined
    if (content === undefined) throw badZip(`response zip entry ${name} could not be read`)
    const folder = folderOf(name)
    const path = folder ?? name
    for (const ancestor of ancestorsOf(path)) folders.add(ancestor)
    if (folder !== undefined) folders.add(folder)
    else files.push({ path, bytes: content })
  }
  const filePaths = new Set(files.map((file) => file.path.toLowerCase()))
  const both = [...folders].find((folder) => filePaths.has(folder.toLowerCase()))
  if (both !== undefined) throw badZip(`response zip uses ${both} as both a file and a folder`)
  return { folders: [...folders].sort(), files }
}

// A folder may already be there; anything else in its place, a link included, is a clash.
async function clashesIn(target: string, unpacked: Unpacked): Promise<string[]> {
  const found: string[] = []
  for (const folder of unpacked.folders) {
    const stats = await statOrUndefined(lstat, join(target, folder))
    if (stats !== undefined && !stats.isDirectory()) found.push(folder)
  }
  for (const file of unpacked.files) {
    if ((await statOrUndefined(lstat, join(target, file.path))) !== undefined) found.push(file.path)
  }
  return found
}

/** Refuses a target that cannot hold the files, before the request is sent. */
export async function assertExtractTarget(path: string): Promise<void> {
  const target = resolve(path)
  const stats = await statOrUndefined(stat, target)
  if (stats !== undefined) {
    if (!stats.isDirectory()) throw usage(`${target} is not a folder; not extracting into it`)
    return
  }
  if (!(await statOrUndefined(stat, dirname(target)))?.isDirectory())
    throw usage(`the folder that would hold ${target} does not exist`)
}

// Resolves to whether this call made the folder; one already there is left alone.
async function makeFolder(path: string, read: ReadStats): Promise<boolean> {
  try {
    await mkdir(path)
    return true
  } catch (cause) {
    if (errnoOf(cause) === ERRNO.Exists && (await read(path)).isDirectory()) return false
    throw cause
  }
}

// Only what this run created goes; a folder someone else filled meanwhile stays.
async function undo(created: readonly Created[]): Promise<void> {
  for (const entry of [...created].reverse()) {
    await (entry.isFolder ? rmdir(entry.path) : rm(entry.path, { force: true })).catch(
      () => undefined,
    )
  }
}

/**
 * Unzips one level into `target`, creating it if it is missing. Nothing already there
 * is replaced: a clash refuses the whole zip before any write, and a failure removes
 * only what this run wrote.
 */
export async function extractZip(options: ExtractOptions): Promise<ExtractReceipt> {
  const target = resolve(options.target)
  await assertExtractTarget(target)
  const unpacked = unpack(options.bytes, options.limits)
  const clashes = await clashesIn(target, unpacked)
  if (clashes.length > 0) {
    const listed = clashes.slice(0, LISTED_CLASHES).join(', ')
    const more =
      clashes.length > LISTED_CLASHES ? ` and ${clashes.length - LISTED_CLASHES} more` : ''
    throw usage(`${target} already has ${listed}${more}; not extracting into it`)
  }

  const created: Created[] = []
  let size = 0
  try {
    // The target may be a link the caller chose; links inside it are never followed.
    if (await makeFolder(target, stat)) created.push({ path: target, isFolder: true })
    for (const folder of unpacked.folders) {
      const path = join(target, folder)
      if (await makeFolder(path, lstat)) created.push({ path, isFolder: true })
    }
    for (const file of unpacked.files) {
      if (options.signal.aborted)
        throw unknownError(`cancelled; removed what was extracted into ${target}`)
      const path = join(target, file.path)
      await writeFile(path, file.bytes, { flag: CREATE_ONLY })
      created.push({ path, isFolder: false })
      size += file.bytes.byteLength
    }
  } catch (cause) {
    await undo(created)
    if (cause instanceof BaseError) throw cause
    throw unknownError(`failed to extract into ${target}`, cause)
  }
  return { path: target, files: unpacked.files.length, size }
}
