import type { inferParserType } from 'nuqs'
import {
  createSerializer,
  debounce,
  parseAsArrayOf,
  parseAsString,
  parseAsStringLiteral,
} from 'nuqs'
import { SNIPPET_LIST_SEARCH_DEBOUNCE_MS } from './constants'

export const snippetListQueryParsers = {
  creatorIDs: parseAsArrayOf(parseAsString, ';').withDefault([]),
  tagIDs: parseAsArrayOf(parseAsString, ';').withDefault([]).withOptions({ history: 'push' }),
  publishStatus: parseAsStringLiteral(['all', 'published', 'draft']).withDefault('all'),
  keywords: parseAsString.withDefault('').withOptions({
    limitUrlUpdates: debounce(SNIPPET_LIST_SEARCH_DEBOUNCE_MS),
  }),
}

export const serializeSnippetListQuery = createSerializer(snippetListQueryParsers)
export type SnippetPublishStatus = inferParserType<typeof snippetListQueryParsers>['publishStatus']
