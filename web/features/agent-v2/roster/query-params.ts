import { zGetAgentQuery } from '@dify/contracts/api/console/agent/zod.gen'
import { debounce, parseAsBoolean, parseAsString, parseAsStringLiteral } from 'nuqs'
import { ROSTER_FILTER_VALUES } from './components/roster-filter'

export const rosterQueryParamNames = {
  type: 'agent_type',
  keyword: 'keyword',
  filter: 'filter',
  createdByMe: 'created_by_me',
  sortBy: 'sort_by',
} as const

export const rosterTypeQueryParser = parseAsStringLiteral(['dify', 'external']).withDefault('dify')

export const externalRosterQueryParsers = {
  external_keyword: parseAsString.withDefault(''),
  external_status: parseAsStringLiteral(['all', 'enabled', 'disabled']).withDefault('all'),
  external_connected_by_me: parseAsBoolean.withDefault(false),
  external_sort_by: parseAsStringLiteral(['last_modified']).withDefault('last_modified'),
}

export const rosterKeywordQueryParser = parseAsString.withDefault('').withOptions({
  limitUrlUpdates: debounce(300),
})

export const rosterFilterQueryParser = parseAsStringLiteral(ROSTER_FILTER_VALUES).withDefault('all')

export const rosterCreatedByMeQueryParser = parseAsBoolean.withDefault(false)

export const rosterSortByQueryParser = parseAsStringLiteral(
  zGetAgentQuery.shape.sort_by.unwrap().unwrap().options,
).withDefault(zGetAgentQuery.shape.sort_by.parse(undefined))
