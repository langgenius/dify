import type { SourceDisplayStatus } from './source-models'
import { debounce, parseAsString, parseAsStringLiteral } from 'nuqs'

export type SourceFilter = SourceDisplayStatus | 'all'

export const sourceFilterParser = parseAsStringLiteral([
  'all',
  'active',
  'initializing',
  'syncing',
  'disabled',
  'error',
] as const)
  .withDefault('all')
  .withOptions({ history: 'push' })

export const sourceSearchParser = parseAsString.withDefault('').withOptions({
  limitUrlUpdates: debounce(300),
})

export const sourceSortParser = parseAsStringLiteral([
  'name-asc',
  'name-desc',
] as const).withOptions({
  history: 'push',
})
