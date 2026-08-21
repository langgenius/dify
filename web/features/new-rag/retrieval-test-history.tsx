'use client'

import type {
  KnowledgeFsResearchTaskPlanResponse,
  KnowledgeFsResearchTaskResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { RetrievalTestRecord } from './retrieval-test-model'
import type { ResearchTaskProgressEvent } from './services/research-task-events'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { timeValue } from './retrieval-test-history-utils'
import {
  formatDuration,
  formatRetrievalDuration,
  formatStageDuration,
  researchTaskIsActive,
} from './retrieval-test-model'

const researchStageOrder = ['planning', 'retrieving', 'analyzing', 'generating'] as const
type ResearchStage = (typeof researchStageOrder)[number]

function formatRecordTime(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(value)
}

export function RecordTime({ value }: { value: number }) {
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
  locale: string,
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
  return milliseconds > 0 ? formatStageDuration(milliseconds, locale) : undefined
}

function researchProgressTime(event: ResearchTaskProgressEvent) {
  return Date.parse(event.createdAt)
}

function actualStageDuration(
  events: ResearchTaskProgressEvent[],
  stage: ResearchStage,
  task: KnowledgeFsResearchTaskResponse,
  now: number,
  locale: string,
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
  return formatStageDuration(endedAt - startedAt, locale)
}

export function ResearchProcess({
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
  const { t, i18n } = useTranslation('dataset')
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
  const duration = formatDuration(endedAt - startedAt, i18n.language)
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
      <div className="flex min-h-10 max-w-full items-center">
        <button
          type="button"
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch px-3 py-2 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset"
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
          <span
            aria-hidden
            className={cn(
              'i-ri-arrow-down-s-line size-4.5 shrink-0 text-text-tertiary transition-transform',
              expanded && 'rotate-180',
            )}
          />
        </button>
        {active && onCancel && (
          <Button size="small" variant="secondary" className="mr-3 shrink-0" onClick={onCancel}>
            {t(($) => $['newKnowledge.retrievalTest.cancel'])}
          </Button>
        )}
      </div>
      {expanded && (
        <div className="border-t border-divider-subtle px-3 pt-2.5 pb-3.5">
          <ol>
            {researchStageOrder.map((stage, index) => {
              const completed =
                task.stage === 'completed' || index < currentIndex || index < latestVisitedIndex
              const current = index === currentIndex && active
              const stageDuration =
                actualStageDuration(events, stage, task, now, i18n.language) ??
                estimatedStageDuration(plan, stage, i18n.language)
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

export function RecordButton({
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
  const { t, i18n } = useTranslation('dataset')
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
                  duration: formatDuration(record.durationMs, i18n.language),
                })
              ) : (
                t(($) => $['newKnowledge.retrievalTest.failedTitle'])
              )
            ) : record.kind !== 'research' &&
              record.resultCount !== undefined &&
              record.durationMs !== undefined ? (
              t(($) => $['newKnowledge.retrievalTest.recordSummary'], {
                count: record.resultCount,
                duration: formatRetrievalDuration(record.durationMs, i18n.language),
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
