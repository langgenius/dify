import type { KnowledgeFsMetadataFieldResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { consoleQuery } from '@/service/client'

export type DocumentMetadataType = 'string' | 'number' | 'time'
export type DocumentMetadataNameError = 'duplicate' | 'empty' | 'invalid' | 'tooLong'

export type DocumentMetadataField = {
  count: number
  createdAt: string
  id: string
  name: string
  rowVersion: number
  type: DocumentMetadataType
  updatedAt: string
}

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

export function documentMetadataFieldFromApi(
  field: KnowledgeFsMetadataFieldResponse,
): DocumentMetadataField {
  return {
    count: field.count,
    createdAt: field.created_at,
    id: field.id,
    name: field.name,
    rowVersion: field.row_version,
    type: field.type,
    updatedAt: field.updated_at,
  }
}

export function documentMetadataFieldsQueryOptions(knowledgeSpaceId: string) {
  return {
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.metadata.get.queryOptions({
      context: { silent: true },
      input: {
        params: { control_space_id: knowledgeSpaceId },
        query: { limit: 100 },
      },
      retry: false,
    }),
    select: (response: { data: KnowledgeFsMetadataFieldResponse[] }) =>
      response.data.map(documentMetadataFieldFromApi),
    staleTime: 30_000,
  }
}
