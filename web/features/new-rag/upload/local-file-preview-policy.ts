import { documentUploadFileExtension } from './policy'

const LOCAL_TEXT_PREVIEW_EXTENSIONS = new Set([
  'csv',
  'htm',
  'html',
  'json',
  'jsonl',
  'markdown',
  'md',
  'text',
  'txt',
])

export function canPreviewLocalFile(file: File) {
  const extension = documentUploadFileExtension(file.name)
  return extension === 'pdf' || LOCAL_TEXT_PREVIEW_EXTENSIONS.has(extension)
}
