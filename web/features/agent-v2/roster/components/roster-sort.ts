import type { GetAgentData } from '@dify/contracts/api/console/agent/types.gen'

export type RosterSortBy = NonNullable<NonNullable<GetAgentData['query']>['sort_by']>

export const DEFAULT_ROSTER_SORT_BY = 'last_modified' satisfies RosterSortBy

export const ROSTER_SORT_BY_VALUES = [
  DEFAULT_ROSTER_SORT_BY,
  'recently_created',
  'earliest_created',
] as const satisfies readonly RosterSortBy[]

export const rosterSortOptions: Array<{
  value: RosterSortBy
  labelKey: 'roster.sort.lastModified' | 'roster.sort.recentlyCreated' | 'roster.sort.earliestCreated'
}> = [
  { value: 'last_modified', labelKey: 'roster.sort.lastModified' },
  { value: 'recently_created', labelKey: 'roster.sort.recentlyCreated' },
  { value: 'earliest_created', labelKey: 'roster.sort.earliestCreated' },
]
