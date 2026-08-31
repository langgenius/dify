import { debounce, parseAsString, parseAsStringLiteral } from 'nuqs'

export const documentFilterParser = parseAsStringLiteral([
  'all',
  'ready',
  'queued',
  'processing',
  'failed',
  'disabled',
] as const)
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
