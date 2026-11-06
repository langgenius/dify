import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

export const ENTRY_KIND = {
  File: 'file',
  Directory: 'directory',
  Symlink: 'symlink',
  Other: 'other',
} as const

export type EntryKind = (typeof ENTRY_KIND)[keyof typeof ENTRY_KIND]

export type TreeEntry = {
  readonly path: string
  readonly kind: EntryKind
}

export const KEY_SEPARATOR = '/'

function kindOf(entry: Dirent): EntryKind {
  if (entry.isSymbolicLink()) return ENTRY_KIND.Symlink
  if (entry.isFile()) return ENTRY_KIND.File
  if (entry.isDirectory()) return ENTRY_KIND.Directory
  return ENTRY_KIND.Other
}

// No `recursive` readdir: Bun follows symlinked directories there, so a link
// loop hangs or fails with ELOOP. Walking by hand never descends into a link.
async function* walkInto(dir: string, prefix: string): AsyncGenerator<TreeEntry> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}${KEY_SEPARATOR}${entry.name}`
    const kind = kindOf(entry)
    yield { path, kind }
    if (kind === ENTRY_KIND.Directory) yield* walkInto(join(dir, entry.name), path)
  }
}

/** Yields one directory at a time, so a caller that stops early stops the walk. */
export function walkTree(root: string): AsyncIterable<TreeEntry> {
  return walkInto(root, '')
}
