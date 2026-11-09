import type { FileDeps, FileReader, FolderCheck, FolderLister } from './request'
import { readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { inputInvalid } from '@/call/errors'
import { BaseError } from '@/errors/base'
import { ENTRY_KIND, KEY_SEPARATOR, walkTree } from '@/sys/tree'

const JUNK_FILES: ReadonlySet<string> = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])
const JUNK_DIRS: ReadonlySet<string> = new Set(['__MACOSX'])

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

export const listLocalFolder: FolderLister = async (path) => {
  const files: string[] = []
  try {
    for await (const entry of walkTree(path)) {
      if (entry.kind === ENTRY_KIND.Symlink) {
        throw inputInvalid(
          `"${join(path, entry.path)}" is a symlink; folders sent as input cannot contain symlinks`,
        )
      }
      if (entry.kind !== ENTRY_KIND.File || isJunk(entry.path)) continue
      files.push(entry.path)
    }
  } catch (cause) {
    if (cause instanceof BaseError) throw cause
    throw inputInvalid(`cannot read folder "${failedPath(cause) ?? path}"`, cause)
  }
  return files.sort()
}

export const LOCAL_FILES: FileDeps = {
  readFile: readLocalFile,
  isFolder: isLocalFolder,
  listFolder: listLocalFolder,
}
