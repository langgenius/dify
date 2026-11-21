import type { FileTreeIconType } from '@langgenius/dify-ui/file-tree'
import { getFileIconType } from '@/utils/file-icon'

const driveFileIconTypes: ReadonlySet<string> = new Set([
  'archive',
  'code',
  'database',
  'file',
  'folder',
  'image',
  'json',
  'markdown',
  'pdf',
  'table',
  'text',
] satisfies FileTreeIconType[])

function isFileTreeIconType(value: string): value is FileTreeIconType {
  return driveFileIconTypes.has(value)
}

export function getDriveFileIconType({
  fileKind,
  fileName,
  mimeType,
}: {
  fileKind?: string | null
  fileName: string
  mimeType?: string | null
}): FileTreeIconType {
  const normalizedFileKind = fileKind?.toLowerCase()

  if (normalizedFileKind === 'directory') return 'folder'

  if (normalizedFileKind && isFileTreeIconType(normalizedFileKind)) return normalizedFileKind

  return getFileIconType(fileName, mimeType)
}
