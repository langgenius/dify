import type { DocumentMetadataType } from '../../metadata/editor-model'
import type { LogicalDocument } from '../../models'
import { atom } from 'jotai'
import { documentMetadataType, editableDocumentMetadataEntries } from '../../metadata/editor-model'

export type MetadataDraft = {
  id: string
  name: string
  type: DocumentMetadataType
  value: string
}

type MetadataEditBaseline = {
  metadata: LogicalDocument['userMetadata']
  rowVersion: number
}

type MetadataEditorState = {
  baseline?: MetadataEditBaseline
  drafts: MetadataDraft[]
  editing: boolean
  retryableCreateName?: string
}

type MetadataField = {
  name: string
  type: DocumentMetadataType
}

type StartMetadataEditing = {
  document: LogicalDocument
  fields: readonly MetadataField[]
}

type CreatedMetadataField = {
  document: LogicalDocument
  name: string
  type: DocumentMetadataType
  value: unknown
}

function metadataValueForInput(value: unknown, type: DocumentMetadataType) {
  if (type === 'time' && typeof value === 'string') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) {
      const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
      return localDate.toISOString().slice(0, 16)
    }
  }
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (value === undefined || value === null) return ''
  return JSON.stringify(value)
}

function metadataDrafts(document: LogicalDocument, fields: readonly MetadataField[]) {
  const fieldTypes = new Map(fields.map((field) => [field.name, field.type]))
  return editableDocumentMetadataEntries(document.userMetadata)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => {
      const type = fieldTypes.get(name) ?? documentMetadataType(value)
      return {
        id: `field-${name}`,
        name,
        type,
        value: metadataValueForInput(value, type),
      }
    })
}

const initialMetadataEditorState: MetadataEditorState = {
  drafts: [],
  editing: false,
}

const metadataEditorStateAtom = atom(initialMetadataEditorState)

export const metadataEditorScopedAtoms = [metadataEditorStateAtom] as const

export const metadataDraftsAtom = atom((get) => get(metadataEditorStateAtom).drafts)
export const metadataEditingAtom = atom((get) => get(metadataEditorStateAtom).editing)
export const metadataEditBaselineAtom = atom((get) => get(metadataEditorStateAtom).baseline)
export const metadataRetryableCreateNameAtom = atom(
  (get) => get(metadataEditorStateAtom).retryableCreateName,
)

export const startMetadataEditingAtom = atom(
  null,
  (_get, set, { document, fields }: StartMetadataEditing) => {
    set(metadataEditorStateAtom, {
      baseline: { metadata: document.userMetadata, rowVersion: document.rowVersion },
      drafts: metadataDrafts(document, fields),
      editing: true,
    })
  },
)

export const cancelMetadataEditingAtom = atom(null, (_get, set) => {
  set(metadataEditorStateAtom, initialMetadataEditorState)
})

export const selectMetadataFieldAtom = atom(null, (get, set, field: MetadataField) => {
  const current = get(metadataEditorStateAtom)
  if (current.drafts.some((draft) => draft.name === field.name)) return
  set(metadataEditorStateAtom, {
    ...current,
    drafts: [
      ...current.drafts,
      { id: `field-${field.name}`, name: field.name, type: field.type, value: '' },
    ],
  })
})

export const removeMetadataDraftAtom = atom(null, (get, set, draftId: string) => {
  const current = get(metadataEditorStateAtom)
  set(metadataEditorStateAtom, {
    ...current,
    drafts: current.drafts.filter((draft) => draft.id !== draftId),
  })
})

export const updateMetadataDraftValueAtom = atom(
  null,
  (get, set, { draftId, value }: { draftId: string; value: string }) => {
    const current = get(metadataEditorStateAtom)
    set(metadataEditorStateAtom, {
      ...current,
      drafts: current.drafts.map((draft) => (draft.id === draftId ? { ...draft, value } : draft)),
    })
  },
)

export const markMetadataCreateRetryableAtom = atom(null, (get, set, name: string) => {
  set(metadataEditorStateAtom, { ...get(metadataEditorStateAtom), retryableCreateName: name })
})

export const recordCreatedMetadataFieldAtom = atom(
  null,
  (get, set, { document, name, type, value }: CreatedMetadataField) => {
    const current = get(metadataEditorStateAtom)
    set(metadataEditorStateAtom, {
      ...current,
      baseline: { metadata: document.userMetadata, rowVersion: document.rowVersion },
      drafts: current.drafts.some((draft) => draft.name === name)
        ? current.drafts
        : [
            ...current.drafts,
            { id: `field-${name}`, name, type, value: metadataValueForInput(value, type) },
          ],
      retryableCreateName: undefined,
    })
  },
)
