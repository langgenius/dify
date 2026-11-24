import { zGetAgentQuery } from '@dify/contracts/api/console/agent/zod.gen'
import { debounce, parseAsArrayOf, parseAsBoolean, parseAsString, parseAsStringLiteral } from 'nuqs'
import { validate as isUuid } from 'uuid'
import { ROSTER_FILTER_VALUES } from './components/roster-filter'

export const rosterQueryParamNames = {
  keyword: 'keyword',
  filter: 'filter',
  tagIds: 'tag_ids',
  createdByMe: 'created_by_me',
  sortBy: 'sort_by',
} as const

export const rosterKeywordQueryParser = parseAsString.withDefault('').withOptions({
  limitUrlUpdates: debounce(300),
})

export const rosterFilterQueryParser = parseAsStringLiteral(ROSTER_FILTER_VALUES).withDefault('all')

export const rosterTagIdsQueryParser = parseAsArrayOf(
  { parse: (id) => (isUuid(id) ? id.toLowerCase() : null) },
  ';',
).withDefault([])

export const rosterCreatedByMeQueryParser = parseAsBoolean.withDefault(false)

export const rosterSortByQueryParser = parseAsStringLiteral(
  zGetAgentQuery.shape.sort_by.unwrap().unwrap().options,
).withDefault(zGetAgentQuery.shape.sort_by.parse(undefined))
