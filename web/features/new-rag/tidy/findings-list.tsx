'use client'

import type {
  KnowledgeFsTidyFindingResponse,
  KnowledgeFsTidySummaryResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { Ref } from 'react'
import type { CardProps } from './card-parts'
import type { FindingKind, FindingSection, FindingStatus, FindingTab } from './kinds'
import type { DuplicateGroup, PairGroup } from './review'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useTranslation } from 'react-i18next'
import { KindSection } from './card-parts'
import { DuplicateGroupCard } from './duplicate-group-card'
import {
  DEFAULT_FINDING_TAB,
  FILTERABLE_STATUSES,
  FINDING_STATUSES,
  FINDING_TABS,
  tabLabel,
  tabShows,
} from './kinds'
import { PairCard } from './pair-card'
import { PairGroupCard } from './pair-group-card'
import { groupDuplicates, groupPairs } from './review'
import { useTidyFindings } from './use-tidy'

type Finding = KnowledgeFsTidyFindingResponse

function countOf(
  summary: KnowledgeFsTidySummaryResponse | undefined,
  status: FindingStatus,
  tab: FindingTab = DEFAULT_FINDING_TAB,
) {
  return (summary?.findings ?? [])
    .filter((row) => row.status === status && tabShows(tab, row.kind))
    .reduce((total, row) => total + row.count, 0)
}

/** Review cards shown at a time: the loaded findings are paged here, not by the API. */
export const CARDS_PER_PAGE = 20

type Entry = { key: string; section: FindingSection } & (
  | { card: 'pairs'; group: PairGroup; complete: boolean }
  | { card: 'copies'; group: DuplicateGroup; complete: boolean }
  | { card: 'finding'; finding: Finding; related: readonly Finding[] }
)

/**
 * The loaded findings of a tab as review cards, in reading order. `partial` says whether open
 * findings of a kind are missing from `items`; a group that may lack findings is still shown,
 * but marked so that no action speaks for the whole group.
 */
function arrange(
  items: readonly Finding[],
  tab: FindingTab,
  partial: (kind: FindingKind) => boolean,
) {
  const pairsComplete = !partial('conflict') && !partial('similar')
  const conflictPairs = groupPairs(
    items.filter((finding) => finding.status === 'open' && finding.kind !== 'duplicate'),
  ).filter((group) => group.conflicts.length > 0)
  const duplicates = items.filter((finding) => finding.kind === 'duplicate')
  // Identical copies awaiting review read best as one group with a keep-one choice.
  const copyGroups = duplicates.every((finding) => finding.status === 'open')
    ? groupDuplicates(duplicates)
    : null
  const alone = (section: FindingSection, finding: Finding): Entry => ({
    card: 'finding',
    key: finding.id,
    section,
    finding,
    // The open conflicts between the same two documents as an overlap finding.
    related: pairsComplete
      ? (conflictPairs.find((group) => group.similar?.id === finding.id)?.conflicts ?? [])
      : [],
  })
  const conflict: Entry[] = tabShows(tab, 'conflict')
    ? [
        ...conflictPairs.map((group): Entry => ({
          card: 'pairs',
          key: group.key,
          section: 'conflict',
          group,
          complete: pairsComplete,
        })),
        ...items
          .filter((finding) => finding.kind === 'conflict' && finding.status !== 'open')
          .map((finding) => alone('conflict', finding)),
      ]
    : []
  const copies: Entry[] = copyGroups
    ? copyGroups.map((group) => ({
        card: 'copies',
        key: group.key,
        section: 'overlap',
        group,
        complete: !partial('duplicate'),
      }))
    : duplicates.map((finding) => alone('overlap', finding))
  const overlap: Entry[] = tabShows(tab, 'duplicate')
    ? [
        ...copies,
        // The closer two documents are, the more likely one of them can go: most overlap first.
        ...items
          .filter((finding) => finding.kind === 'similar')
          .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
          .map((finding) => alone('overlap', finding)),
      ]
    : []
  return {
    entries: [...conflict, ...overlap],
    conflictCount: conflict.length,
    copyGroups: copyGroups ?? [],
    pairCount: overlap.length - (copyGroups?.length ?? 0),
  }
}

/** The review queue: its type tabs and status filter, one page of review cards, and paging. */
export function FindingsList({
  activeTabRef,
  live,
  summary,
  ...card
}: Omit<CardProps, 'cards'> & {
  /** The pressed type tab: where focus goes once a reviewed card has left the queue. */
  activeTabRef: Ref<HTMLButtonElement>
  /** A scan is running or waiting, so findings can appear on their own. */
  live: boolean
  summary: KnowledgeFsTidySummaryResponse | undefined
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const { t: common } = useTranslation(['common'])
  const queue = useTidyFindings(card.spaceId, live)
  const arranged = arrange(queue.items, queue.tab, queue.partial)
  // Cards leave as they are reviewed, so the page in the URL may lie past the last one.
  const pageCount = Math.max(1, Math.ceil(arranged.entries.length / CARDS_PER_PAGE))
  const page = Math.min(Math.max(queue.page, 1), pageCount)
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label={t(($) => $['tidy.kindFilter'])}
          className="flex flex-wrap items-center gap-1 rounded-full bg-background-section p-1"
        >
          {FINDING_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              ref={queue.tab === tab ? activeTabRef : undefined}
              aria-pressed={queue.tab === tab}
              onClick={() => queue.selectTab(tab)}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 system-sm-medium outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                queue.tab === tab
                  ? 'bg-components-panel-bg text-text-primary shadow-xs'
                  : 'text-text-tertiary hover:text-text-secondary',
              )}
            >
              {t(($) => $[tabLabel(tab)])}
              <span aria-hidden className="text-text-quaternary">
                ·
              </span>
              <span className="system-xs-regular text-text-tertiary tabular-nums">
                {countOf(summary, queue.status, tab)}
              </span>
            </button>
          ))}
        </div>
        <Select
          value={queue.status}
          onValueChange={(value) => {
            const status = FILTERABLE_STATUSES.find((known) => known === value)
            if (status) queue.selectStatus(status)
          }}
        >
          <SelectTrigger aria-label={t(($) => $['tidy.statusFilter'])} className="w-auto min-w-36">
            {t(($) => $[FINDING_STATUSES[queue.status].label])}
          </SelectTrigger>
          <SelectContent>
            {FILTERABLE_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                <SelectItemText>
                  {t(($) => $[FINDING_STATUSES[status].label])}
                  {countOf(summary, status) > 0 && (
                    <span className="ms-1.5 text-text-tertiary tabular-nums">
                      {countOf(summary, status)}
                    </span>
                  )}
                </SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {queue.loading && <p role="status">{common(($) => $.loading)}</p>}
      {queue.failed && <p role="alert">{t(($) => $['tidy.error'])}</p>}
      {queue.loaded && queue.items.length === 0 && (
        <p className="rounded-2xl bg-background-section p-6 text-text-tertiary">
          {t(($) => $['tidy.empty'])}
        </p>
      )}
      {queue.loaded && queue.partial() && (
        <p
          role="note"
          className="mb-5 rounded-xl bg-state-warning-hover px-4 py-3 body-sm-regular text-text-warning"
        >
          {t(($) => $['tidy.incomplete'])}
        </p>
      )}
      <FindingSections
        {...arranged}
        entries={arranged.entries.slice((page - 1) * CARDS_PER_PAGE, page * CARDS_PER_PAGE)}
        card={{ ...card, cards: queue.cards }}
      />
      <div className="my-5 flex gap-2">
        {(page > 1 || queue.paged) && (
          <Button onClick={() => (page > 1 ? queue.showPage(page - 1) : queue.previousPage())}>
            {common(($) => $['operation.back'])}
          </Button>
        )}
        {(page < pageCount || queue.hasNext) && (
          <Button
            onClick={() => (page < pageCount ? queue.showPage(page + 1) : queue.nextPage(page))}
          >
            {common(($) => $['pagination.next'])}
          </Button>
        )}
      </div>
    </>
  )
}

/** The cards of one page under their section headings; the counts are of the whole list. */
function FindingSections({
  card,
  conflictCount,
  copyGroups,
  entries,
  pairCount,
}: ReturnType<typeof arrange> & { card: CardProps }) {
  const { t } = useTranslation(['knowledgeSpace'])
  const cardsOf = (section: FindingSection) =>
    entries
      .filter((entry) => entry.section === section)
      .map((entry) =>
        entry.card === 'pairs' ? (
          <PairGroupCard key={entry.key} group={entry.group} complete={entry.complete} {...card} />
        ) : entry.card === 'copies' ? (
          <DuplicateGroupCard
            key={entry.key}
            group={entry.group}
            complete={entry.complete}
            {...card}
          />
        ) : (
          <PairCard key={entry.key} finding={entry.finding} related={entry.related} {...card} />
        ),
      )
  const conflicts = cardsOf('conflict')
  const overlaps = cardsOf('overlap')
  return (
    <div aria-label={t(($) => $['tidy.results'])} className="flex flex-col gap-6">
      {conflicts.length > 0 && (
        <KindSection
          section="conflict"
          meta={t(($) => $['tidy.pairsMeta'], { count: conflictCount })}
        >
          {conflicts}
        </KindSection>
      )}
      {overlaps.length > 0 && (
        <KindSection
          section="overlap"
          meta={[
            ...(copyGroups.length > 0
              ? [
                  t(($) => $['tidy.groupsMeta'], {
                    count: copyGroups.length,
                    files: copyGroups.reduce((total, group) => total + group.documentIds.length, 0),
                  }),
                ]
              : []),
            ...(pairCount > 0 ? [t(($) => $['tidy.pairsMeta'], { count: pairCount })] : []),
          ].join(' · ')}
        >
          {overlaps}
        </KindSection>
      )}
    </div>
  )
}
