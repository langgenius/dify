const DOCUMENT_UPLOAD_MAX_BYTES = 15 * 1024 * 1024

const DOCUMENT_UPLOAD_EXTENSIONS = [
  'csv',
  'doc',
  'docx',
  'epub',
  'htm',
  'html',
  'json',
  'jsonl',
  'md',
  'pdf',
  'ppt',
  'pptx',
  'rtf',
  'text',
  'txt',
  'xls',
  'xlsx',
] as const

const documentUploadExtensionSet = new Set<string>(DOCUMENT_UPLOAD_EXTENSIONS)

export const DOCUMENT_UPLOAD_ACCEPT = DOCUMENT_UPLOAD_EXTENSIONS.map(
  (extension) => `.${extension}`,
).join(',')

export type DocumentUploadIssue = 'fileSize' | 'fileType'

export function documentUploadFileExtension(name: string) {
  const normalizedName = name.trim().toLocaleLowerCase()
  const dotIndex = normalizedName.lastIndexOf('.')
  return dotIndex >= 0 && dotIndex < normalizedName.length - 1
    ? normalizedName.slice(dotIndex + 1)
    : ''
}

export function documentUploadIssue(file: File): DocumentUploadIssue | undefined {
  if (file.size > DOCUMENT_UPLOAD_MAX_BYTES) return 'fileSize'
  if (!documentUploadExtensionSet.has(documentUploadFileExtension(file.name))) return 'fileType'
}
