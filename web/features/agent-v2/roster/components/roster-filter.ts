export const ROSTER_FILTER_VALUES = ['all', 'published', 'drafts'] as const
export type RosterFilterValue = (typeof ROSTER_FILTER_VALUES)[number]
