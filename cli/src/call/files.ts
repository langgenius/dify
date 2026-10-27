import type { FileDeps, FileReader, FolderCheck, FolderLister } from './request'
import { readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { inputInvalid } from '@/call/errors'
import { BaseError } from '@/errors/base'
import { ENTRY_KIND, KEY_SEPARATOR, walkTree } from '@/sys/tree'

const JUNK_FILES: ReadonlySet<string> = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])
const JUNK_DIRS: ReadonlySet<string> = new Set(['__MACOSX'])
const BYTES_PER_MIB = 1024 * 1024

export type FolderLimits = {
  readonly files: number
  readonly mebibytes: number
}

// Same as the server's App package defaults (AGENT_PACKAGE_MAX_ENTRIES,
// AGENT_PACKAGE_MAX_BYTES): anything larger would be rejected after upload.
export const FOLDER_LIMITS: FolderLimits = { files: 5000, mebibytes: 512 }

export const readLocalFile: FileReader = async (path) => ({
  bytes: await readFile(path),
  name: basename(path),
})

export const isLocalFolder: FolderCheck = async (path) =>
  (await stat(path).catch(() => undefined))?.isDirectory() === true

function isJunk(path: string): boolean {
  const segments = path.split(KEY_SEPARATOR)
  const name = segments.pop()
  return (
    (name !== undefined && JUNK_FILES.has(name)) ||
    segments.some((segment) => JUNK_DIRS.has(segment))
  )
}

function failedPath(cause: unknown): string | undefined {
  const path = (cause as NodeJS.ErrnoException | undefined)?.path
  return typeof path === 'string' ? path : undefined
}

export function folderLister(limits: FolderLimits): FolderLister {
  const maxBytes = limits.mebibytes * BYTES_PER_MIB
  return async (path) => {
    const files: string[] = []
    let bytes = 0
    try {
      for await (const entry of walkTree(path)) {
        if (entry.kind === ENTRY_KIND.Symlink) {
          throw inputInvalid(
            `"${join(path, entry.path)}" is a symlink; folders sent as input cannot contain symlinks`,
          )
        }
        if (entry.kind !== ENTRY_KIND.File || isJunk(entry.path)) continue
        files.push(entry.path)
        if (files.length > limits.files)
          throw inputInvalid(`folder "${path}" has more than ${limits.files} files`)
        bytes += (await stat(join(path, entry.path))).size
        if (bytes > maxBytes)
          throw inputInvalid(`folder "${path}" is larger than ${limits.mebibytes} MiB`)
      }
    } catch (cause) {
      if (cause instanceof BaseError) throw cause
      throw inputInvalid(`cannot read folder "${failedPath(cause) ?? path}"`, cause)
    }
    return files.sort()
  }
}

export const listLocalFolder: FolderLister = folderLister(FOLDER_LIMITS)

export const LOCAL_FILES: FileDeps = {
  readFile: readLocalFile,
  isFolder: isLocalFolder,
  listFolder: listLocalFolder,
}
