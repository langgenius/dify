import { zGetAgentQuery } from '@dify/contracts/api/console/agent/zod.gen'
import { debounce, parseAsBoolean, parseAsString, parseAsStringLiteral } from 'nuqs'
import { ROSTER_FILTER_VALUES } from './components/roster-filter'

export const rosterQueryParamNames = {
  keyword: 'keyword',
  filter: 'filter',
  createdByMe: 'created_by_me',
  sortBy: 'sort_by',
} as const

export const rosterKeywordQueryParser = parseAsString.withDefault('').withOptions({
  limitUrlUpdates: debounce(300),
})

export const rosterFilterQueryParser = parseAsStringLiteral(ROSTER_FILTER_VALUES).withDefault('all')

export const rosterCreatedByMeQueryParser = parseAsBoolean.withDefault(false)

export const rosterSortByQueryParser = parseAsStringLiteral(
  zGetAgentQuery.shape.sort_by.unwrap().unwrap().options,
).withDefault(zGetAgentQuery.shape.sort_by.parse(undefined))
