const DOCUMENT_UPLOAD_MAX_BYTES = 15 * 1024 * 1024

const DOCUMENT_UPLOAD_EXTENSIONS = [
  'csv',
  'doc',
  'docx',
  'eml',
  'epub',
  'htm',
  'html',
  'json',
  'jsonl',
  'markdown',
  'md',
  'mdx',
  'msg',
  'odt',
  'pdf',
  'ppt',
  'pptx',
  'properties',
  'rtf',
  'text',
  'txt',
  'vtt',
  'xls',
  'xlsx',
  'xml',
] as const

const documentUploadExtensionSet = new Set<string>(DOCUMENT_UPLOAD_EXTENSIONS)

export const DOCUMENT_UPLOAD_ACCEPT = DOCUMENT_UPLOAD_EXTENSIONS.map(
  (extension) => `.${extension}`,
).join(',')

export type DocumentUploadIssue = 'fileEmpty' | 'fileSize' | 'fileType'

export function documentUploadFingerprint(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`
}

export function uniqueDocumentUploadFiles(current: File[], candidates: File[]) {
  const fingerprints = new Set(current.map(documentUploadFingerprint))
  return candidates.filter((file) => {
    const fingerprint = documentUploadFingerprint(file)
    if (fingerprints.has(fingerprint)) return false
    fingerprints.add(fingerprint)
    return true
  })
}

export function documentUploadFileExtension(name: string) {
  const normalizedName = name.trim().toLocaleLowerCase()
  const dotIndex = normalizedName.lastIndexOf('.')
  return dotIndex >= 0 && dotIndex < normalizedName.length - 1
    ? normalizedName.slice(dotIndex + 1)
    : ''
}

export function documentUploadIssue(file: File): DocumentUploadIssue | undefined {
  if (file.size === 0) return 'fileEmpty'
  if (file.size > DOCUMENT_UPLOAD_MAX_BYTES) return 'fileSize'
  if (!documentUploadExtensionSet.has(documentUploadFileExtension(file.name))) return 'fileType'
}
