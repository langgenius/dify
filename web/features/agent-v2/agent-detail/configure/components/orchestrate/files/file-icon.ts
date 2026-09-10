import type { FileTreeIconType } from '@langgenius/dify-ui/file-tree'

const codeFileExtensions = new Set([
  'css',
  'go',
  'html',
  'js',
  'jsx',
  'py',
  'rb',
  'rs',
  'scss',
  'sh',
  'ts',
  'tsx',
  'vue',
  'yaml',
  'yml',
])
const tableFileExtensions = new Set(['csv', 'xls', 'xlsx'])
const archiveFileExtensions = new Set(['7z', 'gz', 'rar', 'tar', 'zip'])
const imageFileExtensions = new Set([
  'apng',
  'avif',
  'bmp',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
])
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

function getFileExtension(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

export function getFileIconType(fileName: string, mimeType?: string | null): FileTreeIconType {
  const extension = getFileExtension(fileName)

  if (mimeType?.startsWith('image/') || imageFileExtensions.has(extension)) return 'image'
  if (mimeType === 'application/pdf' || extension === 'pdf') return 'pdf'
  if (extension === 'md' || extension === 'markdown' || extension === 'mdx') return 'markdown'
  if (extension === 'json') return 'json'
  if (tableFileExtensions.has(extension)) return 'table'
  if (archiveFileExtensions.has(extension)) return 'archive'
  if (codeFileExtensions.has(extension)) return 'code'
  if (mimeType?.startsWith('text/')) return 'text'

  return 'file'
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
