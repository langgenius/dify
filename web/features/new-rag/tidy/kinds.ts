/**
 * The one place that says which finding kinds and review statuses exist and how each is shown.
 * Both unions come from the API contract, and every registry is checked against them: a kind or
 * status added to the contract does not compile until it has an entry here.
 */
import type { KnowledgeFsTidyFindingResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { I18nKeysWithoutVariables } from '@/types/i18n'

type Label = I18nKeysWithoutVariables<'knowledgeSpace'>

export type FindingKind = KnowledgeFsTidyFindingResponse['kind']
export type FindingStatus = KnowledgeFsTidyFindingResponse['status']

/**
 * What a reviewer is asked to do. Conflicts need a judgement; exact copies and overlapping
 * documents ask the same question (which one to keep), so they share a section and a tab.
 */
export const FINDING_SECTIONS = {
  conflict: {
    tab: 'tidy.conflict',
    heading: 'tidy.sectionConflict',
    hint: 'tidy.sectionConflictHint',
  },
  overlap: {
    tab: 'tidy.overlapKind',
    heading: 'tidy.sectionOverlap',
    hint: 'tidy.sectionOverlapHint',
  },
} as const satisfies Record<string, { tab: Label; heading: Label; hint: Label }>

export type FindingSection = keyof typeof FINDING_SECTIONS

// Tinted backgrounds (`state-*-hover`) stay readable in both themes; the status-dot colors do not.
export const FINDING_KINDS = {
  conflict: {
    section: 'conflict',
    label: 'tidy.conflict',
    icon: 'i-ri-error-warning-line',
    tone: 'bg-state-destructive-hover text-text-destructive',
  },
  duplicate: {
    section: 'overlap',
    label: 'tidy.duplicate',
    icon: 'i-ri-file-copy-line',
    tone: 'bg-state-warning-hover text-text-warning',
  },
  similar: {
    section: 'overlap',
    label: 'tidy.similar',
    icon: 'i-ri-file-copy-2-line',
    tone: 'bg-state-accent-hover text-text-accent',
  },
} as const satisfies Record<
  FindingKind,
  { section: FindingSection; label: Label; icon: string; tone: string }
>

const ALL_TAB = 'all'
export type FindingTab = typeof ALL_TAB | FindingSection

const keysOf = <T extends object>(value: T) => Object.keys(value) as Array<keyof T>

/** The tabs above the review queue: everything, then one tab per section. */
export const FINDING_TABS: readonly FindingTab[] = [ALL_TAB, ...keysOf(FINDING_SECTIONS)]
export const DEFAULT_FINDING_TAB: FindingTab = ALL_TAB

export function tabLabel(tab: FindingTab): Label {
  return tab === ALL_TAB ? 'tidy.allKinds' : FINDING_SECTIONS[tab].tab
}

export function tabShows(tab: FindingTab, kind: FindingKind) {
  return tab === ALL_TAB || FINDING_KINDS[kind].section === tab
}

/** The kinds a tab narrows the list to; none for the tab that shows everything. */
export function kindsOfTab(tab: FindingTab): FindingKind[] {
  return tab === ALL_TAB
    ? []
    : keysOf(FINDING_KINDS).filter((kind) => FINDING_KINDS[kind].section === tab)
}

/**
 * `filterable` says whether the status is offered in the review-status filter. The findings API
 * accepts every status as a filter and counts every status in the summary, so each one is listed:
 * left out of the filter, a finding in that status could never be reached from this page.
 */
export const FINDING_STATUSES = {
  open: { label: 'tidy.open', filterable: true },
  dismissed: { label: 'tidy.dismissed', filterable: true },
  reviewed: { label: 'tidy.reviewed', filterable: true },
  disabled: { label: 'documentStatus.disabled', filterable: true },
  outdated: { label: 'tidy.outdated', filterable: true },
} as const satisfies Record<FindingStatus, { label: Label; filterable: boolean }>

export const FILTERABLE_STATUSES: readonly FindingStatus[] = keysOf(FINDING_STATUSES).filter(
  (status) => FINDING_STATUSES[status].filterable,
)
export const DEFAULT_FINDING_STATUS: FindingStatus = 'open'
