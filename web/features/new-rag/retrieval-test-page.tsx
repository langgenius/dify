'use client'

import type {
  KnowledgeFsResearchTaskPlanResponse,
  KnowledgeFsResearchTaskResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { Hotkey } from '@tanstack/react-hotkeys'
import type { AnchorHTMLAttributes, PropsWithChildren } from 'react'
import type {
  RetrievalEvidence,
  RetrievalTestMode,
  RetrievalTestRecord,
} from './retrieval-test-model'
import type { KnowledgeQueryEvent } from './services/knowledge-query-events'
import type { ResearchTaskProgressEvent } from './services/research-task-events'
import type { MarkdownProps } from '@/app/components/base/markdown'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { matchesKeyboardEvent } from '@tanstack/react-hotkeys'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { parseAsString, useQueryStates } from 'nuqs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Markdown } from '@/app/components/base/markdown'
import { Link as MarkdownLink } from '@/app/components/base/markdown-blocks'
import Link from '@/next/link'
import { consoleClient, consoleQuery } from '@/service/client'
import { RetrievalModeSegmentedControl } from './components/retrieval-mode-segmented-control'
import {
  extractRetrievalEvidence,
  extractStreamError,
  extractTraceId,
  formatDuration,
  formatRetrievalDuration,
  researchTaskIsActive,
  retrievalTestRecords,
  shouldRefreshResearchPartials,
} from './retrieval-test-model'
import { newKnowledgeDocumentDetailPath, newKnowledgeQualityPath } from './routes'
import { streamKnowledgeQuery } from './services/knowledge-query-events'
import {
  researchTaskAnswerFromEvents,
  streamResearchTaskEvents,
} from './services/research-task-events'

type LocalQueryRun = {
  endedAt?: number
  error?: string
  evidence: RetrievalEvidence[]
  id: string
  mode: Exclude<RetrievalTestMode, 'research'>
  query: string
  startedAt: number
  status: 'completed' | 'failed' | 'no-results' | 'running'
  traceId?: string
}

type SelectedRun = {
  id: string
  kind: 'local' | RetrievalTestRecord['kind']
}

type ComposerDraft = {
  mode: RetrievalTestMode
  query: string
  selectionKey?: string
}

type QualityDecision = 'bad-case' | 'golden'

const researchStageOrder = ['planning', 'retrieving', 'analyzing', 'generating'] as const
type ResearchStage = (typeof researchStageOrder)[number]
const runRetrievalHotkey = 'Mod+Enter' satisfies Hotkey

function timeValue(value: number) {
  return value < 10_000_000_000 ? value * 1000 : value
}

function formatRecordTime(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(value)
}

function RecordTime({ value }: { value: number }) {
  const { t } = useTranslation('dataset')
  const [showJustNow, setShowJustNow] = useState(() => {
    const age = Date.now() - value
    return age >= 0 && age < 60_000
  })

  useEffect(() => {
    if (!showJustNow) return
    const timeout = globalThis.setTimeout(
      () => setShowJustNow(false),
      Math.max(0, value + 60_000 - Date.now()),
    )
    return () => globalThis.clearTimeout(timeout)
  }, [showJustNow, value])

  return showJustNow ? t(($) => $['newKnowledge.retrievalTest.justNow']) : formatRecordTime(value)
}

type ResearchPayloadLabels = {
  chunks: string
  documents: string
  retrievals: string
  sources: string
  topK: string
}

const researchPayloadContainers = new Set([
  'analysis',
  'analyzing',
  'candidates',
  'chunks',
  'coverage',
  'data',
  'details',
  'documents',
  'findings',
  'generating',
  'generation',
  'items',
  'plan',
  'planning',
  'questions',
  'results',
  'retrieval',
  'retrieving',
  'sources',
  'topics',
  'warnings',
])
const researchPayloadLabels = new Set(['name', 'query', 'question', 'title', 'topic'])
const researchPayloadText = new Set([
  ...researchPayloadLabels,
  'coverage',
  'coveragegap',
  'coveragegapwarning',
  'coveragewarning',
  'finding',
  'findings',
  'mergedcandidatesummary',
  'mergedsummary',
  'message',
  'questions',
  'result',
  'results',
  'summary',
  'topics',
  'warning',
  'warnings',
])

function normalizedPayloadKey(key: string) {
  return key.replaceAll(/[^a-z0-9]/gi, '').toLocaleLowerCase()
}

function payloadCountLabel(key: string, labels: ResearchPayloadLabels) {
  const normalizedKey = normalizedPayloadKey(key)
  if (normalizedKey === 'chunkcount' || normalizedKey === 'chunks') return labels.chunks
  if (normalizedKey === 'documentcount' || normalizedKey === 'documents') return labels.documents
  if (normalizedKey === 'retrievalcount') return labels.retrievals
  if (normalizedKey === 'sourcecount' || normalizedKey === 'sources') return labels.sources
  if (normalizedKey === 'topk') return labels.topK
}

function researchPayloadLines(payload: Record<string, unknown>, labels: ResearchPayloadLabels) {
  const lines: string[] = []
  const visit = (value: unknown, key = '', depth = 0) => {
    if (depth > 3) return
    const normalizedKey = normalizedPayloadKey(key)
    if (typeof value === 'string') {
      if (value.trim() && researchPayloadText.has(normalizedKey)) lines.push(value.trim())
      return
    }
    if (typeof value === 'number') {
      const countLabel = payloadCountLabel(key, labels)
      if (countLabel) lines.push(`${countLabel}: ${value}`)
      return
    }
    if (Array.isArray(value)) {
      if (!researchPayloadContainers.has(normalizedKey)) return
      value.forEach((item) => visit(item, key, depth + 1))
      return
    }
    if (!value || typeof value !== 'object') return
    if (key && !researchPayloadContainers.has(normalizedKey)) return
    const record = value as Record<string, unknown>
    const entries = Object.entries(record)
    const labelEntry = entries.find(
      ([candidate, nested]) =>
        researchPayloadLabels.has(normalizedPayloadKey(candidate)) && typeof nested === 'string',
    )
    const countEntry = entries.find(
      ([candidate, nested]) =>
        ['chunkcount', 'chunks', 'count'].includes(normalizedPayloadKey(candidate)) &&
        typeof nested === 'number',
    )
    if (labelEntry) {
      const [, label] = labelEntry
      lines.push(
        `${String(label).trim()}${countEntry ? ` · ${countEntry[1]} ${labels.chunks}` : ''}`,
      )
    }
    entries.forEach(([nestedKey, nested]) => {
      if (nestedKey !== labelEntry?.[0] && nestedKey !== countEntry?.[0])
        visit(nested, nestedKey, depth + 1)
    })
  }
  Object.entries(payload).forEach(([key, value]) => visit(value, key))
  return [...new Set(lines)].slice(0, 12)
}

function researchStagePayloads(events: ResearchTaskProgressEvent[], stage: ResearchStage) {
  const payloads: Record<string, unknown>[] = []
  for (const event of [...events].reverse()) {
    const details = event.payload.details
    if (
      event.payload.previousStage === stage &&
      details &&
      typeof details === 'object' &&
      !Array.isArray(details)
    ) {
      payloads.push(details as Record<string, unknown>)
      continue
    }
    const nested = event.payload[stage]
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      payloads.push(nested as Record<string, unknown>)
      continue
    }
    if (
      event.stage === stage &&
      event.type !== 'research_task.answer_delta' &&
      event.payload.previousStage === undefined
    )
      payloads.push(event.payload)
  }
  return payloads
}

function fallbackResearchStagePayload({
  documentCount,
  evidenceCount,
  stage,
  task,
}: {
  documentCount: number
  evidenceCount: number
  stage: ResearchStage
  task: KnowledgeFsResearchTaskResponse
}): Record<string, unknown> {
  if (stage === 'planning') {
    return {
      questions: [task.query],
      ...(typeof task.top_k === 'number' ? { topK: task.top_k } : {}),
    }
  }
  if (stage === 'retrieving') {
    return {
      documents: documentCount,
      results: [{ chunkCount: evidenceCount, question: task.query }],
    }
  }
  if (stage === 'analyzing') return { chunks: evidenceCount, documents: documentCount }
  return {
    chunks: evidenceCount,
    documents: documentCount,
    sources: documentCount || evidenceCount,
  }
}

function useClock(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [enabled])
  return now
}

function researchStageIndex(stage: KnowledgeFsResearchTaskResponse['stage']) {
  if (stage === 'queued' || stage === 'paused') return 0
  if (stage === 'completed') return researchStageOrder.length
  return researchStageOrder.findIndex((item) => item === stage)
}

function estimatedStageDuration(
  plan: KnowledgeFsResearchTaskPlanResponse | undefined,
  stage: ResearchStage,
) {
  if (!plan) return undefined
  const stepNames: Record<ResearchStage, Set<string>> = {
    analyzing: new Set(['analyze']),
    generating: new Set(['generate']),
    planning: new Set(['plan']),
    retrieving: new Set(['inspect', 'retrieve']),
  }
  const milliseconds = plan.steps.reduce((total, step) => {
    if (!stepNames[stage].has(typeof step.name === 'string' ? step.name : '')) return total
    return total + (typeof step.estimatedLatencyMs === 'number' ? step.estimatedLatencyMs : 0)
  }, 0)
  return milliseconds > 0 ? formatDuration(milliseconds) : undefined
}

function researchProgressTime(event: ResearchTaskProgressEvent) {
  return Date.parse(event.createdAt)
}

function actualStageDuration(
  events: ResearchTaskProgressEvent[],
  stage: ResearchStage,
  task: KnowledgeFsResearchTaskResponse,
  now: number,
) {
  const start = events.find((event) => event.stage === stage)
  if (!start) return
  const startedAt = researchProgressTime(start)
  const next = events.find((event) => {
    if (event.sequence <= start.sequence) return false
    return (
      event.stage === 'canceled' ||
      event.stage === 'completed' ||
      event.stage === 'failed' ||
      (researchStageOrder.includes(event.stage as ResearchStage) && event.stage !== stage)
    )
  })
  const endedAt = next
    ? researchProgressTime(next)
    : task.stage === stage
      ? now
      : task.completed_at
        ? timeValue(task.completed_at)
        : undefined
  if (endedAt === undefined || endedAt < startedAt) return
  return formatDuration(endedAt - startedAt)
}

function mergeResearchProgressEvent(
  events: ResearchTaskProgressEvent[],
  event: ResearchTaskProgressEvent,
) {
  const next = events.filter((candidate) => candidate.sequence !== event.sequence)
  next.push(event)
  return next.sort((left, right) => left.sequence - right.sequence)
}

function ScorePill({ score }: { score: number }) {
  const normalized = Math.max(0, Math.min(1, score))
  return (
    <span className="relative inline-flex h-5 min-w-5 shrink-0 items-center justify-center gap-0.75 overflow-hidden rounded-md border border-components-progress-bar-border bg-util-colors-blue-brand-blue-brand-50 px-1.25 text-util-colors-blue-brand-blue-brand-700">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 border-r-[1.5px] border-components-progress-bar-progress-highlight bg-util-colors-blue-brand-blue-brand-100"
        style={{ width: `${normalized * 100}%` }}
      />
      <span className="relative system-2xs-medium">Score</span>
      <span className="relative system-xs-semibold">{normalized.toFixed(2)}</span>
    </span>
  )
}

function structuredErrorMessage(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const payload = value as Record<string, unknown>
  return (
    structuredErrorMessage(payload.error) ??
    structuredErrorMessage(payload.message) ??
    structuredErrorMessage(payload.detail)
  )
}

function responseErrorMessage(body: string) {
  const trimmedBody = body.trim()
  if (!trimmedBody) return undefined

  try {
    return structuredErrorMessage(JSON.parse(trimmedBody) as unknown)
  } catch {
    return trimmedBody
  }
}

async function queryFailure(error: unknown) {
  let status: number | undefined
  let message = error instanceof Error ? error.message : ''
  if (error instanceof Response) {
    status = error.status
    try {
      const body = await error.clone().text()
      message = responseErrorMessage(body) ?? ''
    } catch {
      // The status and default copy are still enough to render a stable failure state.
    }
  } else if (error && typeof error === 'object' && 'status' in error) {
    status = typeof error.status === 'number' ? error.status : undefined
  }
  const unavailableEmptySnapshot =
    status === 503 &&
    /published runtime snapshot unavailable|publication unavailable/i.test(message)
  return {
    message: unavailableEmptySnapshot ? undefined : message || undefined,
    status: unavailableEmptySnapshot ? ('no-results' as const) : ('failed' as const),
  }
}

function EvidenceCard({
  citationTargetId,
  citationTargeted,
  documentReference,
  evidence,
  index,
  knowledgeSpaceId,
}: {
  citationTargetId?: string
  citationTargeted?: boolean
  documentReference?: {
    id: string
    title: string
  }
  evidence: RetrievalEvidence
  index: number
  knowledgeSpaceId: string
}) {
  const { t } = useTranslation('dataset')
  const openHref = documentReference
    ? newKnowledgeDocumentDetailPath(knowledgeSpaceId, documentReference.id)
    : undefined

  return (
    <article
      id={citationTargetId}
      tabIndex={citationTargetId ? -1 : undefined}
      className={cn(
        'overflow-hidden rounded-xl bg-components-panel-bg outline-hidden',
        citationTargeted && 'ring-2 ring-state-accent-solid ring-inset',
      )}
    >
      <div className="flex items-center gap-2 px-3 pt-3">
        <h3 className="flex min-w-0 flex-1 items-center gap-0.5 truncate system-xs-medium text-text-tertiary">
          <span aria-hidden className="i-custom-public-knowledge-selection-mod size-3 shrink-0" />
          <span className="truncate">{evidence.title || `Chunk ${index + 1}`}</span>
        </h3>
        {evidence.score !== undefined && <ScorePill score={evidence.score} />}
      </div>
      <p className="px-3 pt-1 pb-2 body-md-regular tracking-[-0.07px] text-text-secondary">
        <span className="line-clamp-2 whitespace-pre-wrap">{evidence.text}</span>
      </p>
      {evidence.images.length > 0 && (
        <div className="flex gap-1 overflow-hidden px-3 py-1">
          {evidence.images.slice(0, 4).map((image) => (
            <span key={image} className="flex size-8 shrink-0 items-center justify-center p-0.5">
              <img
                src={image}
                alt=""
                className="size-7.5 border-2 border-effects-image-frame object-cover shadow-xs"
              />
            </span>
          ))}
          {evidence.images.length > 4 && (
            <span className="flex h-8 shrink-0 items-center px-0.5 py-1">
              <span className="flex size-7 items-center justify-center rounded-sm border-[1.5px] border-components-panel-bg bg-divider-regular system-xs-regular text-text-tertiary">
                +{evidence.images.length - 4}
              </span>
            </span>
          )}
        </div>
      )}
      <footer className="flex h-10 items-center gap-1.5 border-t border-divider-subtle py-2 pr-2 pl-3">
        <span
          aria-hidden
          className="i-ri-file-pdf-2-fill size-4 shrink-0 text-util-colors-red-red-500"
        />
        <span className="min-w-0 truncate system-sm-regular text-text-secondary">
          {documentReference?.title ?? evidence.documentName ?? evidence.title}
        </span>
        {evidence.revision && (
          <span className="shrink-0 rounded-xs bg-divider-subtle px-1.25 py-px system-xs-regular text-text-tertiary">
            {t(($) => $['newKnowledge.retrievalTest.revision'], {
              revision: evidence.revision,
            })}
          </span>
        )}
        {evidence.page !== undefined && (
          <span className="shrink-0 system-xs-regular text-text-tertiary">
            {t(($) => $['newKnowledge.retrievalTest.page'], { page: evidence.page })}
          </span>
        )}
        <span className="min-w-0 flex-1" />
        {openHref && (
          <Link
            href={openHref}
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 system-xs-medium text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          >
            {t(($) => $['newKnowledge.retrievalTest.open'])}
            <span aria-hidden className="i-ri-arrow-right-up-line size-3.5" />
          </Link>
        )}
      </footer>
    </article>
  )
}

function ResultSkeleton() {
  const { t } = useTranslation('common')

  return (
    <div role="status" aria-live="polite" aria-label={t(($) => $.loading)} className="space-y-3">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className={cn(
            'flex animate-pulse flex-col gap-2.5 overflow-hidden rounded-xl bg-components-panel-bg px-3 py-3.5 motion-reduce:animate-none',
            item === 2 && 'opacity-60',
          )}
        >
          <div className="flex items-center justify-between overflow-hidden">
            <div className="h-3 w-30 shrink-0 rounded-xs bg-divider-regular" />
            <div className="h-4 w-14 shrink-0 rounded-md bg-divider-subtle" />
          </div>
          <div className="h-3 w-full shrink-0 rounded-xs bg-divider-subtle" />
          <div className="h-3 w-110 max-w-full shrink-0 rounded-xs bg-divider-subtle" />
          <div className="h-px w-full shrink-0 bg-divider-subtle" />
          <div className="flex items-start justify-between overflow-hidden">
            <div className="h-3 w-50 shrink-0 rounded-xs bg-divider-subtle" />
            <div className="h-3 w-10 shrink-0 rounded-xs bg-divider-subtle" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({
  description,
  kind = 'initial',
  title,
}: {
  description: string
  kind?: 'initial' | 'no-results'
  title: string
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-8 text-center">
      <span
        aria-hidden
        className={cn(
          kind === 'initial'
            ? 'i-custom-vender-main-nav-quick-search size-6 text-text-tertiary'
            : 'i-ri-alert-fill size-5 text-text-warning',
        )}
      />
      <h2 className="mt-1.5 system-md-medium text-text-primary">{title}</h2>
      <p className="mt-1.5 max-w-97.25 system-xs-regular text-text-tertiary">{description}</p>
    </div>
  )
}

function FailedResult({ description, onRetry }: { description: string; onRetry: () => void }) {
  const { t } = useTranslation('dataset')
  return (
    <div
      role="alert"
      className="flex min-h-10 items-center gap-1.5 rounded-[10px] bg-util-colors-red-red-500/5 px-3 py-2"
    >
      <span aria-hidden className="i-ri-alert-fill size-3.5 text-text-destructive" />
      <span className="min-w-0 flex-1 truncate system-sm-regular text-text-secondary">
        {t(($) => $['newKnowledge.retrievalTest.failedTitle'])}
        {' — '}
        <span>{description}</span>
      </span>
      <Button size="small" variant="secondary" onClick={onRetry}>
        {t(($) => $['newKnowledge.retrievalTest.retry'])}
      </Button>
    </div>
  )
}

const researchCitationPattern = /(?<!\\)\[(\d+)\](?!\s*(?:\(|:))/g
const researchCodePattern = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*(?:`|$))/g

function linkResearchCitations(answer: string, citationCount: number) {
  return answer
    .split(researchCodePattern)
    .map((segment, index) => {
      if (index % 2 === 1) return segment
      return segment.replace(researchCitationPattern, (citation, rawCitationNumber: string) => {
        const citationNumber = Number(rawCitationNumber)
        if (citationNumber < 1 || citationNumber > citationCount) return citation
        return `[${citation}](#research-evidence-${citationNumber})`
      })
    })
    .join('')
}

type ResearchAnswerLinkProps = PropsWithChildren<AnchorHTMLAttributes<HTMLAnchorElement>> & {
  node?: unknown
  onCitationClick: (citationIndex: number) => void
}

function ResearchAnswerLink({
  children,
  href,
  node,
  onCitationClick,
  ...props
}: ResearchAnswerLinkProps) {
  const citationMatch = href?.match(/^#research-evidence-(\d+)$/)
  if (!citationMatch)
    return (
      <MarkdownLink {...props} href={href} node={node}>
        {children}
      </MarkdownLink>
    )

  const citationIndex = Number(citationMatch[1]) - 1
  return (
    <a
      {...props}
      href={href}
      className="rounded-sm px-0.5 font-medium text-text-accent outline-hidden hover:bg-state-accent-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
      onClick={(event) => {
        event.preventDefault()
        onCitationClick(citationIndex)
      }}
    >
      {children}
    </a>
  )
}

function ResearchAnswer({
  answer,
  citationCount,
  onCitationClick,
  streaming,
}: {
  answer: string
  citationCount: number
  onCitationClick: (citationIndex: number) => void
  streaming: boolean
}) {
  const { t } = useTranslation('dataset')
  const linkedAnswer = useMemo(
    () => linkResearchCitations(answer, citationCount),
    [answer, citationCount],
  )
  const citationComponents = useMemo<NonNullable<MarkdownProps['customComponents']>>(
    () => ({
      a: (props) => <ResearchAnswerLink {...props} onCitationClick={onCitationClick} />,
    }),
    [onCitationClick],
  )
  return (
    <section className="mt-3 rounded-xl border border-components-panel-border bg-components-panel-bg px-4 py-3.5 shadow-xs">
      <header className="mb-3 flex items-center gap-2">
        <span aria-hidden className="i-ri-sparkling-2-fill size-4 text-text-accent" />
        <h3 className="system-sm-semibold text-text-primary">
          {t(($) =>
            streaming
              ? $['newKnowledge.retrievalTest.generatingActive']
              : $['newKnowledge.retrievalTest.generating'],
          )}
        </h3>
        {streaming && (
          <span
            aria-hidden
            className="size-1.5 animate-pulse rounded-full bg-text-accent motion-reduce:animate-none"
          />
        )}
      </header>
      <div aria-live="polite" aria-atomic="false">
        <Markdown
          className="text-[13px]! leading-5.5! wrap-break-word text-text-secondary!"
          content={linkedAnswer}
          customComponents={citationComponents}
          isAnimating={streaming}
          mode={streaming ? 'streaming' : undefined}
        />
      </div>
    </section>
  )
}

function QualityActions({
  badCaseAvailable,
  decision,
  noResults,
  onDecision,
  pending,
  qualityHref,
}: {
  badCaseAvailable: boolean
  decision?: QualityDecision
  noResults?: boolean
  onDecision: (decision: QualityDecision) => Promise<void>
  pending?: boolean
  qualityHref: string
}) {
  const { t } = useTranslation('dataset')
  if (decision) {
    return (
      <div
        aria-live="polite"
        className="flex min-h-14 items-center justify-between gap-3 border-t border-divider-subtle px-5"
      >
        <span className="flex items-center gap-2 system-sm-medium text-text-success">
          <span aria-hidden className="i-ri-checkbox-circle-fill size-4" />
          {t(($) =>
            decision === 'golden'
              ? $['newKnowledge.retrievalTest.savedGoldenQuestion']
              : $['newKnowledge.retrievalTest.savedBadCase'],
          )}
        </span>
        <Link
          href={qualityHref}
          className="rounded-md px-1 py-0.5 system-sm-semibold text-text-accent outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        >
          {t(($) => $['newKnowledge.retrievalTest.viewInQuality'])}
        </Link>
      </div>
    )
  }
  if (!badCaseAvailable && noResults) return null

  return (
    <div className="flex shrink-0 items-center justify-end gap-3 border-t border-divider-regular pt-4 pb-1">
      {badCaseAvailable && (
        <Button
          disabled={pending}
          loading={pending}
          variant={noResults ? 'secondary' : 'ghost'}
          onClick={() => void onDecision('bad-case')}
        >
          <span aria-hidden className="i-ri-thumb-down-line size-4" />
          {t(($) => $['newKnowledge.retrievalTest.makeBadCase'])}
        </Button>
      )}
      {!noResults && (
        <Button
          disabled={pending}
          loading={pending}
          variant="secondary"
          onClick={() => void onDecision('golden')}
        >
          <span aria-hidden className="i-ri-thumb-up-line size-4" />
          {t(($) => $['newKnowledge.retrievalTest.keepGoldenQuestion'])}
        </Button>
      )}
    </div>
  )
}

function ResearchProcess({
  documentCount,
  evidenceCount,
  events,
  expanded,
  onCancel,
  onToggle,
  plan,
  task,
}: {
  documentCount: number
  evidenceCount: number
  events: ResearchTaskProgressEvent[]
  expanded: boolean
  onCancel?: () => void
  onToggle: () => void
  plan?: KnowledgeFsResearchTaskPlanResponse
  task: KnowledgeFsResearchTaskResponse
}) {
  const { t } = useTranslation('dataset')
  const active = researchTaskIsActive(task)
  const now = useClock(active)
  const firstProgressAt = events[0] ? researchProgressTime(events[0]) : undefined
  const terminalProgress = [...events]
    .reverse()
    .find(
      (event) =>
        event.stage === 'canceled' || event.stage === 'completed' || event.stage === 'failed',
    )
  const startedAt = firstProgressAt ?? timeValue(task.created_at)
  const endedAt = terminalProgress
    ? researchProgressTime(terminalProgress)
    : task.completed_at
      ? timeValue(task.completed_at)
      : now
  const duration = formatDuration(endedAt - startedAt)
  const currentIndex = researchStageIndex(task.stage)
  const latestVisitedIndex = events.reduce((latest, event) => {
    const index = researchStageOrder.indexOf(event.stage as ResearchStage)
    return Math.max(latest, index)
  }, -1)
  const summary =
    task.stage === 'completed'
      ? t(($) => $['newKnowledge.retrievalTest.completedIn'], { duration })
      : task.stage === 'canceled'
        ? t(($) => $['newKnowledge.retrievalTest.canceled'])
        : task.stage === 'failed'
          ? t(($) => $['newKnowledge.retrievalTest.failedTitle'])
          : t(($) => $['newKnowledge.retrievalTest.running'])
  const labels: Record<(typeof researchStageOrder)[number], string> = {
    analyzing: t(($) => $['newKnowledge.retrievalTest.analyzing']),
    generating: t(($) => $['newKnowledge.retrievalTest.generating']),
    planning: t(($) => $['newKnowledge.retrievalTest.planning']),
    retrieving: t(($) => $['newKnowledge.retrievalTest.retrieving']),
  }
  const activeLabels: Record<(typeof researchStageOrder)[number], string> = {
    analyzing: t(($) => $['newKnowledge.retrievalTest.analyzingActive']),
    generating: t(($) => $['newKnowledge.retrievalTest.generatingActive']),
    planning: t(($) => $['newKnowledge.retrievalTest.planningActive']),
    retrieving: t(($) => $['newKnowledge.retrievalTest.retrievingActive']),
  }
  const payloadLabels: ResearchPayloadLabels = {
    chunks: t(($) => $['newKnowledge.chunkCount']),
    documents: t(($) => $['newKnowledge.documents']),
    retrievals: t(($) => $['newKnowledge.retrievalCount']),
    sources: t(($) => $['newKnowledge.sources']),
    topK: t(($) => $['newKnowledge.settings.topKLabel']),
  }

  return (
    <section
      className={cn(
        'max-w-full overflow-hidden rounded-[10px] bg-components-panel-bg',
        expanded ? 'w-full' : 'w-fit',
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        className="flex min-h-10 max-w-full items-center gap-1.5 px-3 py-2 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset"
        onClick={onToggle}
      >
        {task.stage === 'completed' ? (
          <img src="/images/new-rag/vibe-coding-star.svg" alt="" className="size-3.5 shrink-0" />
        ) : (
          <span
            aria-hidden
            className={cn(
              'size-3.5 shrink-0 text-text-accent',
              active && 'i-ri-loader-4-line animate-spin motion-reduce:animate-none',
              task.stage === 'canceled' && 'i-ri-stop-circle-fill text-text-tertiary',
              task.stage === 'failed' && 'i-ri-error-warning-fill text-text-destructive',
            )}
          />
        )}
        <span className="truncate system-sm-regular whitespace-nowrap text-text-secondary">
          {summary}
        </span>
        {active && <span className="system-xs-regular text-text-tertiary">{duration}</span>}
        {active && onCancel && (
          <Button
            size="small"
            variant="secondary"
            className="ml-auto"
            onClick={(event) => {
              event.stopPropagation()
              onCancel()
            }}
          >
            {t(($) => $['newKnowledge.retrievalTest.cancel'])}
          </Button>
        )}
        <span
          aria-hidden
          className={cn(
            'i-ri-arrow-down-s-line size-4.5 shrink-0 text-text-tertiary transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>
      {expanded && (
        <div className="border-t border-divider-subtle px-3 pt-2.5 pb-3.5">
          <ol>
            {researchStageOrder.map((stage, index) => {
              const completed =
                task.stage === 'completed' || index < currentIndex || index < latestVisitedIndex
              const current = index === currentIndex && active
              const stageDuration =
                actualStageDuration(events, stage, task, now) ?? estimatedStageDuration(plan, stage)
              const fallbackPayload = fallbackResearchStagePayload({
                documentCount,
                evidenceCount,
                stage,
                task,
              })
              const payloadLines = [...researchStagePayloads(events, stage), fallbackPayload]
                .flatMap((payload) => researchPayloadLines(payload, payloadLabels))
                .filter((line, lineIndex, lines) => lines.indexOf(line) === lineIndex)
                .slice(0, 12)
              return (
                <li key={stage} className="flex items-stretch gap-2.5 overflow-hidden">
                  <span
                    aria-hidden
                    className="flex w-3 shrink-0 flex-col items-center overflow-hidden"
                  >
                    <span className="flex h-5 w-3 shrink-0 items-center justify-center">
                      <span
                        className={cn(
                          'block size-1.75 shrink-0 rounded-full',
                          completed ? 'bg-gray-400' : 'bg-divider-deep',
                          current &&
                            'i-ri-loader-4-line size-2.5 animate-spin rounded-none text-text-accent motion-reduce:animate-none',
                        )}
                      />
                    </span>
                    {index < researchStageOrder.length - 1 && (
                      <span className="min-h-0 w-px flex-1 bg-divider-regular" />
                    )}
                  </span>
                  <span
                    className={cn(
                      'flex min-w-0 flex-1 flex-col overflow-hidden',
                      index < researchStageOrder.length - 1 ? 'pb-4' : 'pb-0.5',
                    )}
                  >
                    <span className="flex min-h-5 items-start justify-between gap-3">
                      <span
                        className={cn(
                          'text-[13px] leading-5 font-medium text-text-tertiary',
                          (completed || current) && 'text-text-primary',
                        )}
                      >
                        {current ? activeLabels[stage] : labels[stage]}
                      </span>
                      {stageDuration && (completed || current) && (
                        <span className="shrink-0 system-xs-regular text-text-tertiary">
                          {stageDuration}
                        </span>
                      )}
                    </span>
                    {current && stage === 'retrieving' && evidenceCount > 0 && (
                      <span className="mt-1.5 system-xs-regular text-text-tertiary">
                        {t(($) => $['newKnowledge.retrievalTest.foundSoFar'], {
                          count: evidenceCount,
                        })}
                      </span>
                    )}
                    {payloadLines.length > 0 && (completed || current) && (
                      <ul className="mt-1.5 space-y-1 system-xs-regular text-text-tertiary">
                        {payloadLines.map((line) => (
                          <li key={line} className="wrap-break-word">
                            {line}
                          </li>
                        ))}
                      </ul>
                    )}
                  </span>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </section>
  )
}

function RecordButton({
  active,
  index,
  onClick,
  record,
}: {
  active: boolean
  index: number
  onClick: () => void
  record: RetrievalTestRecord
}) {
  const { t } = useTranslation('dataset')
  const failed = record.kind !== 'research' && record.status === 'failed'
  const activeResearchStage =
    record.kind === 'research' && record.status === 'running'
      ? researchStageOrder[
          Math.min(Math.max(researchStageIndex(record.stage), 0), researchStageOrder.length - 1)
        ]
      : undefined
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'flex h-16 w-full items-center px-3 text-left outline-hidden transition-colors hover:bg-state-base-hover focus-visible:rounded-[10px] focus-visible:ring-1 focus-visible:ring-state-accent-solid/30 focus-visible:ring-inset',
        index > 1 && 'border-t border-divider-subtle',
        active &&
          'rounded-[10px] bg-state-accent-solid/5 ring-1 ring-state-accent-solid/30 ring-inset hover:bg-state-accent-solid/5',
      )}
      onClick={onClick}
    >
      <span className="min-w-0 flex-1">
        <span className="line-clamp-1 system-sm-semibold text-text-secondary">{record.query}</span>
        <span className="mt-1.5 flex items-center gap-1 system-xs-regular text-text-tertiary">
          <span className={cn('min-w-0 flex-1 truncate', failed && 'text-text-destructive')}>
            {activeResearchStage ? (
              <>
                {t(($) => $[`newKnowledge.retrievalTest.${activeResearchStage}Active`])}
                {' · '}
                {researchStageOrder.indexOf(activeResearchStage) + 1}/{researchStageOrder.length}
              </>
            ) : failed ? (
              record.durationMs !== undefined ? (
                t(($) => $['newKnowledge.retrievalTest.failedAfter'], {
                  duration: formatDuration(record.durationMs),
                })
              ) : (
                t(($) => $['newKnowledge.retrievalTest.failedTitle'])
              )
            ) : record.kind !== 'research' &&
              record.resultCount !== undefined &&
              record.durationMs !== undefined ? (
              t(($) => $['newKnowledge.retrievalTest.recordSummary'], {
                count: record.resultCount,
                duration: formatRetrievalDuration(record.durationMs),
              })
            ) : (
              t(($) => $[`newKnowledge.settings.retrievalMode.${record.mode}`])
            )}
          </span>
          <span className="shrink-0 text-[11px] leading-4 text-text-primary opacity-30">
            <RecordTime value={record.createdAt} />
          </span>
        </span>
      </span>
    </button>
  )
}

export function RetrievalTestPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')
  const queryClient = useQueryClient()
  const [linkedSelection, setLinkedSelection] = useQueryStates({
    research: parseAsString,
    trace: parseAsString,
  })
  const { research: linkedResearchId, trace: linkedTraceId } = linkedSelection
  const [composerDraft, setComposerDraft] = useState<ComposerDraft>({ mode: 'fast', query: '' })
  const [localRun, setLocalRun] = useState<LocalQueryRun>()
  const [localSelected, setLocalSelected] = useState<SelectedRun>()
  const [researchPlans, setResearchPlans] = useState<
    Record<string, KnowledgeFsResearchTaskPlanResponse>
  >({})
  const [researchEvents, setResearchEvents] = useState<Record<string, ResearchTaskProgressEvent[]>>(
    {},
  )
  const [admittedResearchTasks, setAdmittedResearchTasks] = useState<
    Record<string, KnowledgeFsResearchTaskResponse>
  >({})
  const [researchExpanded, setResearchExpanded] = useState<Record<string, boolean>>({})
  const [qualityDecisions, setQualityDecisions] = useState<Record<string, QualityDecision>>({})
  const [qualityPendingKey, setQualityPendingKey] = useState<string>()
  const [showAll, setShowAll] = useState(false)
  const [selectedCitation, setSelectedCitation] = useState<{
    citationIndex: number
    requestId: number
    taskId: string
  }>()
  const queryAbortControllerRef = useRef<AbortController>(undefined)
  const runInFlightRef = useRef(false)

  useEffect(
    () => () => {
      queryAbortControllerRef.current?.abort()
    },
    [],
  )

  const tracesQuery = useQuery({
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.traces.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId } },
    }),
    refetchInterval: localRun?.status === 'running' ? 1000 : false,
  })
  const researchTasksQuery = useQuery({
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.researchTasks.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId } },
    }),
    refetchInterval: (current) => {
      const persistedTasks = current.state.data?.data ?? []
      const persistedById = new Map(persistedTasks.map((task) => [task.id, task]))
      const admittedTaskIsActive = Object.values(admittedResearchTasks).some((task) => {
        const persisted = persistedById.get(task.id)
        const effectiveTask =
          persisted && persisted.updated_at >= task.updated_at ? persisted : task
        return researchTaskIsActive(effectiveTask)
      })
      return admittedTaskIsActive || persistedTasks.some((task) => researchTaskIsActive(task))
        ? 1000
        : false
    },
  })
  const researchTasks = useMemo(() => {
    const byId = new Map(
      Object.values(admittedResearchTasks).map((task) => [task.id, task] as const),
    )
    for (const persisted of researchTasksQuery.data?.data ?? []) {
      const admitted = byId.get(persisted.id)
      if (!admitted || persisted.updated_at >= admitted.updated_at)
        byId.set(persisted.id, persisted)
    }
    return [...byId.values()]
  }, [admittedResearchTasks, researchTasksQuery.data?.data])
  const records = useMemo(
    () => retrievalTestRecords(tracesQuery.data?.data ?? [], researchTasks),
    [researchTasks, tracesQuery.data?.data],
  )
  const localRecord: RetrievalTestRecord | undefined =
    localRun && localRun.status !== 'running'
      ? {
          createdAt: localRun.startedAt,
          id: localRun.id,
          kind: 'local',
          mode: localRun.mode,
          query: localRun.query,
          durationMs: localRun.endedAt ? localRun.endedAt - localRun.startedAt : undefined,
          resultCount: localRun.evidence.length,
          status: localRun.status === 'no-results' ? 'completed' : localRun.status,
        }
      : undefined
  const traceAlreadyListed = Boolean(
    localRun?.traceId &&
    records.some((record) => record.kind === 'trace' && record.id === localRun.traceId),
  )
  const displayRecords = localRecord && !traceAlreadyListed ? [localRecord, ...records] : records
  const requestedSelection: SelectedRun | undefined = linkedResearchId
    ? { id: linkedResearchId, kind: 'research' }
    : linkedTraceId
      ? { id: linkedTraceId, kind: 'trace' }
      : localSelected
  const newestRecord = displayRecords[0]
  const selected: SelectedRun | undefined =
    requestedSelection ??
    (newestRecord ? { id: newestRecord.id, kind: newestRecord.kind } : undefined)
  const selectedHistoryKey =
    selected && selected.kind !== 'local' ? `${selected.kind}:${selected.id}` : undefined
  const selectedRecord = records.find(
    (record) => record.id === selected?.id && record.kind === selected.kind,
  )
  const selectedFailed =
    (selected?.kind === 'local' && localRun?.status === 'failed') ||
    (selected?.kind === 'trace' && selectedRecord?.status === 'failed')
  const selectedHistoryRecord = selected?.kind === 'local' ? undefined : selectedRecord
  const query =
    composerDraft.selectionKey === selectedHistoryKey
      ? composerDraft.query
      : (selectedHistoryRecord?.query ?? '')
  const mode =
    composerDraft.selectionKey === selectedHistoryKey
      ? composerDraft.mode
      : (selectedHistoryRecord?.mode ?? 'fast')
  const selectedResearchTask =
    selected?.kind === 'research'
      ? researchTasks.find((task) => task.id === selected.id)
      : undefined
  const selectedResearchActive = researchTaskIsActive(selectedResearchTask)
  const selectedResearchActiveRef = useRef(selectedResearchActive)
  useEffect(() => {
    selectedResearchActiveRef.current = selectedResearchActive
  }, [selectedResearchActive])
  const selectedResearchDefaultExpanded = researchTaskIsActive(selectedResearchTask)
  const selectedResearchExpanded = selectedResearchTask
    ? (researchExpanded[selectedResearchTask.id] ?? selectedResearchDefaultExpanded)
    : false
  const selectedTraceId =
    selected?.kind === 'trace'
      ? selected.id
      : selected?.kind === 'local'
        ? localRun?.traceId
        : undefined

  const traceDetailQuery = useQuery({
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.traces.byTraceId.get.queryOptions({
      input: {
        params: {
          control_space_id: knowledgeSpaceId,
          trace_id: selectedTraceId ?? '',
        },
      },
    }),
    enabled: Boolean(selectedTraceId) && !selectedFailed,
  })
  const traceEvidenceQuery = useQuery({
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.traces.byTraceId.evidence.get.queryOptions({
      input: {
        params: {
          control_space_id: knowledgeSpaceId,
          trace_id: selectedTraceId ?? '',
        },
        query: { limit: 100 },
      },
    }),
    enabled: Boolean(selectedTraceId) && !selectedFailed,
  })
  const researchPartialsQuery = useQuery({
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.researchTasks.byTaskId.partials.get.queryOptions(
      {
        input: {
          params: {
            control_space_id: knowledgeSpaceId,
            task_id: selectedResearchTask?.id ?? '',
          },
          query: { limit: 100 },
        },
      },
    ),
    enabled: Boolean(selectedResearchTask),
    refetchInterval: researchTaskIsActive(selectedResearchTask) ? 1000 : false,
  })
  const refetchResearchPartials = researchPartialsQuery.refetch
  const refetchResearchTasks = researchTasksQuery.refetch
  const previousSelectedResearchTaskRef = useRef<KnowledgeFsResearchTaskResponse | undefined>(
    undefined,
  )
  useEffect(() => {
    const previousTask = previousSelectedResearchTaskRef.current
    previousSelectedResearchTaskRef.current = selectedResearchTask
    if (!shouldRefreshResearchPartials(previousTask, selectedResearchTask)) return
    void refetchResearchPartials()
  }, [refetchResearchPartials, selectedResearchTask])

  const selectedResearchTaskId = selectedResearchTask?.id
  useEffect(() => {
    if (!selectedResearchTaskId) return
    const controller = new AbortController()
    void (async () => {
      try {
        let cursor: string | undefined
        while (!controller.signal.aborted) {
          const capability = await consoleClient.knowledgeFs.tasks.byTaskId.streamCapability.post({
            body: { control_space_id: knowledgeSpaceId },
            params: { task_id: selectedResearchTaskId },
          })
          const stream = await streamResearchTaskEvents({
            capability,
            ...(cursor ? { cursor } : {}),
            onEvent: (event) => {
              if (controller.signal.aborted) return
              setResearchEvents((current) => ({
                ...current,
                [selectedResearchTaskId]: mergeResearchProgressEvent(
                  current[selectedResearchTaskId] ?? [],
                  event,
                ),
              }))
              setAdmittedResearchTasks((current) => {
                const task = current[selectedResearchTaskId]
                if (!task) return current
                const eventTime = Date.parse(event.createdAt)
                const updatedAt = Number.isFinite(eventTime)
                  ? Math.max(task.updated_at, Math.floor(eventTime / 1000))
                  : task.updated_at
                return {
                  ...current,
                  [selectedResearchTaskId]: {
                    ...task,
                    ...(event.stage === 'canceled' ||
                    event.stage === 'completed' ||
                    event.stage === 'failed'
                      ? { completed_at: updatedAt }
                      : {}),
                    stage: event.stage,
                    updated_at: updatedAt,
                  },
                }
              })
              const terminal =
                event.stage === 'canceled' ||
                event.stage === 'completed' ||
                event.stage === 'failed'
              if (!terminal || !selectedResearchActiveRef.current) return
              if (event.stage === 'completed') void refetchResearchTasks()
              else void Promise.all([refetchResearchTasks(), refetchResearchPartials()])
            },
            signal: controller.signal,
          })
          if (stream.terminal || !stream.reconnect || !stream.cursor) return
          cursor = stream.cursor
        }
      } catch {
        // Task polling remains the fallback when capability streaming is unavailable.
      }
    })()
    return () => controller.abort()
  }, [knowledgeSpaceId, refetchResearchPartials, refetchResearchTasks, selectedResearchTaskId])

  const historicalEvidence = extractRetrievalEvidence(traceEvidenceQuery.data)
  const researchEvidence = extractRetrievalEvidence(researchPartialsQuery.data)
  const selectedResearchEvents = selectedResearchTask
    ? (researchEvents[selectedResearchTask.id] ?? [])
    : []
  const streamedResearchAnswer = researchTaskAnswerFromEvents(selectedResearchEvents)
  const persistedResearchAnswer = [...(researchPartialsQuery.data?.data ?? [])]
    .sort((left, right) => right.sequence - left.sequence)
    .find((partial) => partial.answer?.trim())
    ?.answer?.trim()
  const researchAnswer = selectedResearchTask
    ? (persistedResearchAnswer ?? streamedResearchAnswer)
    : ''
  const currentEvidence = selectedFailed
    ? []
    : selected?.kind === 'local' && localRun
      ? localRun.evidence.length
        ? localRun.evidence
        : historicalEvidence
      : selected?.kind === 'research'
        ? researchEvidence
        : historicalEvidence
  const currentEvidenceDocumentCount = new Set(
    currentEvidence
      .map((evidence) => evidence.documentId ?? evidence.documentName)
      .filter((document): document is string => Boolean(document)),
  ).size
  const evidenceDocumentReferencesQuery = useQuery({
    queryKey: ['retrieval-document-references', knowledgeSpaceId],
    enabled: currentEvidence.some((evidence) => evidence.documentId),
    queryFn: async () => {
      const references: Record<string, { id: string; title: string }> = {}
      const visitedCursors = new Set<string>()
      let cursor: string | undefined
      do {
        const response =
          await consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get({
            params: { control_space_id: knowledgeSpaceId },
            ...(cursor ? { query: { cursor } } : {}),
          })
        response.data.forEach((document) => {
          if (document.active)
            references[document.active.document_asset_id] = {
              id: document.id,
              title: document.title,
            }
        })
        const nextCursor = response.next_cursor ?? undefined
        if (!nextCursor || visitedCursors.has(nextCursor)) break
        visitedCursors.add(nextCursor)
        cursor = nextCursor
      } while (cursor)
      return references
    },
  })
  const resultKey = selected ? `${selected.kind}:${selected.id}` : undefined
  const selectedQuery =
    selected?.kind === 'local'
      ? localRun?.query
      : (selectedRecord?.query ?? traceDetailQuery.data?.query)
  const selectedMode =
    selected?.kind === 'local'
      ? localRun?.mode
      : (selectedRecord?.mode ?? traceDetailQuery.data?.mode)
  const selectedCreatedAt =
    selected?.kind === 'local'
      ? localRun?.startedAt
      : (selectedRecord?.createdAt ??
        (selectedResearchTask ? timeValue(selectedResearchTask.created_at) : undefined))
  const selectedIsLoading =
    (selected?.kind === 'local' && localRun?.status === 'running') ||
    (selected?.kind === 'trace' && !selectedRecord && traceDetailQuery.isPending) ||
    (selected?.kind === 'trace' && !selectedFailed && traceEvidenceQuery.isPending)
  const selectedHasNoResults = selected?.kind === 'local' && localRun?.status === 'no-results'
  const initialEvidenceCount = selectedMode === 'research' ? 5 : 3
  const visibleEvidence = showAll ? currentEvidence : currentEvidence.slice(0, initialEvidenceCount)
  const selectedCitationIndex =
    selectedCitation && selectedCitation.taskId === selectedResearchTaskId
      ? selectedCitation.citationIndex
      : undefined
  const jumpToResearchCitation = useCallback(
    (citationIndex: number) => {
      if (!selectedResearchTaskId || citationIndex < 0 || citationIndex >= currentEvidence.length)
        return
      setShowAll(true)
      setSelectedCitation((current) => ({
        citationIndex,
        requestId: (current?.requestId ?? 0) + 1,
        taskId: selectedResearchTaskId,
      }))
    },
    [currentEvidence.length, selectedResearchTaskId],
  )

  useEffect(() => {
    if (selectedCitationIndex === undefined || !selectedCitation) return
    const target = document.getElementById(`research-evidence-${selectedCitationIndex + 1}`)
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    target.focus({ preventScroll: true })
  }, [selectedCitation, selectedCitationIndex, visibleEvidence.length])

  const selectRecord = (record: RetrievalTestRecord) => {
    if (record.kind === 'local') {
      setLocalSelected({ id: record.id, kind: record.kind })
      void setLinkedSelection({ research: null, trace: null }, { history: 'push' })
    } else {
      setLocalSelected(undefined)
      void setLinkedSelection(
        {
          research: record.kind === 'research' ? record.id : null,
          trace: record.kind === 'trace' ? record.id : null,
        },
        { history: 'push', shallow: false },
      )
    }
    setComposerDraft({
      mode: record.mode,
      query: record.query,
      ...(record.kind === 'local' ? {} : { selectionKey: `${record.kind}:${record.id}` }),
    })
    setShowAll(false)
  }

  const saveQualityDecision = async (decision: QualityDecision) => {
    if (!resultKey || !selectedQuery) return
    setQualityPendingKey(resultKey)
    try {
      if (decision === 'bad-case') {
        if (!selectedTraceId) {
          toast.error(t(($) => $.unknownError))
          return
        }
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.quality.badCases.post({
          body: {
            reason: selectedQuery,
            tags: ['retrieval-test'],
            trace_id: selectedTraceId,
          },
          params: { control_space_id: knowledgeSpaceId },
        })
      } else {
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.post({
          body: {
            annotation: selectedQuery,
            question: selectedQuery,
            tags: ['retrieval-test'],
          },
          params: { control_space_id: knowledgeSpaceId },
        })
        await queryClient.invalidateQueries({
          queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.get.key({
            input: { params: { control_space_id: knowledgeSpaceId } },
            type: 'infinite',
          }),
        })
      }
      setQualityDecisions((current) => ({ ...current, [resultKey]: decision }))
    } catch {
      toast.error(t(($) => $.unknownError))
    } finally {
      setQualityPendingKey(undefined)
    }
  }

  const runFastQuery = async () => {
    const cleanQuery = query.trim()
    if (!cleanQuery || runInFlightRef.current) return
    runInFlightRef.current = true
    queryAbortControllerRef.current?.abort()
    const controller = new AbortController()
    queryAbortControllerRef.current = controller
    const id = crypto.randomUUID()
    const startedAt = Date.now()
    const runMode = mode === 'deep' ? 'deep' : 'fast'
    setComposerDraft({ mode: runMode, query: cleanQuery })
    setLocalRun({
      evidence: [],
      id,
      mode: runMode,
      query: cleanQuery,
      startedAt,
      status: 'running',
    })
    setLocalSelected({ id, kind: 'local' })
    void setLinkedSelection({ research: null, trace: null }, { history: 'replace' })
    setShowAll(false)
    const events: KnowledgeQueryEvent[] = []
    try {
      const admission =
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.queries.admission.post({
          body: { mode: runMode, query: cleanQuery },
          params: { control_space_id: knowledgeSpaceId },
        })
      await streamKnowledgeQuery({
        admission,
        onEvent: (event) => {
          events.push(event)
          const eventError = extractStreamError(
            event.data && typeof event.data === 'object'
              ? { ...event.data, event: event.event }
              : { event: event.event, message: event.data },
          )
          if (eventError) throw new Error(eventError)
          const eventEvidence = extractRetrievalEvidence(events.map((item) => item.data))
          setLocalRun((current) =>
            current?.id === id ? { ...current, evidence: eventEvidence } : current,
          )
        },
        signal: controller.signal,
      })
      const eventData = events.map((event) => event.data)
      const traceId = extractTraceId(eventData)
      let evidence = extractRetrievalEvidence(eventData)
      if (traceId && evidence.length === 0) {
        const traceEvidence =
          await consoleClient.knowledgeFs.spaces.byControlSpaceId.traces.byTraceId.evidence.get({
            params: { control_space_id: knowledgeSpaceId, trace_id: traceId },
            query: { limit: 100 },
          })
        evidence = extractRetrievalEvidence(traceEvidence)
      }
      const endedAt = Date.now()
      setLocalRun((current) =>
        current?.id === id
          ? {
              ...current,
              endedAt,
              evidence,
              status: 'completed',
              traceId,
            }
          : current,
      )
      const refreshedTraces = await tracesQuery.refetch()
      if (traceId && refreshedTraces.data?.data.some((trace) => trace.id === traceId))
        setLocalSelected({ id: traceId, kind: 'trace' })
    } catch (error) {
      if (controller.signal.aborted) return
      const failure = await queryFailure(error)
      setLocalRun((current) =>
        current?.id === id
          ? {
              ...current,
              endedAt: Date.now(),
              error: failure.message,
              status: failure.status,
            }
          : current,
      )
    } finally {
      if (queryAbortControllerRef.current === controller)
        queryAbortControllerRef.current = undefined
      runInFlightRef.current = false
    }
  }

  const startResearch = async () => {
    const cleanQuery = query.trim()
    if (!cleanQuery || runInFlightRef.current) return
    runInFlightRef.current = true
    try {
      const plan = await consoleClient.knowledgeFs.spaces.byControlSpaceId.researchTasks.plan.post({
        body: { mode: 'research', query: cleanQuery },
        params: { control_space_id: knowledgeSpaceId },
      })
      const task = await consoleClient.knowledgeFs.spaces.byControlSpaceId.researchTasks.post({
        body: {
          budgetUsd: plan.budget.budget_usd,
          mode: 'research',
          query: cleanQuery,
          topK: plan.retrieval_plan.top_k,
        },
        params: { control_space_id: knowledgeSpaceId },
      })
      setAdmittedResearchTasks((current) => ({ ...current, [task.id]: task }))
      setResearchPlans((current) => ({ ...current, [task.id]: plan }))
      setResearchExpanded((current) => ({ ...current, [task.id]: true }))
      setComposerDraft({
        mode: 'research',
        query: cleanQuery,
        selectionKey: `research:${task.id}`,
      })
      setLocalSelected(undefined)
      void setLinkedSelection(
        { research: task.id, trace: null },
        { history: 'push', shallow: false },
      )
      setShowAll(false)
      await researchTasksQuery.refetch()
    } catch {
      toast.error(t(($) => $['newKnowledge.retrievalTest.failedDescription']))
    } finally {
      runInFlightRef.current = false
    }
  }

  const cancelResearch = async (taskId: string) => {
    try {
      await consoleClient.knowledgeFs.spaces.byControlSpaceId.researchTasks.byTaskId.delete({
        params: { control_space_id: knowledgeSpaceId, task_id: taskId },
      })
      await Promise.all([researchTasksQuery.refetch(), researchPartialsQuery.refetch()])
    } catch {
      toast.error(t(($) => $['newKnowledge.taskActionFailed']))
    }
  }

  const run = () => {
    if (selectedResearchActive || localRun?.status === 'running') return
    if (mode === 'research') void startResearch()
    else void runFastQuery()
  }

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-components-panel-bg p-5">
      <header className="shrink-0">
        <h1 className="title-xl-semi-bold leading-6 text-text-primary">
          {t(($) => $['newKnowledge.retrievalTest.title'])}
        </h1>
        <p className="mt-1 w-full system-xs-regular text-text-tertiary">
          {t(($) => $['newKnowledge.retrievalTest.description'])}
        </p>
      </header>

      <div className="mt-4 flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        <section className="flex min-h-0 w-full shrink-0 flex-col pb-5 lg:w-117 lg:pr-6">
          <div className="shrink-0">
            <div className="overflow-hidden rounded-xl bg-components-panel-bg shadow-xs inset-ring-2 inset-ring-components-input-border-active-prompt-2">
              <label className="sr-only" htmlFor="retrieval-test-query">
                {t(($) => $['newKnowledge.retrievalTest.queryPlaceholder'])}
              </label>
              <textarea
                id="retrieval-test-query"
                value={query}
                maxLength={2000}
                disabled={selectedResearchActive || localRun?.status === 'running'}
                placeholder={t(($) => $['newKnowledge.retrievalTest.queryPlaceholder'])}
                className="block h-36 w-full resize-none bg-transparent p-3.5 body-md-regular text-text-primary outline-hidden placeholder:text-text-quaternary"
                onChange={(event) =>
                  setComposerDraft({
                    mode,
                    query: event.target.value,
                    ...(selectedHistoryKey ? { selectionKey: selectedHistoryKey } : {}),
                  })
                }
                onKeyDown={(event) => {
                  if (matchesKeyboardEvent(event.nativeEvent, runRetrievalHotkey)) {
                    event.preventDefault()
                    run()
                  }
                }}
              />
              <div className="flex min-h-13 items-center justify-between gap-3 p-2.5">
                <RetrievalModeSegmentedControl
                  aria-label={t(($) => $['newKnowledge.settings.retrievalModeLabel'])}
                  appearance="composer"
                  disabled={selectedResearchActive || localRun?.status === 'running'}
                  value={mode}
                  onChange={(nextMode) =>
                    setComposerDraft({
                      mode: nextMode,
                      query,
                      ...(selectedHistoryKey ? { selectionKey: selectedHistoryKey } : {}),
                    })
                  }
                />
                <Button
                  variant="primary"
                  className="px-3.25"
                  disabled={
                    !query.trim() || selectedResearchActive || localRun?.status === 'running'
                  }
                  onClick={run}
                >
                  <span aria-hidden className="i-ri-play-circle-line size-4" />
                  {t(($) =>
                    mode === 'research'
                      ? $['newKnowledge.retrievalTest.startResearch']
                      : $['newKnowledge.retrievalTest.run'],
                  )}
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-3 flex min-h-0 flex-1 flex-col pt-6">
            <div className="flex shrink-0 items-center pb-2 pl-3">
              <h2 className="system-xs-medium text-text-tertiary">
                {t(($) => $['newKnowledge.retrievalTest.records'])}
              </h2>
            </div>
            <div className="min-h-0 flex-1 scrollbar-none overflow-y-auto">
              {displayRecords.length > 0 ? (
                <div>
                  {displayRecords.map((record, index) => (
                    <RecordButton
                      key={`${record.kind}:${record.id}`}
                      index={index}
                      record={record}
                      active={selected?.kind === record.kind && selected.id === record.id}
                      onClick={() => selectRecord(record)}
                    />
                  ))}
                </div>
              ) : (
                <p className="px-3 py-5 body-sm-regular text-text-quaternary">
                  {t(($) => $['newKnowledge.retrievalTest.emptyRecords'])}
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl bg-background-body p-5">
          {!selected && (
            <EmptyState
              title={t(($) => $['newKnowledge.retrievalTest.emptyTitle'])}
              description={t(($) => $['newKnowledge.retrievalTest.emptyDescription'])}
            />
          )}
          {selected && (
            <div className="flex h-full min-h-0 flex-col gap-3">
              <div className="flex h-5 shrink-0 items-center gap-2 overflow-hidden pl-3">
                <h2 className="shrink-0 system-sm-semibold leading-5 text-text-primary">
                  {selected?.kind === 'research'
                    ? t(($) => $['newKnowledge.retrievalTest.researchResult'])
                    : t(($) => $['newKnowledge.retrievalTest.result'])}
                </h2>
                <span className="shrink-0 rounded-md bg-divider-regular px-1.5 py-0.5 text-[11px] leading-4 font-medium text-text-tertiary capitalize">
                  {selectedMode
                    ? t(($) => $[`newKnowledge.settings.retrievalMode.${selectedMode}`])
                    : ''}
                </span>
                {!selectedIsLoading && selectedCreatedAt && (
                  <span className="shrink-0 text-[11px] leading-4 text-text-tertiary">
                    <RecordTime key={selectedCreatedAt} value={selectedCreatedAt} />
                  </span>
                )}
                <span className="min-w-0 flex-1" />
                {selectedResearchTask && (
                  <button
                    type="button"
                    aria-pressed={selectedResearchExpanded}
                    className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 system-xs-medium text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                    onClick={() =>
                      setResearchExpanded((current) => ({
                        ...current,
                        [selectedResearchTask.id]: !(
                          current[selectedResearchTask.id] ?? selectedResearchDefaultExpanded
                        ),
                      }))
                    }
                  >
                    <span aria-hidden className="i-ri-search-eye-line size-3.5" />
                    {t(($) => $['newKnowledge.retrievalTest.processLog'])}
                  </button>
                )}
                {selectedResearchTask?.stage === 'completed' && (
                  <Link
                    href={newKnowledgeQualityPath(knowledgeSpaceId)}
                    className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 system-xs-medium text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                  >
                    <span aria-hidden className="i-ri-equalizer-2-line size-3.5" />
                    {t(($) => $['newKnowledge.retrievalTest.quality'])}
                  </Link>
                )}
              </div>

              <div className="min-h-0 flex-1 scrollbar-none overflow-y-auto">
                {selectedResearchTask && (
                  <ResearchProcess
                    task={selectedResearchTask}
                    plan={researchPlans[selectedResearchTask.id]}
                    events={selectedResearchEvents}
                    evidenceCount={currentEvidence.length}
                    documentCount={currentEvidenceDocumentCount}
                    expanded={selectedResearchExpanded}
                    onToggle={() =>
                      setResearchExpanded((current) => ({
                        ...current,
                        [selectedResearchTask.id]: !(
                          current[selectedResearchTask.id] ?? selectedResearchDefaultExpanded
                        ),
                      }))
                    }
                    onCancel={
                      selectedResearchActive
                        ? () => void cancelResearch(selectedResearchTask.id)
                        : undefined
                    }
                  />
                )}

                {selectedResearchTask && researchAnswer && (
                  <ResearchAnswer
                    answer={researchAnswer}
                    citationCount={currentEvidence.length}
                    onCitationClick={jumpToResearchCitation}
                    streaming={selectedResearchActive && !persistedResearchAnswer}
                  />
                )}

                {selectedIsLoading && <ResultSkeleton />}

                {selectedFailed && (
                  <FailedResult
                    description={
                      (selected?.kind === 'local' ? localRun?.error : undefined) ||
                      t(($) => $['newKnowledge.retrievalTest.failedDescription'])
                    }
                    onRetry={() => void runFastQuery()}
                  />
                )}

                {!selectedIsLoading &&
                  !selectedFailed &&
                  !researchTaskIsActive(selectedResearchTask) &&
                  !researchAnswer &&
                  (selectedHasNoResults || currentEvidence.length === 0) && (
                    <EmptyState
                      kind="no-results"
                      title={t(($) => $['newKnowledge.retrievalTest.noChunksTitle'])}
                      description={t(($) => $['newKnowledge.retrievalTest.noChunksDescription'])}
                    />
                  )}

                {currentEvidence.length > 0 && (
                  <div className={cn(selectedResearchTask && 'mt-3')}>
                    {selectedResearchActive && (
                      <h3 className="flex h-6 items-start pb-2 pl-3 system-xs-medium text-text-tertiary">
                        {t(($) => $['newKnowledge.retrievalTest.foundSoFar'], {
                          count: currentEvidence.length,
                        })}
                      </h3>
                    )}
                    <div className="space-y-3">
                      {visibleEvidence.map((evidence, index) => (
                        <EvidenceCard
                          key={evidence.id}
                          citationTargetId={
                            selectedResearchTask ? `research-evidence-${index + 1}` : undefined
                          }
                          citationTargeted={selectedCitationIndex === index}
                          documentReference={
                            evidence.documentId
                              ? evidenceDocumentReferencesQuery.data?.[evidence.documentId]
                              : undefined
                          }
                          evidence={evidence}
                          index={index}
                          knowledgeSpaceId={knowledgeSpaceId}
                        />
                      ))}
                      {selectedResearchTask && researchTaskIsActive(selectedResearchTask) && (
                        <div className="h-16.5 animate-pulse rounded-xl bg-components-panel-bg px-3 py-3.5 opacity-60 motion-reduce:animate-none">
                          <div className="flex items-start justify-between">
                            <div className="h-3 w-30 rounded-xs bg-divider-regular" />
                            <div className="h-4 w-14 rounded-md bg-divider-subtle" />
                          </div>
                          <div className="mt-2.5 h-3 w-full rounded-xs bg-divider-subtle" />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {!showAll && currentEvidence.length > initialEvidenceCount && (
                <div className="shrink-0 pl-1">
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-md px-1.5 py-1 system-xs-medium text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                    onClick={() => setShowAll(true)}
                  >
                    {t(($) => $['newKnowledge.retrievalTest.showAllChunks'], {
                      count: currentEvidence.length,
                    })}
                    <span aria-hidden className="i-ri-arrow-down-s-line size-3.5" />
                  </button>
                </div>
              )}

              {!selectedIsLoading &&
                !selectedFailed &&
                !researchTaskIsActive(selectedResearchTask) &&
                resultKey && (
                  <QualityActions
                    badCaseAvailable={Boolean(selectedTraceId)}
                    noResults={currentEvidence.length === 0}
                    decision={qualityDecisions[resultKey]}
                    onDecision={saveQualityDecision}
                    pending={qualityPendingKey === resultKey}
                    qualityHref={newKnowledgeQualityPath(knowledgeSpaceId)}
                  />
                )}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
