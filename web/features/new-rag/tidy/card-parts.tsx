'use client'

import type {
  KnowledgeFsTidyDocumentCardResponse,
  KnowledgeFsTidyEvidenceResponse,
  KnowledgeFsTidyFindingResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { ReactNode } from 'react'
import type { FindingKind, FindingSection } from './kinds'
import type { PlannedAction, RewriteRequest } from './review'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Meter, MeterIndicator, MeterTrack } from '@langgenius/dify-ui/meter'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { newKnowledgeDocumentDetailPath } from '../routes'
import { FINDING_KINDS, FINDING_SECTIONS, FINDING_STATUSES } from './kinds'
import { fileTypeLabel, relativeTime } from './review'

export type Finding = KnowledgeFsTidyFindingResponse
export type Evidence = KnowledgeFsTidyEvidenceResponse
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
  /** Adopt one side of a conflict; the page shows the edit and asks before applying it. */
  onRewrite: (request: RewriteRequest) => void
  onRun: (plan: PlannedAction[]) => void
}

export function KindSection({
  children,
  meta,
  section,
}: {
  children: ReactNode
  meta: string
  section: FindingSection
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const heading = t(($) => $[FINDING_SECTIONS[section].heading])
  const hint = t(($) => $[FINDING_SECTIONS[section].hint])
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

export function FindingShell({
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
  kind: FindingKind
  meter?: ReactNode
  onDismiss?: (() => void) | undefined
  stale?: boolean | undefined
  title: string
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const badge = FINDING_KINDS[kind]
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
          {t(($) => $[badge.label])}
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

export function MatchMeter({ label, value }: { label: string; value: number }) {
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

export function Checklist({ items }: { items: string[] }) {
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
export function DocumentTile({
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

export function Passage({ evidence }: { evidence: Evidence }) {
  return (
    <blockquote className="max-h-44 overflow-y-auto rounded-lg bg-background-section px-3 py-2 body-sm-regular wrap-break-word whitespace-pre-wrap text-text-secondary">
      {evidence.text}
    </blockquote>
  )
}

/** One document above its quoted passage: type, a link to the passage, and the revision. */
export function DocumentHeading({
  card,
  evidence,
  spaceId,
  title,
}: {
  card: KnowledgeFsTidyDocumentCardResponse | undefined
  evidence: Evidence
  spaceId: string
  title: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 rounded-sm bg-background-section px-1.5 py-0.5 font-mono system-2xs-medium-uppercase text-text-tertiary">
        {fileTypeLabel(card?.mimeType, title)}
      </span>
      <Link
        href={newKnowledgeDocumentDetailPath(spaceId, evidence.documentId, {
          revision: evidence.revision,
          chunkId: evidence.chunkId,
        })}
        title={title}
        className="min-w-0 truncate system-sm-semibold text-text-primary hover:text-text-accent"
      >
        {title}
      </Link>
      <span className="shrink-0 system-xs-regular text-text-quaternary">v{evidence.revision}</span>
    </div>
  )
}

/** Findings already handled: their review state and an undo. */
export function StatusAside({
  busy,
  canManage,
  finding,
  onRun,
}: Pick<CardProps, 'busy' | 'canManage' | 'onRun'> & { finding: Finding }) {
  const { t } = useTranslation(['knowledgeSpace'])
  return (
    <>
      <p className="system-sm-medium text-text-secondary">
        {t(($) => $[FINDING_STATUSES[finding.status].label])}
      </p>
      {/* A decision carried over from an earlier revision has no action of its own to undo. */}
      {canManage &&
        finding.actionId &&
        finding.status !== 'outdated' &&
        finding.status !== 'open' && (
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
