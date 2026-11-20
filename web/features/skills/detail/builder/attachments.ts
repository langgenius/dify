export type SkillBuilderAttachment = {
  id: string
  mimeType: string
  name: string
  previewUrl?: string
  size: number
  toolFileId: string
}

export const skillBuilderMaxAttachments = 10

export const skillBuilderMaxAttachmentBytes = 15 * 1024 * 1024

export const skillBuilderMaxImageAttachmentBytes = 10 * 1024 * 1024

export const skillBuilderAttachmentAccept = [
  'image/*',
  'text/*',
  'application/json',
  'application/pdf',
  'application/rtf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv',
  '.json',
  '.md',
  '.markdown',
  '.pdf',
  '.rtf',
  '.txt',
  '.xls',
  '.xlsx',
  '.yaml',
  '.yml',
].join(',')

export function isAllowedSkillBuilderAttachment(file: File) {
  const mimeType = file.type
  if (mimeType.startsWith('audio/') || mimeType.startsWith('video/')) return false
  if (mimeType.startsWith('image/')) return true
  if (mimeType.startsWith('text/')) return true

  const allowedMimeTypes = new Set([
    'application/json',
    'application/pdf',
    'application/rtf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ])
  if (allowedMimeTypes.has(mimeType)) return true

  const lowerName = file.name.toLowerCase()
  return [
    '.csv',
    '.gif',
    '.jpeg',
    '.jpg',
    '.json',
    '.md',
    '.markdown',
    '.pdf',
    '.png',
    '.rtf',
    '.svg',
    '.txt',
    '.xls',
    '.xlsx',
    '.yaml',
    '.yml',
    '.webp',
  ].some((extension) => lowerName.endsWith(extension))
}
