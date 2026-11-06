import { debounce, parseAsString, parseAsStringLiteral } from 'nuqs'

export const DOCUMENT_FILTERS = [
  'all',
  'ready',
  'queued',
  'processing',
  'failed',
  'disabled',
] as const

export type DocumentFilter = (typeof DOCUMENT_FILTERS)[number]

export const documentFilterParser = parseAsStringLiteral(DOCUMENT_FILTERS)
  .withDefault('all')
  .withOptions({ history: 'push' })

export const documentSearchParser = parseAsString.withDefault('').withOptions({
  limitUrlUpdates: debounce(300),
})

export const documentUploadParser = parseAsStringLiteral(['1'] as const).withOptions({
  history: 'replace',
})

export const documentMetadataParser = parseAsStringLiteral(['1'] as const).withOptions({
  history: 'replace',
})
