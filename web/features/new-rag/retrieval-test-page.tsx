'use client'

import type {
  KnowledgeFsResearchTaskPlanResponse,
  KnowledgeFsResearchTaskResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type {
  RetrievalEvidence,
  RetrievalTestMode,
  RetrievalTestRecord,
} from './retrieval-test-model'
import type { KnowledgeQueryEvent } from './services/knowledge-query-events'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { consoleClient, consoleQuery } from '@/service/client'
import {
  extractRetrievalEvidence,
  extractStreamError,
  extractTraceId,
  formatDuration,
  researchTaskIsActive,
  retrievalTestRecords,
} from './retrieval-test-model'
import { newKnowledgeDocumentDetailPath } from './routes'
import { streamKnowledgeQuery } from './services/knowledge-query-events'

type LocalQueryRun = {
  endedAt?: number
  error?: string
  evidence: RetrievalEvidence[]
  id: string
  mode: Exclude<RetrievalTestMode, 'research'>
  query: string
  startedAt: number
  status: 'completed' | 'failed' | 'running'
  traceId?: string
}

type SelectedRun = {
  id: string
  kind: 'local' | RetrievalTestRecord['kind']
}

type QualityDecision = 'bad-case' | 'golden'

const researchStageOrder = ['planning', 'retrieving', 'analyzing', 'generating'] as const

function timeValue(value: number) {
  return value < 10_000_000_000 ? value * 1000 : value
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

function ScorePill({ score }: { score: number }) {
  const normalized = Math.max(0, Math.min(1, score))
  return (
    <span className="bg-components-badge-bg relative inline-flex h-6 min-w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-components-panel-border px-2 system-xs-semibold text-text-secondary">
      {normalized.toFixed(2)}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-util-colors-blue-blue-500"
        style={{ transform: `scaleX(${normalized})` }}
      />
    </span>
  )
}

function EvidenceCard({
  evidence,
  index,
  knowledgeSpaceId,
}: {
  evidence: RetrievalEvidence
  index: number
  knowledgeSpaceId: string
}) {
  const { t } = useTranslation('dataset')
  const openHref = evidence.documentId
    ? newKnowledgeDocumentDetailPath(knowledgeSpaceId, evidence.documentId)
    : undefined

  return (
    <article className="rounded-xl border border-components-panel-border bg-components-panel-bg shadow-xs">
      <div className="flex items-start gap-3 px-4 pt-4">
        <h3 className="min-w-0 flex-1 truncate system-md-semibold text-text-primary">
          {evidence.title || `Chunk ${index + 1}`}
        </h3>
        {evidence.score !== undefined && <ScorePill score={evidence.score} />}
      </div>
      <p className="px-4 pt-2 pb-3 body-sm-regular whitespace-pre-wrap text-text-secondary">
        {evidence.text}
      </p>
      {evidence.images.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-4 pb-3">
          {evidence.images.map((image) => (
            <img
              key={image}
              src={image}
              alt=""
              className="size-20 shrink-0 rounded-lg border border-components-panel-border object-cover"
            />
          ))}
        </div>
      )}
      <footer className="flex min-h-11 items-center gap-2 border-t border-divider-subtle px-4 text-text-tertiary">
        <span
          aria-hidden
          className="i-ri-file-pdf-2-fill size-4 shrink-0 text-util-colors-red-red-500"
        />
        <span className="min-w-0 flex-1 truncate system-xs-medium">
          {evidence.documentName ?? evidence.title}
        </span>
        {evidence.revision && (
          <span className="shrink-0 system-xs-regular">{evidence.revision}</span>
        )}
        {evidence.page !== undefined && (
          <span className="shrink-0 system-xs-regular">
            {t(($) => $['newKnowledge.retrievalTest.page'], { page: evidence.page })}
          </span>
        )}
        {openHref && (
          <Link
            href={openHref}
            className="ml-1 shrink-0 rounded-md px-1 py-0.5 system-xs-semibold text-text-accent outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          >
            {t(($) => $['newKnowledge.retrievalTest.open'])}
          </Link>
        )}
      </footer>
    </article>
  )
}

function ResultSkeleton() {
  return (
    <div aria-label="Loading retrieval results" className="space-y-3">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="animate-pulse rounded-xl border border-components-panel-border bg-components-panel-bg p-4 motion-reduce:animate-none"
        >
          <div className="h-4 w-1/3 rounded bg-background-section-burn" />
          <div className="mt-4 h-3 w-full rounded bg-background-section-burn" />
          <div className="mt-2 h-3 w-5/6 rounded bg-background-section-burn" />
          <div className="mt-2 h-3 w-2/3 rounded bg-background-section-burn" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({
  description,
  failed,
  onRetry,
  title,
}: {
  description: string
  failed?: boolean
  onRetry?: () => void
  title: string
}) {
  const { t } = useTranslation('dataset')
  return (
    <div className="flex min-h-80 flex-col items-center justify-center px-8 text-center">
      <span
        aria-hidden
        className={cn(
          'size-10',
          failed
            ? 'i-ri-error-warning-line text-text-destructive'
            : 'i-ri-search-eye-line text-text-quaternary',
        )}
      />
      <h2 className="mt-4 title-md-semi-bold text-text-primary">{title}</h2>
      <p className="mt-2 max-w-sm body-sm-regular text-text-tertiary">{description}</p>
      {onRetry && (
        <Button className="mt-5" onClick={onRetry}>
          {t(($) => $['newKnowledge.retrievalTest.retry'])}
        </Button>
      )}
    </div>
  )
}

function QualityActions({
  decision,
  noResults,
  onDecision,
}: {
  decision?: QualityDecision
  noResults?: boolean
  onDecision: (decision: QualityDecision) => void
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
        <button
          type="button"
          className="rounded-md px-1 py-0.5 system-sm-semibold text-text-accent outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          onClick={() => toast.info(t(($) => $['cornerLabel.unavailable']))}
        >
          {t(($) => $['newKnowledge.retrievalTest.viewInQuality'])}
        </button>
      </div>
    )
  }
  return (
    <div className="flex min-h-16 items-center justify-end gap-2 border-t border-divider-subtle px-5">
      <Button variant={noResults ? 'primary' : 'ghost'} onClick={() => onDecision('bad-case')}>
        {t(($) => $['newKnowledge.retrievalTest.makeBadCase'])}
      </Button>
      {!noResults && (
        <Button variant="primary" onClick={() => onDecision('golden')}>
          {t(($) => $['newKnowledge.retrievalTest.keepGoldenQuestion'])}
        </Button>
      )}
    </div>
  )
}

function ResearchProcess({
  expanded,
  onCancel,
  onToggle,
  plan,
  task,
}: {
  expanded: boolean
  onCancel?: () => void
  onToggle: () => void
  plan?: KnowledgeFsResearchTaskPlanResponse
  task: KnowledgeFsResearchTaskResponse
}) {
  const { t } = useTranslation('dataset')
  const active = researchTaskIsActive(task)
  const now = useClock(active)
  const startedAt = timeValue(task.created_at)
  const endedAt = task.completed_at ? timeValue(task.completed_at) : now
  const duration = formatDuration(endedAt - startedAt)
  const currentIndex = researchStageOrder.findIndex((stage) => stage === task.stage)
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

  return (
    <section className="overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg">
      <button
        type="button"
        aria-expanded={expanded}
        className="flex min-h-14 w-full items-center gap-3 px-4 text-left outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset"
        onClick={onToggle}
      >
        <span
          aria-hidden
          className={cn(
            'size-5 text-text-accent',
            active && 'i-ri-loader-4-line animate-spin motion-reduce:animate-none',
            task.stage === 'completed' && 'i-ri-checkbox-circle-fill',
            task.stage === 'canceled' && 'i-ri-stop-circle-fill text-text-tertiary',
            task.stage === 'failed' && 'i-ri-error-warning-fill text-text-destructive',
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block system-sm-semibold text-text-primary">{summary}</span>
          {active && (
            <span className="mt-0.5 block system-xs-regular text-text-tertiary">
              {duration}
              {plan?.budget.budget_usd !== undefined && plan.budget.budget_usd !== null
                ? ` · $${plan.budget.budget_usd.toFixed(2)}`
                : ''}
            </span>
          )}
        </span>
        {active && onCancel && (
          <Button
            variant="ghost"
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
            'i-ri-arrow-down-s-line size-5 text-text-tertiary transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>
      {expanded && (
        <div className="border-t border-divider-subtle px-4 py-4">
          <div className="mb-4 flex items-center gap-4 system-xs-semibold text-text-tertiary">
            <span className="text-text-primary">
              {t(($) => $['newKnowledge.retrievalTest.processLog'])}
            </span>
            <span>{t(($) => $['newKnowledge.retrievalTest.quality'])}</span>
          </div>
          <ol className="space-y-0">
            {researchStageOrder.map((stage, index) => {
              const completed = task.stage === 'completed' || index < currentIndex
              const current = stage === task.stage
              return (
                <li key={stage} className="relative flex min-h-10 items-start gap-3">
                  {index < researchStageOrder.length - 1 && (
                    <span
                      aria-hidden
                      className={cn(
                        'absolute top-5 left-[7px] h-6 w-px',
                        completed ? 'bg-util-colors-blue-blue-500' : 'bg-divider-regular',
                      )}
                    />
                  )}
                  <span
                    aria-hidden
                    className={cn(
                      'relative mt-0.5 size-4 shrink-0 rounded-full border-2',
                      completed && 'border-util-colors-blue-blue-500 bg-util-colors-blue-blue-500',
                      current &&
                        active &&
                        'i-ri-loader-4-line animate-spin border-0 text-text-accent motion-reduce:animate-none',
                      !completed && !current && 'border-divider-deep bg-components-panel-bg',
                    )}
                  />
                  <span
                    className={cn(
                      'system-sm-medium',
                      completed || current ? 'text-text-primary' : 'text-text-quaternary',
                    )}
                  >
                    {labels[stage]}
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
  onClick,
  record,
}: {
  active: boolean
  onClick: () => void
  record: RetrievalTestRecord
}) {
  const { t } = useTranslation('dataset')
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left outline-hidden transition-colors hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        active && 'bg-state-accent-hover',
      )}
      onClick={onClick}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 size-4 shrink-0',
          record.status === 'running' &&
            'i-ri-loader-4-line animate-spin text-text-accent motion-reduce:animate-none',
          record.status === 'completed' && 'i-ri-checkbox-circle-line text-text-success',
          record.status === 'failed' && 'i-ri-error-warning-line text-text-destructive',
          record.status === 'canceled' && 'i-ri-stop-circle-line text-text-tertiary',
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 system-sm-medium text-text-primary">{record.query}</span>
        <span className="mt-1 block system-xs-regular text-text-tertiary">
          {t(($) => $[`newKnowledge.settings.retrievalMode.${record.mode}`])}
        </span>
      </span>
    </button>
  )
}

export function RetrievalTestPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<RetrievalTestMode>('fast')
  const [localRun, setLocalRun] = useState<LocalQueryRun>()
  const [selected, setSelected] = useState<SelectedRun>()
  const [researchPlans, setResearchPlans] = useState<
    Record<string, KnowledgeFsResearchTaskPlanResponse>
  >({})
  const [researchExpanded, setResearchExpanded] = useState<Record<string, boolean>>({})
  const [qualityDecisions, setQualityDecisions] = useState<Record<string, QualityDecision>>({})
  const [showAll, setShowAll] = useState(false)
  const queryAbortControllerRef = useRef<AbortController>(undefined)

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
    refetchInterval: (current) =>
      localRun?.status === 'running' || current.state.data?.data.some((trace) => !trace.completed)
        ? 1000
        : false,
  })
  const researchTasksQuery = useQuery({
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.researchTasks.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId } },
    }),
    refetchInterval: (current) =>
      current.state.data?.data.some((task) => researchTaskIsActive(task)) ? 1000 : false,
  })
  const records = useMemo(
    () => retrievalTestRecords(tracesQuery.data?.data ?? [], researchTasksQuery.data?.data ?? []),
    [researchTasksQuery.data?.data, tracesQuery.data?.data],
  )
  const selectedRecord = records.find(
    (record) => record.id === selected?.id && record.kind === selected.kind,
  )
  const selectedResearchTask =
    selected?.kind === 'research'
      ? researchTasksQuery.data?.data.find((task) => task.id === selected.id)
      : undefined
  const selectedTraceId =
    selected?.kind === 'trace'
      ? selected.id
      : selected?.kind === 'local'
        ? localRun?.traceId
        : undefined

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
    enabled: Boolean(selectedTraceId),
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

  const historicalEvidence = extractRetrievalEvidence(traceEvidenceQuery.data)
  const researchEvidence = extractRetrievalEvidence(researchPartialsQuery.data)
  const currentEvidence =
    selected?.kind === 'local' && localRun
      ? localRun.evidence.length
        ? localRun.evidence
        : historicalEvidence
      : selected?.kind === 'research'
        ? researchEvidence
        : historicalEvidence
  const resultKey = selected ? `${selected.kind}:${selected.id}` : undefined
  const selectedQuery = selected?.kind === 'local' ? localRun?.query : selectedRecord?.query
  const selectedMode = selected?.kind === 'local' ? localRun?.mode : selectedRecord?.mode
  const selectedIsLoading =
    (selected?.kind === 'local' && localRun?.status === 'running') ||
    (selected?.kind === 'trace' && selectedRecord?.status === 'running') ||
    (selected?.kind === 'trace' && traceEvidenceQuery.isPending)
  const selectedFailed = selected?.kind === 'local' && localRun?.status === 'failed'
  const visibleEvidence = showAll ? currentEvidence : currentEvidence.slice(0, 3)

  const selectRecord = (record: RetrievalTestRecord) => {
    setSelected({ id: record.id, kind: record.kind })
    setQuery(record.query)
    setMode(record.mode)
    setShowAll(false)
    if (record.kind === 'research' && researchExpanded[record.id] === undefined)
      setResearchExpanded((current) => ({
        ...current,
        [record.id]: record.status === 'running',
      }))
  }

  const runFastQuery = async () => {
    const cleanQuery = query.trim()
    if (!cleanQuery) return
    queryAbortControllerRef.current?.abort()
    const controller = new AbortController()
    queryAbortControllerRef.current = controller
    const id = crypto.randomUUID()
    const startedAt = Date.now()
    const runMode = mode === 'deep' ? 'deep' : 'fast'
    setLocalRun({
      evidence: [],
      id,
      mode: runMode,
      query: cleanQuery,
      startedAt,
      status: 'running',
    })
    setSelected({ id, kind: 'local' })
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
      setLocalRun((current) =>
        current?.id === id
          ? {
              ...current,
              endedAt: Date.now(),
              evidence,
              status: 'completed',
              traceId,
            }
          : current,
      )
      await tracesQuery.refetch()
    } catch (error) {
      if (controller.signal.aborted) return
      setLocalRun((current) =>
        current?.id === id
          ? {
              ...current,
              endedAt: Date.now(),
              error: error instanceof Error ? error.message : undefined,
              status: 'failed',
            }
          : current,
      )
    }
  }

  const startResearch = async () => {
    const cleanQuery = query.trim()
    if (!cleanQuery) return
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
      setResearchPlans((current) => ({ ...current, [task.id]: plan }))
      setResearchExpanded((current) => ({ ...current, [task.id]: true }))
      setSelected({ id: task.id, kind: 'research' })
      setShowAll(false)
      await researchTasksQuery.refetch()
    } catch {
      toast.error(t(($) => $['newKnowledge.retrievalTest.failedDescription']))
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
    if (mode === 'research') void startResearch()
    else void runFastQuery()
  }

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-components-panel-bg">
      <header className="shrink-0 border-b border-divider-subtle px-6 py-5">
        <h1 className="title-2xl-semi-bold text-text-primary">
          {t(($) => $['newKnowledge.retrievalTest.title'])}
        </h1>
        <p className="mt-1 max-w-3xl body-sm-regular text-text-tertiary">
          {t(($) => $['newKnowledge.retrievalTest.description'])}
        </p>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        <section className="flex min-h-0 w-full shrink-0 flex-col border-b border-divider-subtle lg:w-[468px] lg:border-r lg:border-b-0">
          <div className="shrink-0 p-4 pr-6">
            <div className="overflow-hidden rounded-xl border border-components-input-border-active bg-components-input-bg-active shadow-xs">
              <label className="sr-only" htmlFor="retrieval-test-query">
                {t(($) => $['newKnowledge.retrievalTest.queryPlaceholder'])}
              </label>
              <textarea
                id="retrieval-test-query"
                value={query}
                maxLength={2000}
                placeholder={t(($) => $['newKnowledge.retrievalTest.queryPlaceholder'])}
                className="block h-36 w-full resize-none bg-transparent px-4 py-3 body-md-regular text-text-primary outline-hidden placeholder:text-text-quaternary"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault()
                    run()
                  }
                }}
              />
              <div className="flex min-h-13 items-center justify-between gap-3 border-t border-divider-subtle px-2.5">
                <div
                  role="group"
                  aria-label="Retrieval mode"
                  className="flex rounded-lg bg-background-section-burn p-0.5"
                >
                  {(['fast', 'deep', 'research'] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={mode === item}
                      className={cn(
                        'rounded-md px-2.5 py-1 system-xs-semibold text-text-tertiary capitalize outline-hidden hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                        mode === item && 'bg-components-panel-bg text-text-primary shadow-xs',
                      )}
                      onClick={() => setMode(item)}
                    >
                      {t(($) => $[`newKnowledge.settings.retrievalMode.${item}`])}
                    </button>
                  ))}
                </div>
                <Button variant="primary" disabled={!query.trim()} onClick={run}>
                  {t(($) =>
                    mode === 'research'
                      ? $['newKnowledge.retrievalTest.startResearch']
                      : $['newKnowledge.retrievalTest.run'],
                  )}
                </Button>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
            <div className="flex h-9 shrink-0 items-center px-3">
              <h2 className="system-xs-semibold-uppercase text-text-tertiary">
                {t(($) => $['newKnowledge.retrievalTest.records'])}
              </h2>
              <span className="ml-2 system-xs-regular text-text-quaternary">{records.length}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {records.length > 0 ? (
                <div className="space-y-1">
                  {records.map((record) => (
                    <RecordButton
                      key={`${record.kind}:${record.id}`}
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

        <section className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-background-body">
          {!selected && (
            <EmptyState
              title={t(($) => $['newKnowledge.retrievalTest.emptyTitle'])}
              description={t(($) => $['newKnowledge.retrievalTest.emptyDescription'])}
            />
          )}
          {selected && (
            <div className="mx-auto flex min-h-full max-w-4xl flex-col">
              <div className="flex min-h-16 shrink-0 items-center gap-3 border-b border-divider-subtle px-5">
                <h2 className="min-w-0 flex-1 truncate title-md-semi-bold text-text-primary">
                  {selected?.kind === 'research'
                    ? t(($) => $['newKnowledge.retrievalTest.researchResult'])
                    : selectedQuery}
                </h2>
                <span className="bg-components-badge-bg rounded-md px-2 py-1 system-xs-semibold text-text-secondary capitalize">
                  {selectedMode
                    ? t(($) => $[`newKnowledge.settings.retrievalMode.${selectedMode}`])
                    : ''}
                </span>
                {selected?.kind === 'research' && (
                  <span className="system-xs-regular text-text-tertiary">
                    {t(($) => $['newKnowledge.retrievalTest.justNow'])}
                  </span>
                )}
              </div>

              <div className="min-h-0 flex-1 p-5">
                {selectedResearchTask && (
                  <ResearchProcess
                    task={selectedResearchTask}
                    plan={researchPlans[selectedResearchTask.id]}
                    expanded={
                      researchExpanded[selectedResearchTask.id] ??
                      researchTaskIsActive(selectedResearchTask)
                    }
                    onToggle={() =>
                      setResearchExpanded((current) => ({
                        ...current,
                        [selectedResearchTask.id]: !(
                          current[selectedResearchTask.id] ??
                          researchTaskIsActive(selectedResearchTask)
                        ),
                      }))
                    }
                    onCancel={
                      researchTaskIsActive(selectedResearchTask)
                        ? () => void cancelResearch(selectedResearchTask.id)
                        : undefined
                    }
                  />
                )}

                {selectedIsLoading && <ResultSkeleton />}

                {selectedFailed && (
                  <EmptyState
                    failed
                    title={t(($) => $['newKnowledge.retrievalTest.failedTitle'])}
                    description={
                      localRun?.error || t(($) => $['newKnowledge.retrievalTest.failedDescription'])
                    }
                    onRetry={() => void runFastQuery()}
                  />
                )}

                {!selectedIsLoading && !selectedFailed && currentEvidence.length === 0 && (
                  <EmptyState
                    title={t(($) => $['newKnowledge.retrievalTest.noChunksTitle'])}
                    description={t(($) => $['newKnowledge.retrievalTest.noChunksDescription'])}
                  />
                )}

                {currentEvidence.length > 0 && (
                  <div className={cn(selectedResearchTask && 'mt-5')}>
                    {selectedResearchTask && (
                      <h3 className="mb-3 system-sm-semibold text-text-secondary">
                        {researchTaskIsActive(selectedResearchTask)
                          ? t(($) => $['newKnowledge.retrievalTest.foundSoFar'], {
                              count: currentEvidence.length,
                            })
                          : `${currentEvidence.length} chunks`}
                      </h3>
                    )}
                    <div className="space-y-3">
                      {visibleEvidence.map((evidence, index) => (
                        <EvidenceCard
                          key={evidence.id}
                          evidence={evidence}
                          index={index}
                          knowledgeSpaceId={knowledgeSpaceId}
                        />
                      ))}
                      {selectedResearchTask && researchTaskIsActive(selectedResearchTask) && (
                        <div className="h-24 animate-pulse rounded-xl border border-components-panel-border bg-components-panel-bg p-4 motion-reduce:animate-none">
                          <div className="h-3 w-1/3 rounded bg-background-section-burn" />
                          <div className="mt-4 h-3 w-4/5 rounded bg-background-section-burn" />
                        </div>
                      )}
                    </div>
                    {!showAll && currentEvidence.length > 3 && (
                      <button
                        type="button"
                        className="mx-auto mt-4 flex rounded-lg px-3 py-2 system-sm-semibold text-text-accent outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                        onClick={() => setShowAll(true)}
                      >
                        {t(($) => $['newKnowledge.retrievalTest.showAllChunks'], {
                          count: currentEvidence.length,
                        })}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {!selectedIsLoading &&
                !selectedFailed &&
                !researchTaskIsActive(selectedResearchTask) &&
                resultKey && (
                  <QualityActions
                    noResults={currentEvidence.length === 0}
                    decision={qualityDecisions[resultKey]}
                    onDecision={(decision) =>
                      setQualityDecisions((current) => ({ ...current, [resultKey]: decision }))
                    }
                  />
                )}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
