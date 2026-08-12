import { documentUploadFileExtension } from './document-upload-policy'

const LOCAL_PREVIEW_MIME_TYPES = new Map([
  ['html', 'text/plain;charset=utf-8'],
  ['markdown', 'text/plain;charset=utf-8'],
  ['md', 'text/plain;charset=utf-8'],
  ['pdf', 'application/pdf'],
  ['txt', 'text/plain;charset=utf-8'],
])
const LOCAL_PREVIEW_URL_LIFETIME_MS = 60_000

export function canPreviewLocalFile(file: File) {
  return LOCAL_PREVIEW_MIME_TYPES.has(documentUploadFileExtension(file.name))
}

export function openLocalFilePreview(file: File) {
  const previewMimeType = LOCAL_PREVIEW_MIME_TYPES.get(documentUploadFileExtension(file.name))
  if (!previewMimeType) return

  const previewUrl = URL.createObjectURL(file.slice(0, file.size, previewMimeType))
  globalThis.open(previewUrl, '_blank', 'noopener,noreferrer')
  globalThis.setTimeout(() => URL.revokeObjectURL(previewUrl), LOCAL_PREVIEW_URL_LIFETIME_MS)
}
