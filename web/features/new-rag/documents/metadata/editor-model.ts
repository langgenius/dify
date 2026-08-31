import type { KnowledgeFsMetadataField } from '@/service/knowledge-fs/metadata'

export type DocumentMetadataField = KnowledgeFsMetadataField
export type DocumentMetadataType = DocumentMetadataField['type']
export type DocumentMetadataNameError = 'duplicate' | 'empty' | 'invalid' | 'tooLong'

const reservedDocumentMetadataNames = new Set([
  'displayName',
  'provenance',
  'retrievalCount',
  'sourceName',
  'system',
])

export function isEditableDocumentMetadata(name: string) {
  return !reservedDocumentMetadataNames.has(name)
}

export function documentMetadataNameError(
  name: string,
  fields: readonly DocumentMetadataField[],
  currentName?: string,
): DocumentMetadataNameError | undefined {
  const trimmedName = name.trim()
  if (!trimmedName) return 'empty'
  if (trimmedName.length > 255) return 'tooLong'
  if (reservedDocumentMetadataNames.has(trimmedName)) return 'invalid'
  if (!/^[a-z][a-z0-9_]*$/.test(trimmedName)) return 'invalid'
  if (trimmedName !== currentName && fields.some((field) => field.name === trimmedName))
    return 'duplicate'
  return undefined
}

export function documentMetadataType(value: unknown): DocumentMetadataType {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value))
    return 'time'
  return typeof value === 'number' ? 'number' : 'string'
}

export function documentMetadataDefaultValue(type: DocumentMetadataType): string | number {
  if (type === 'number') return 0
  if (type === 'time') return new Date().toISOString()
  return ''
}

export function editableDocumentMetadataEntries(metadata: Record<string, unknown>) {
  return Object.entries(metadata).filter(([name]) => isEditableDocumentMetadata(name))
}
