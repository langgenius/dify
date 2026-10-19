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

const KEY_SEPARATOR = '/'

function kindOf(entry: Dirent): EntryKind {
  if (entry.isSymbolicLink()) return ENTRY_KIND.Symlink
  if (entry.isFile()) return ENTRY_KIND.File
  if (entry.isDirectory()) return ENTRY_KIND.Directory
  return ENTRY_KIND.Other
}

// No `recursive` readdir: Bun follows symlinked directories there, so a link
// loop hangs or fails with ELOOP. Walking by hand never descends into a link.
async function walkInto(dir: string, prefix: string, out: TreeEntry[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}${KEY_SEPARATOR}${entry.name}`
    const kind = kindOf(entry)
    out.push({ path, kind })
    if (kind === ENTRY_KIND.Directory) await walkInto(join(dir, entry.name), path, out)
  }
}

export async function walkTree(root: string): Promise<readonly TreeEntry[]> {
  const out: TreeEntry[] = []
  await walkInto(root, '', out)
  return out
}
