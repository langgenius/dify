'use client'

import type {
  KnowledgeFsTidyDocumentCardResponse,
  KnowledgeFsTidyEvidenceResponse,
  KnowledgeFsTidyFindingResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { ReactNode } from 'react'
import type { DuplicateGroup, PlannedAction } from './review'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Meter, MeterIndicator, MeterTrack } from '@langgenius/dify-ui/meter'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { newKnowledgeDocumentDetailPath } from '../routes'
import { fileTypeLabel, mergePlan, newestDocument, relativeTime } from './review'

type Finding = KnowledgeFsTidyFindingResponse
type Evidence = KnowledgeFsTidyEvidenceResponse
export type Kind = Finding['kind']
export type Cards = Readonly<Record<string, KnowledgeFsTidyDocumentCardResponse>>

/** A destructive plan the reviewer confirms in the page's dialog first. */
export type PlanConfirmation = {
  title: string
  description: string
  plan: PlannedAction[]
}

export type CardProps = {
  busy: boolean
  canManage: boolean
  cards: Cards
  spaceId: string
  onConfirm: (confirmation: PlanConfirmation) => void
  onRun: (plan: PlannedAction[]) => void
}

// Tinted backgrounds (`state-*-hover`) stay readable in both themes; the status-dot colors do not.
const BADGES: Record<Kind, { icon: string; tone: string }> = {
  conflict: {
    icon: 'i-ri-error-warning-line',
    tone: 'bg-state-destructive-hover text-text-destructive',
  },
  duplicate: { icon: 'i-ri-file-copy-line', tone: 'bg-state-warning-hover text-text-warning' },
  similar: { icon: 'i-ri-file-copy-2-line', tone: 'bg-state-accent-hover text-text-accent' },
}

function useKindLabel() {
  const { t } = useTranslation(['knowledgeSpace'])
  return (kind: Kind) =>
    kind === 'conflict'
      ? t(($) => $['tidy.conflict'])
      : kind === 'duplicate'
        ? t(($) => $['tidy.duplicate'])
        : t(($) => $['tidy.similar'])
}

export function KindSection({
  children,
  kind,
  meta,
}: {
  children: ReactNode
  kind: Kind
  meta: string
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const heading =
    kind === 'conflict'
      ? t(($) => $['tidy.sectionConflict'])
      : kind === 'duplicate'
        ? t(($) => $['tidy.sectionDuplicate'])
        : t(($) => $['tidy.sectionSimilar'])
  const hint =
    kind === 'conflict'
      ? t(($) => $['tidy.sectionConflictHint'])
      : kind === 'duplicate'
        ? t(($) => $['tidy.sectionDuplicateHint'])
        : t(($) => $['tidy.sectionSimilarHint'])
  return (
    <section aria-label={heading} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="system-xs-semibold-uppercase tracking-[0.14em] text-text-tertiary">
            {heading}
          </h2>
          <span className="system-xs-regular text-text-quaternary tabular-nums">{meta}</span>
        </div>
        <p className="system-xs-regular text-text-tertiary">{hint}</p>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  )
}

function FindingShell({
  aside,
  children,
  kind,
  meter,
  onDismiss,
  stale,
  title,
}: {
  aside: ReactNode
  children: ReactNode
  kind: Kind
  meter?: ReactNode
  onDismiss?: (() => void) | undefined
  stale?: boolean | undefined
  title: string
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const kindLabel = useKindLabel()
  const badge = BADGES[kind]
  return (
    <article
      aria-label={title}
      className="overflow-hidden rounded-2xl border-[0.5px] border-components-card-border bg-components-card-bg shadow-xs"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-divider-subtle px-4 py-3">
        <span
          className={cn(
            'inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 system-2xs-semibold-uppercase tracking-wider',
            badge.tone,
          )}
        >
          <span aria-hidden className={cn(badge.icon, 'size-3.5')} />
          {kindLabel(kind)}
        </span>
        {/* Narrow screens: badge, match and close on one row, the title on its own row below. */}
        <h3 className="order-last w-full system-md-semibold wrap-break-word text-text-primary sm:order-0 sm:w-auto sm:min-w-0 sm:flex-1">
          {title}
        </h3>
        {stale && (
          <span
            title={t(($) => $['tidy.stale'])}
            className="inline-flex h-5 items-center rounded-md bg-state-warning-hover px-1.5 system-2xs-medium text-text-warning"
          >
            {t(($) => $['tidy.staleBadge'])}
          </span>
        )}
        <div className="ms-auto flex shrink-0 items-center gap-3">
          {meter}
          {onDismiss && (
            <IconButton size="md" aria-label={t(($) => $['tidy.dismiss'])} onClick={onDismiss}>
              <span aria-hidden className="i-ri-close-line size-4" />
            </IconButton>
          )}
        </div>
      </header>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 p-4">{children}</div>
        <aside className="flex flex-col gap-3 border-t border-divider-subtle p-4 lg:border-s lg:border-t-0">
          {aside}
        </aside>
      </div>
    </article>
  )
}

function MatchMeter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Meter value={Math.round(value * 100)} aria-label={label} className="w-12">
        <MeterTrack className="h-1">
          <MeterIndicator />
        </MeterTrack>
      </Meter>
      <span aria-hidden className="system-xs-regular text-text-tertiary tabular-nums">
        {label}
      </span>
    </div>
  )
}

function Checklist({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2 system-xs-regular text-text-tertiary">
          <span
            aria-hidden
            className="mt-0.5 i-ri-check-line size-3.5 shrink-0 text-text-quaternary"
          />
          {item}
        </li>
      ))}
    </ul>
  )
}

/**
 * One document of a finding: type, title, when it was published and what will happen to it.
 * `onSelect` makes the tile a radio (choose which document to keep).
 */
function DocumentTile({
  card,
  evidence,
  latest,
  note,
  onSelect,
  selected,
  spaceId,
  title,
}: {
  card: KnowledgeFsTidyDocumentCardResponse | undefined
  evidence: Evidence
  latest: boolean
  note: ReactNode
  onSelect?: (() => void) | undefined
  selected?: boolean | undefined
  spaceId: string
  title: string
}) {
  const { t, i18n } = useTranslation(['knowledgeSpace'])
  return (
    <div
      className={cn(
        'relative flex w-full flex-col overflow-hidden rounded-xl border bg-components-panel-bg sm:w-52',
        selected
          ? 'border-components-option-card-option-selected-border ring-1 ring-components-option-card-option-selected-border'
          : 'border-components-panel-border',
      )}
    >
      {onSelect && (
        <button
          type="button"
          role="radio"
          aria-checked={Boolean(selected)}
          aria-label={title}
          onClick={onSelect}
          className="absolute inset-0 rounded-xl outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        />
      )}
      <div className="pointer-events-none relative flex items-start justify-between bg-background-section px-3 pt-3 pb-2.5">
        <div className="flex flex-col items-start gap-2">
          <Link
            href={newKnowledgeDocumentDetailPath(spaceId, evidence.documentId, {
              revision: evidence.revision,
              chunkId: evidence.chunkId,
            })}
            target="_blank"
            aria-label={t(($) => $['tidy.openDocument'], { title })}
            className="pointer-events-auto flex size-6 items-center justify-center rounded-md bg-components-panel-bg text-text-tertiary shadow-xs hover:text-text-accent"
          >
            <span aria-hidden className="i-ri-external-link-line size-3.5" />
          </Link>
          <span className="rounded-sm bg-components-panel-bg px-1.5 py-0.5 font-mono system-2xs-medium-uppercase text-text-tertiary">
            {fileTypeLabel(card?.mimeType, title)}
          </span>
        </div>
        {selected && (
          <span
            aria-hidden
            className="flex size-5 items-center justify-center rounded-full bg-components-button-primary-bg text-components-button-primary-text"
          >
            <span className="i-ri-check-line size-3.5" />
          </span>
        )}
      </div>
      <div className="pointer-events-none relative flex flex-1 flex-col gap-1 px-3 py-3">
        <p
          title={title}
          className="line-clamp-2 system-sm-semibold wrap-break-word text-text-primary"
        >
          {title}
        </p>
        <p className="system-xs-regular text-text-tertiary">
          {latest && (
            <span className="me-1.5 system-xs-semibold text-text-success">
              {t(($) => $['tidy.latest'])}
            </span>
          )}
          {relativeTime(card?.publishedAt, i18n.language)}
          {card?.enabled === false && (
            <span className="ms-1.5 text-text-warning">
              {t(($) => $['documentStatus.disabled'])}
            </span>
          )}
        </p>
        <p
          className={cn(
            'mt-auto system-xs-medium',
            selected ? 'text-text-primary' : 'text-text-tertiary',
          )}
        >
          {note}
        </p>
      </div>
    </div>
  )
}

function Passage({ evidence }: { evidence: Evidence }) {
  return (
    <blockquote className="max-h-44 overflow-y-auto rounded-lg bg-background-section px-3 py-2 body-sm-regular wrap-break-word whitespace-pre-wrap text-text-secondary">
      {evidence.text}
    </blockquote>
  )
}

/** Findings already handled: their review state and an undo. */
function StatusAside({
  busy,
  canManage,
  finding,
  onRun,
}: Pick<CardProps, 'busy' | 'canManage' | 'onRun'> & { finding: Finding }) {
  const { t } = useTranslation(['knowledgeSpace'])
  const labels: Record<Finding['status'], string> = {
    open: t(($) => $['tidy.open']),
    dismissed: t(($) => $['tidy.dismissed']),
    reviewed: t(($) => $['tidy.reviewed']),
    disabled: t(($) => $['documentStatus.disabled']),
    outdated: t(($) => $['tidy.outdated']),
  }
  return (
    <>
      <p className="system-sm-medium text-text-secondary">{labels[finding.status]}</p>
      {canManage && finding.status !== 'outdated' && (
        <Button
          className="mt-auto w-full"
          disabled={busy || finding.stale}
          onClick={() => onRun([{ finding, action: 'undo' }])}
        >
          <span aria-hidden className="i-ri-arrow-go-back-line size-3.5" />
          {t(($) => $['tidy.undo'])}
        </Button>
      )}
    </>
  )
}

export function DuplicateGroupCard({
  busy,
  canManage,
  cards,
  group,
  onConfirm,
  onRun,
  spaceId,
}: CardProps & { group: DuplicateGroup }) {
  const { t, i18n } = useTranslation(['knowledgeSpace'])
  const newest = newestDocument(group.documentIds, cards)
  const [keep, setKeep] = useState(newest)
  const evidenceOf = (id: string) =>
    group.findings
      .flatMap((finding) => [finding.left, finding.right])
      .find((evidence) => evidence.documentId === id) as Evidence
  const titleOf = (id: string) => cards[id]?.title ?? evidenceOf(id).title
  const stale = group.findings.some((finding) => finding.stale)
  const editable = canManage && !stale
  const dismissAll = () => onRun(group.findings.map((finding) => ({ finding, action: 'dismiss' })))
  return (
    <FindingShell
      kind="duplicate"
      title={t(($) => $['tidy.copiesTitle'], {
        count: group.documentIds.length,
        title: titleOf(newest),
      })}
      meter={<MatchMeter value={1} label={t(($) => $['tidy.overlap'], { percent: 100 })} />}
      stale={stale}
      onDismiss={editable ? dismissAll : undefined}
      aside={
        <>
          <p className="body-sm-regular text-text-secondary">
            {t(($) => $['tidy.copiesExplain'], { count: group.documentIds.length })}
          </p>
          <Checklist
            items={[
              t(($) => $['tidy.newestIs'], {
                title: titleOf(newest),
                time: relativeTime(cards[newest]?.publishedAt, i18n.language),
              }),
            ]}
          />
          {editable && (
            <div className="mt-auto flex flex-col gap-2 pt-1">
              <Button
                variant="primary"
                className="w-full"
                disabled={busy}
                onClick={() =>
                  onConfirm({
                    title: t(($) => $['tidy.mergeTitle'], { title: titleOf(keep) }),
                    description: t(($) => $['tidy.mergeDescription']),
                    plan: mergePlan(group, keep),
                  })
                }
              >
                <span aria-hidden className="i-ri-check-line size-4" />
                {keep === newest
                  ? t(($) => $['tidy.keepNewestMerge'])
                  : t(($) => $['tidy.keepSelectedMerge'])}
              </Button>
              <Button className="w-full" disabled={busy} onClick={dismissAll}>
                {t(($) => $['tidy.keepAll'])}
              </Button>
            </div>
          )}
        </>
      }
    >
      <div
        role={editable ? 'radiogroup' : undefined}
        aria-label={editable ? t(($) => $['tidy.chooseKeep']) : undefined}
        className="flex flex-wrap gap-3"
      >
        {group.documentIds.map((id) => (
          <DocumentTile
            key={id}
            card={cards[id]}
            evidence={evidenceOf(id)}
            spaceId={spaceId}
            latest={id === newest}
            title={titleOf(id)}
            selected={editable && id === keep}
            onSelect={editable ? () => setKeep(id) : undefined}
            note={
              editable && id === keep ? t(($) => $['tidy.keepThis']) : t(($) => $['tidy.exactCopy'])
            }
          />
        ))}
      </div>
    </FindingShell>
  )
}

export function PairCard({
  busy,
  canManage,
  cards,
  finding,
  onConfirm,
  onRun,
  spaceId,
}: CardProps & { finding: Finding }) {
  const { t, i18n } = useTranslation(['knowledgeSpace'])
  const sides = [finding.left, finding.right]
  const newest = newestDocument(
    sides.map((evidence) => evidence.documentId),
    cards,
  )
  const [keep, setKeep] = useState(newest)
  const open = finding.status === 'open'
  const editable = canManage && open && !finding.stale
  const titleOf = (evidence: Evidence) => cards[evidence.documentId]?.title ?? evidence.title
  const semantic = finding.reason === 'semantic_overlap'
  const percent = Math.round((finding.similarity ?? 0) * 100)
  const disable = (evidence: Evidence, kept?: Evidence) =>
    onConfirm({
      title: kept
        ? t(($) => $['tidy.mergeTitle'], { title: titleOf(kept) })
        : t(($) => $['tidy.disableOne'], { title: titleOf(evidence) }),
      description: kept ? t(($) => $['tidy.mergeDescription']) : t(($) => $['tidy.disableNotice']),
      plan: [{ finding, action: 'disable_document', documentId: evidence.documentId }],
    })
  const dismiss = () => onRun([{ finding, action: 'dismiss' }])
  const review = (
    <Button
      variant={finding.kind === 'conflict' ? 'primary' : 'secondary'}
      className="w-full"
      disabled={busy}
      onClick={() => onRun([{ finding, action: 'review' }])}
    >
      <span aria-hidden className="i-ri-check-line size-4" />
      {t(($) => $['tidy.review'])}
    </Button>
  )

  if (finding.kind === 'conflict') {
    return (
      <FindingShell
        kind="conflict"
        title={finding.reason}
        stale={finding.stale}
        onDismiss={editable ? dismiss : undefined}
        aside={
          open ? (
            <>
              <p className="body-sm-regular text-text-secondary">
                {t(($) => $['tidy.conflictExplain'])}
              </p>
              {editable && (
                <div className="mt-auto flex flex-col gap-2 pt-1">
                  {review}
                  {sides.map((evidence) => (
                    <Button
                      key={evidence.documentId}
                      className="w-full"
                      disabled={busy}
                      onClick={() => disable(evidence)}
                    >
                      <span aria-hidden className="i-ri-forbid-line size-3.5" />
                      <span className="truncate">
                        {t(($) => $['tidy.disableOne'], { title: titleOf(evidence) })}
                      </span>
                    </Button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <StatusAside busy={busy} canManage={canManage} finding={finding} onRun={onRun} />
          )
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          {sides.map((evidence) => (
            <div key={evidence.documentId} className="flex min-w-0 flex-col gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 rounded-sm bg-background-section px-1.5 py-0.5 font-mono system-2xs-medium-uppercase text-text-tertiary">
                  {fileTypeLabel(cards[evidence.documentId]?.mimeType, titleOf(evidence))}
                </span>
                <Link
                  href={newKnowledgeDocumentDetailPath(spaceId, evidence.documentId, {
                    revision: evidence.revision,
                    chunkId: evidence.chunkId,
                  })}
                  className="min-w-0 truncate system-sm-semibold text-text-primary hover:text-text-accent"
                >
                  {titleOf(evidence)}
                </Link>
                <span className="shrink-0 system-xs-regular text-text-quaternary">
                  v{evidence.revision}
                </span>
              </div>
              <Passage evidence={evidence} />
            </div>
          ))}
        </div>
      </FindingShell>
    )
  }

  const kept = sides.find((evidence) => evidence.documentId === keep) ?? finding.left
  const other = sides.find((evidence) => evidence.documentId !== keep) ?? finding.right
  const isDuplicate = finding.kind === 'duplicate'
  return (
    <FindingShell
      kind={finding.kind}
      title={
        isDuplicate
          ? t(($) => $['tidy.copiesTitle'], { count: 2, title: titleOf(finding.left) })
          : t(($) => $['tidy.similarTitle'], {
              left: titleOf(finding.left),
              right: titleOf(finding.right),
            })
      }
      meter={
        <MatchMeter
          value={isDuplicate ? 1 : (finding.similarity ?? 0)}
          label={
            semantic
              ? t(($) => $['tidy.semanticCoverage'], { percent })
              : t(($) => $['tidy.overlap'], { percent: isDuplicate ? 100 : percent })
          }
        />
      }
      stale={finding.stale}
      onDismiss={editable ? dismiss : undefined}
      aside={
        open ? (
          <>
            <p className="body-sm-regular text-text-secondary">
              {isDuplicate
                ? t(($) => $['tidy.copiesExplain'], { count: 2 })
                : semantic
                  ? t(($) => $['tidy.semanticReason'])
                  : t(($) => $['tidy.similarReason'])}
            </p>
            <Checklist
              items={[
                t(($) => $['tidy.newestIs'], {
                  title: titleOf(
                    sides.find((evidence) => evidence.documentId === newest) ?? finding.left,
                  ),
                  time: relativeTime(cards[newest]?.publishedAt, i18n.language),
                }),
              ]}
            />
            {editable && (
              <div className="mt-auto flex flex-col gap-2 pt-1">
                <Button
                  variant="primary"
                  className="w-full"
                  disabled={busy}
                  onClick={() => disable(other, kept)}
                >
                  <span aria-hidden className="i-ri-check-line size-4" />
                  {t(($) => $['tidy.keepSelectedDisableOther'])}
                </Button>
                {review}
              </div>
            )}
          </>
        ) : (
          <StatusAside busy={busy} canManage={canManage} finding={finding} onRun={onRun} />
        )
      }
    >
      <div className="flex flex-col gap-3">
        <div
          role={editable ? 'radiogroup' : undefined}
          aria-label={editable ? t(($) => $['tidy.chooseKeep']) : undefined}
          className="flex flex-wrap gap-3"
        >
          {sides.map((evidence) => (
            <DocumentTile
              key={evidence.documentId}
              card={cards[evidence.documentId]}
              evidence={evidence}
              spaceId={spaceId}
              latest={evidence.documentId === newest}
              title={titleOf(evidence)}
              selected={editable && evidence.documentId === keep}
              onSelect={editable ? () => setKeep(evidence.documentId) : undefined}
              note={
                !editable
                  ? `v${evidence.revision}`
                  : evidence.documentId === keep
                    ? t(($) => $['tidy.keepThis'])
                    : t(($) => $['tidy.willDisable'])
              }
            />
          ))}
        </div>
        {!isDuplicate && (
          <div className="grid gap-3 md:grid-cols-2">
            {sides.map((evidence) => (
              <Passage key={evidence.documentId} evidence={evidence} />
            ))}
          </div>
        )}
      </div>
    </FindingShell>
  )
}
