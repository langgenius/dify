import { debounce, parseAsBoolean, parseAsString, parseAsStringLiteral } from 'nuqs'
import { ROSTER_FILTER_VALUES } from './components/roster-filter'
import { DEFAULT_ROSTER_SORT_BY, ROSTER_SORT_BY_VALUES } from './components/roster-sort'

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

export const rosterSortByQueryParser = parseAsStringLiteral(ROSTER_SORT_BY_VALUES).withDefault(DEFAULT_ROSTER_SORT_BY)
