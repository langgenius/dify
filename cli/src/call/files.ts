import type { FileReader, FolderLister } from './request'
import { readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { inputInvalid } from '@/call/errors'
import { ENTRY_KIND, walkTree } from '@/sys/tree'

const JUNK_FILES: ReadonlySet<string> = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])
const JUNK_DIRS: ReadonlySet<string> = new Set(['__MACOSX'])

export const readLocalFile: FileReader = async (path) => ({
  bytes: await readFile(path),
  name: basename(path),
})

function isJunk(path: string): boolean {
  const segments = path.split('/')
  return (
    JUNK_FILES.has(segments.at(-1) ?? '') ||
    segments.slice(0, -1).some((segment) => JUNK_DIRS.has(segment))
  )
}

export const listLocalFolder: FolderLister = async (path) => {
  const info = await stat(path).catch(() => undefined)
  if (info === undefined || !info.isDirectory()) return undefined
  const entries = await walkTree(path).catch((cause: unknown) => {
    throw inputInvalid(`cannot read folder "${path}"`, cause)
  })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.kind === ENTRY_KIND.Symlink) {
      throw inputInvalid(
        `"${join(path, entry.path)}" is a symlink; folders sent as input cannot contain symlinks`,
      )
    }
    if (entry.kind === ENTRY_KIND.File && !isJunk(entry.path)) files.push(entry.path)
  }
  return files.sort()
}

export const LOCAL_FILES = { readFile: readLocalFile, listFolder: listLocalFolder } as const
