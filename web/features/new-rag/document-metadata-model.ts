import type { LogicalDocument } from './document-models'
import { consoleClient } from '@/service/client'
import { logicalDocumentFromApi, logicalDocumentListFromApi } from './document-models'

export type DocumentMetadataType = 'string' | 'number' | 'time'
export type DocumentMetadataNameError = 'duplicate' | 'empty' | 'invalid' | 'tooLong'

export type DocumentMetadataField = {
  count: number
  name: string
  type: DocumentMetadataType
}

const reservedDocumentMetadataNames = new Set(['displayName', 'retrievalCount', 'sourceName'])

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

export function documentMetadataFieldsFromDocuments(
  documents: LogicalDocument[],
): DocumentMetadataField[] {
  const fields = new Map<
    string,
    DocumentMetadataField & {
      typeInferredFromEmptyValue: boolean
    }
  >()

  for (const document of documents) {
    for (const [name, value] of editableDocumentMetadataEntries(document.userMetadata)) {
      if (value === null || value === undefined) continue
      const current = fields.get(name)
      const typeInferredFromEmptyValue = value === ''
      fields.set(name, {
        count: (current?.count ?? 0) + 1,
        name,
        type:
          current && !current.typeInferredFromEmptyValue
            ? current.type
            : documentMetadataType(value),
        typeInferredFromEmptyValue:
          Boolean(current?.typeInferredFromEmptyValue ?? true) && typeInferredFromEmptyValue,
      })
    }
  }

  return [...fields.values()]
    .map(({ count, name, type }) => ({ count, name, type }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export async function listAllLogicalDocuments(knowledgeSpaceId: string) {
  const documents: LogicalDocument[] = []
  let cursor: string | undefined

  do {
    const response = await consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get({
      params: { control_space_id: knowledgeSpaceId },
      query: cursor ? { cursor } : {},
    })
    const page = logicalDocumentListFromApi(response)
    documents.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)

  return documents
}

export type DocumentMetadataPatchTarget = {
  document: LogicalDocument
  patch: Record<string, unknown>
}

export async function patchDocumentMetadataTargets(
  controlSpaceId: string,
  targets: DocumentMetadataPatchTarget[],
) {
  const failures: Array<{ document: LogicalDocument; reason: unknown }> = []
  const updatedDocuments = new Map<string, LogicalDocument>()

  for (let index = 0; index < targets.length; index += 5) {
    const batch = targets.slice(index, index + 5)
    const results = await Promise.allSettled(
      batch.map(({ document, patch }) =>
        consoleClient.knowledgeFs.spaces.byControlSpaceId.documents.byDocumentId.patch({
          body: { expectedRowVersion: document.rowVersion, patch },
          params: {
            control_space_id: controlSpaceId,
            document_id: document.id,
          },
        }),
      ),
    )

    results.forEach((result, resultIndex) => {
      const target = batch[resultIndex]
      if (!target) return
      const { document } = target
      if (result.status === 'fulfilled')
        updatedDocuments.set(document.id, logicalDocumentFromApi(result.value))
      else failures.push({ document, reason: result.reason })
    })
  }

  return { failures, updatedDocuments }
}

export function documentMetadataDocumentsQueryOptions(knowledgeSpaceId: string) {
  return {
    queryFn: () => listAllLogicalDocuments(knowledgeSpaceId),
    queryKey: ['new-rag', 'document-metadata-documents', knowledgeSpaceId] as const,
    staleTime: 30_000,
  }
}
