'use client'

import type {
  KnowledgeFsTidyFindingResponse,
  KnowledgeFsTidySummaryResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { Ref } from 'react'
import type { FindingStatus, FindingTab } from './kinds'
import type { CardProps } from './review-cards'
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
import {
  DEFAULT_FINDING_TAB,
  FILTERABLE_STATUSES,
  FINDING_STATUSES,
  FINDING_TABS,
  tabLabel,
  tabShows,
} from './kinds'
import { groupDuplicates, groupPairs } from './review'
import { DuplicateGroupCard, KindSection, PairCard, PairGroupCard } from './review-cards'
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

/** One page of findings arranged the way they are reviewed. */
function arrange(items: readonly Finding[]) {
  const conflictPairs = groupPairs(
    items.filter((finding) => finding.status === 'open' && finding.kind !== 'duplicate'),
  ).filter((group) => group.conflicts.length > 0)
  const duplicates = items.filter((finding) => finding.kind === 'duplicate')
  return {
    conflictPairs,
    handledConflicts: items.filter(
      (finding) => finding.kind === 'conflict' && finding.status !== 'open',
    ),
    duplicates,
    // Identical copies awaiting review read best as one group with a keep-one choice.
    copyGroups: duplicates.every((finding) => finding.status === 'open')
      ? groupDuplicates(duplicates)
      : null,
    // The closer two documents are, the more likely one of them can go: most overlap first.
    similar: items
      .filter((finding) => finding.kind === 'similar')
      .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0)),
    /** The open conflicts between the same two documents as an overlap finding. */
    conflictsBeside: (finding: Finding) =>
      conflictPairs.find((group) => group.similar?.id === finding.id)?.conflicts ?? [],
  }
}

/** The review queue: its type tabs and status filter, the findings of one page, and paging. */
export function FindingsList({
  activeTabRef,
  summary,
  ...card
}: Omit<CardProps, 'cards'> & {
  /** The pressed type tab: where focus goes once a reviewed card has left the queue. */
  activeTabRef: Ref<HTMLButtonElement>
  summary: KnowledgeFsTidySummaryResponse | undefined
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const { t: common } = useTranslation(['common'])
  const queue = useTidyFindings(card.spaceId)
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
      <FindingSections tab={queue.tab} items={queue.items} card={{ ...card, cards: queue.cards }} />
      <div className="my-5 flex gap-2">
        {queue.paged && (
          <Button onClick={queue.firstPage}>{common(($) => $['operation.back'])}</Button>
        )}
        {queue.hasNext && (
          <Button onClick={queue.nextPage}>{common(($) => $['pagination.next'])}</Button>
        )}
      </div>
    </>
  )
}

function FindingSections({
  card,
  items,
  tab,
}: {
  card: CardProps
  items: readonly Finding[]
  tab: FindingTab
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const { conflictPairs, handledConflicts, duplicates, copyGroups, similar, conflictsBeside } =
    arrange(items)
  const conflictCount = conflictPairs.length + handledConflicts.length
  const pairCount = (copyGroups ? 0 : duplicates.length) + similar.length
  return (
    <div aria-label={t(($) => $['tidy.results'])} className="flex flex-col gap-6">
      {tabShows(tab, 'conflict') && conflictCount > 0 && (
        <KindSection
          section="conflict"
          meta={t(($) => $['tidy.pairsMeta'], { count: conflictCount })}
        >
          {conflictPairs.map((group) => (
            <PairGroupCard key={group.key} group={group} {...card} />
          ))}
          {handledConflicts.map((finding) => (
            <PairCard key={finding.id} finding={finding} {...card} />
          ))}
        </KindSection>
      )}
      {tabShows(tab, 'duplicate') && duplicates.length + similar.length > 0 && (
        <KindSection
          section="overlap"
          meta={[
            ...(copyGroups
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
          {copyGroups
            ? copyGroups.map((group) => (
                <DuplicateGroupCard key={group.key} group={group} {...card} />
              ))
            : duplicates.map((finding) => (
                <PairCard key={finding.id} finding={finding} {...card} />
              ))}
          {similar.map((finding) => (
            <PairCard
              key={finding.id}
              finding={finding}
              related={conflictsBeside(finding)}
              {...card}
            />
          ))}
        </KindSection>
      )}
    </div>
  )
}
