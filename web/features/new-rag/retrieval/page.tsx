'use client'

import type {
  KnowledgeFsResearchTaskPlanResponse,
  KnowledgeFsResearchTaskResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { Hotkey } from '@tanstack/react-hotkeys'
import type { GoldenQuestionDraft, GoldenQuestionEvidenceOption } from '../quality/types'
import type { RetrievalEvidence, RetrievalTestMode, RetrievalTestRecord } from './model'
import type { BadCaseReason, QualityDecision } from './results'
import type { KnowledgeQueryEvent } from './services/knowledge-query-events'
import type { ResearchTaskProgressEvent } from './services/research-task-events'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { matchesKeyboardEvent } from '@tanstack/react-hotkeys'
import { skipToken, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { parseAsString, useQueryStates } from 'nuqs'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { consoleClient, consoleQuery } from '@/service/client'
import { KnowledgeModelReadinessBanner } from '../components/knowledge-model-readiness-banner'
import { KnowledgeModelSetupDialog } from '../components/knowledge-model-setup-dialog'
import { RetrievalModeSegmentedControl } from '../components/retrieval-mode-segmented-control'
import { GoldenQuestionDialog } from '../quality/golden-question-dialog'
import { newKnowledgeQualityPath } from '../routes'
import { useKnowledgeSpacePermission } from '../space/context'
import { useKnowledgeModelSetupGuard } from '../use-knowledge-model-setup-guard'
import { RecordButton, RecordTime, ResearchProcess } from './history'
import { mergeResearchProgressEvent, timeValue } from './history-utils'
import {
  extractRetrievalEvidence,
  extractStreamError,
  extractTraceId,
  researchTaskIsActive,
  retrievalTestRecords,
  shouldRefreshResearchPartials,
} from './model'
import {
  EmptyState,
  EvidenceCard,
  FailedResult,
  QualityActions,
  ResearchAnswer,
  ResultSkeleton,
} from './results'
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

type ResearchExpansionState = Partial<Record<'active' | 'terminal', boolean>>

type GoldenQuestionPromotion = {
  evidenceOptions: GoldenQuestionEvidenceOption[]
  resultKey: string
  value: GoldenQuestionDraft
}

const runRetrievalHotkey = 'Mod+Enter' satisfies Hotkey

function goldenQuestionEvidenceOptions(
  evidence: readonly RetrievalEvidence[],
): GoldenQuestionEvidenceOption[] {
  const options = new Map<string, GoldenQuestionEvidenceOption>()
  for (const item of evidence) {
    if (!item.chunkId) continue
    const sectionPath = item.documentName
      ? item.title === item.documentName
        ? [item.documentName]
        : [item.documentName, item.title]
      : [item.title]
    options.set(item.chunkId, {
      node_id: item.chunkId,
      ...(item.score === undefined ? {} : { score: item.score }),
      section_path: sectionPath,
      text: item.text,
    })
  }
  return [...options.values()]
}

function normalizedRetrievalTestMode(mode?: string): RetrievalTestMode {
  if (mode === 'deep' || mode === 'research') return mode
  return 'fast'
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

export function RetrievalTestPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')
  const queryClient = useQueryClient()
  const canEditQuality = useKnowledgeSpacePermission('knowledge_space_edit')
  const {
    configureModelSetup,
    ensureModelReady,
    modelReadiness,
    modelSetupDialogOpen,
    setModelSetupDialogOpen,
  } = useKnowledgeModelSetupGuard(knowledgeSpaceId)
  const [linkedSelection, setLinkedSelection] = useQueryStates({
    research: parseAsString,
    retest: parseAsString,
    trace: parseAsString,
  })
  const {
    research: linkedResearchId,
    retest: linkedRetestTraceId,
    trace: linkedTraceId,
  } = linkedSelection
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
  const [researchExpanded, setResearchExpanded] = useState<Record<string, ResearchExpansionState>>(
    {},
  )
  const [qualityDecisions, setQualityDecisions] = useState<Record<string, QualityDecision>>({})
  const [qualityPendingKey, setQualityPendingKey] = useState<string>()
  const [goldenPromotion, setGoldenPromotion] = useState<GoldenQuestionPromotion>()
  const [goldenPromotionError, setGoldenPromotionError] = useState<string>()
  const [expandedResultKey, setExpandedResultKey] = useState<string>()
  const [selectedCitation, setSelectedCitation] = useState<{
    citationIndex: number
    requestId: number
    taskId: string
  }>()
  const queryAbortControllerRef = useRef<AbortController>(undefined)
  const consumedRetestTraceIdRef = useRef<string | undefined>(undefined)
  const runInFlightRef = useRef(false)

  useEffect(
    () => () => {
      queryAbortControllerRef.current?.abort()
    },
    [],
  )

  const tracesQuery = useInfiniteQuery({
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.traces.get.infiniteOptions({
      getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
      initialPageParam: null as string | null,
      input: (pageParam) => ({
        params: { control_space_id: knowledgeSpaceId },
        ...(typeof pageParam === 'string' ? { query: { cursor: pageParam } } : {}),
      }),
    }),
    refetchInterval: localRun?.status === 'running' ? 1000 : false,
  })
  const researchTasksQuery = useInfiniteQuery({
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.researchTasks.get.infiniteOptions({
      getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
      initialPageParam: null as string | null,
      input: (pageParam) => ({
        params: { control_space_id: knowledgeSpaceId },
        ...(typeof pageParam === 'string' ? { query: { cursor: pageParam } } : {}),
      }),
    }),
    refetchInterval: (current) => {
      const persistedTasks = current.state.data?.pages.flatMap((page) => page.data) ?? []
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
    for (const persisted of researchTasksQuery.data?.pages.flatMap((page) => page.data) ?? []) {
      const admitted = byId.get(persisted.id)
      if (!admitted || persisted.updated_at >= admitted.updated_at)
        byId.set(persisted.id, persisted)
    }
    return [...byId.values()]
  }, [admittedResearchTasks, researchTasksQuery.data?.pages])
  const traces = useMemo(
    () => tracesQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [tracesQuery.data?.pages],
  )
  const records = useMemo(
    () => retrievalTestRecords(traces, researchTasks),
    [researchTasks, traces],
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
  const selectedResearchTaskFromHistory =
    selected?.kind === 'research'
      ? researchTasks.find((task) => task.id === selected.id)
      : undefined
  const needsResearchDetail = selected?.kind === 'research' && !selectedResearchTaskFromHistory
  const researchDetailQuery = useQuery({
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.researchTasks.byTaskId.get.queryOptions({
      input: needsResearchDetail
        ? {
            params: {
              control_space_id: knowledgeSpaceId,
              task_id: selected.id,
            },
          }
        : skipToken,
    }),
  })
  const selectedFailed =
    (selected?.kind === 'local' && localRun?.status === 'failed') ||
    (selected?.kind === 'trace' && selectedRecord?.status === 'failed')
  const selectedResearchTask =
    selected?.kind === 'research'
      ? (selectedResearchTaskFromHistory ?? researchDetailQuery.data)
      : undefined
  const selectedHistoryRecord = selected?.kind === 'local' ? undefined : selectedRecord
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
  const query =
    composerDraft.selectionKey === selectedHistoryKey
      ? composerDraft.query
      : (selectedHistoryRecord?.query ??
        selectedResearchTask?.query ??
        traceDetailQuery.data?.query ??
        '')
  const mode: RetrievalTestMode =
    composerDraft.selectionKey === selectedHistoryKey
      ? composerDraft.mode
      : normalizedRetrievalTestMode(
          selectedHistoryRecord?.mode ?? selectedResearchTask?.mode ?? traceDetailQuery.data?.mode,
        )
  const selectedResearchActive = researchTaskIsActive(selectedResearchTask)
  const selectedResearchActiveRef = useRef(selectedResearchActive)
  useEffect(() => {
    selectedResearchActiveRef.current = selectedResearchActive
  }, [selectedResearchActive])
  const selectedResearchDefaultExpanded = researchTaskIsActive(selectedResearchTask)
  const selectedResearchExpansionPhase = selectedResearchDefaultExpanded ? 'active' : 'terminal'
  const selectedResearchExpanded = selectedResearchTask
    ? (researchExpanded[selectedResearchTask.id]?.[selectedResearchExpansionPhase] ??
      selectedResearchDefaultExpanded)
    : false
  const traceEvidenceQuery = useInfiniteQuery({
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.traces.byTraceId.evidence.get.infiniteOptions(
      {
        getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
        initialPageParam: null as string | null,
        input: (pageParam) => ({
          params: {
            control_space_id: knowledgeSpaceId,
            trace_id: selectedTraceId ?? '',
          },
          query: {
            ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
            limit: 100,
          },
        }),
      },
    ),
    enabled: Boolean(selectedTraceId) && !selectedFailed,
  })
  const researchPartialsQuery = useInfiniteQuery({
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.researchTasks.byTaskId.partials.get.infiniteOptions(
      {
        getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
        initialPageParam: null as string | null,
        input: (pageParam) => ({
          params: {
            control_space_id: knowledgeSpaceId,
            task_id: selectedResearchTask?.id ?? '',
          },
          query: {
            ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
            limit: 100,
          },
        }),
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

  const traceEvidence = traceEvidenceQuery.data?.pages.flatMap((page) => page.data) ?? []
  const researchPartials = researchPartialsQuery.data?.pages.flatMap((page) => page.data) ?? []
  const historicalEvidence = extractRetrievalEvidence(traceEvidence)
  const researchEvidence = extractRetrievalEvidence(researchPartials)
  const selectedResearchEvents = selectedResearchTask
    ? (researchEvents[selectedResearchTask.id] ?? [])
    : []
  const streamedResearchAnswer = researchTaskAnswerFromEvents(selectedResearchEvents)
  const persistedResearchAnswer = [...researchPartials]
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
      .map((evidence) => evidence.documentId ?? evidence.documentAssetId ?? evidence.documentName)
      .filter((document): document is string => Boolean(document)),
  ).size
  const resultKey = selected ? `${selected.kind}:${selected.id}` : undefined
  const showAll = resultKey !== undefined && expandedResultKey === resultKey
  const selectedQuery =
    selected?.kind === 'local'
      ? localRun?.query
      : (selectedRecord?.query ?? selectedResearchTask?.query ?? traceDetailQuery.data?.query)
  const selectedMode =
    selected?.kind === 'local'
      ? localRun?.mode
      : (selectedRecord?.mode ?? selectedResearchTask?.mode ?? traceDetailQuery.data?.mode)
  const selectedCreatedAt =
    selected?.kind === 'local'
      ? localRun?.startedAt
      : (selectedRecord?.createdAt ??
        (selectedResearchTask ? timeValue(selectedResearchTask.created_at) : undefined))
  const selectedIsLoading =
    (selected?.kind === 'local' && localRun?.status === 'running') ||
    (selected?.kind === 'trace' && !selectedRecord && traceDetailQuery.isPending) ||
    (selected?.kind === 'trace' && !selectedFailed && traceEvidenceQuery.isPending) ||
    (needsResearchDetail && researchDetailQuery.isPending) ||
    (selected?.kind === 'research' &&
      Boolean(selectedResearchTask) &&
      researchPartialsQuery.isPending)
  const selectedDataError =
    (needsResearchDetail && researchDetailQuery.isError) ||
    (selected?.kind === 'trace' &&
      !selectedFailed &&
      (traceDetailQuery.isError ||
        traceEvidenceQuery.isError ||
        traceEvidenceQuery.isFetchNextPageError)) ||
    (selected?.kind === 'research' &&
      Boolean(selectedResearchTask) &&
      (researchPartialsQuery.isError || researchPartialsQuery.isFetchNextPageError))
  const retrySelectedData = () => {
    if (needsResearchDetail && researchDetailQuery.isError) {
      void researchDetailQuery.refetch()
      return
    }
    if (selected?.kind === 'trace') {
      if (traceEvidenceQuery.isFetchNextPageError) void traceEvidenceQuery.fetchNextPage()
      else if (traceDetailQuery.isError && traceEvidenceQuery.isError)
        void Promise.all([traceDetailQuery.refetch(), traceEvidenceQuery.refetch()])
      else if (traceDetailQuery.isError) void traceDetailQuery.refetch()
      else void traceEvidenceQuery.refetch()
      return
    }
    if (selected?.kind === 'research') {
      if (researchPartialsQuery.isFetchNextPageError) void researchPartialsQuery.fetchNextPage()
      else void researchPartialsQuery.refetch()
    }
  }
  const selectedHasNoResults = selected?.kind === 'local' && localRun?.status === 'no-results'
  const initialEvidenceCount = selectedMode === 'research' ? 5 : 3
  const hasMoreEvidencePages = Boolean(
    traceEvidenceQuery.hasNextPage || (selectedResearchTask && researchPartialsQuery.hasNextPage),
  )
  const visibleEvidence = showAll ? currentEvidence : currentEvidence.slice(0, initialEvidenceCount)
  const selectedCitationIndex =
    selectedCitation && selectedCitation.taskId === selectedResearchTaskId
      ? selectedCitation.citationIndex
      : undefined
  const jumpToResearchCitation = useCallback(
    (citationIndex: number) => {
      if (!selectedResearchTaskId || citationIndex < 0 || citationIndex >= currentEvidence.length)
        return
      setExpandedResultKey(resultKey)
      setSelectedCitation((current) => ({
        citationIndex,
        requestId: (current?.requestId ?? 0) + 1,
        taskId: selectedResearchTaskId,
      }))
    },
    [currentEvidence.length, resultKey, selectedResearchTaskId],
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
      void setLinkedSelection({ research: null, retest: null, trace: null }, { history: 'push' })
    } else {
      setLocalSelected(undefined)
      void setLinkedSelection(
        {
          research: record.kind === 'research' ? record.id : null,
          retest: null,
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
    setExpandedResultKey(undefined)
  }

  const startGoldenPromotion = () => {
    if (!resultKey || !selectedQuery) return
    setGoldenPromotionError(undefined)
    setGoldenPromotion({
      evidenceOptions: goldenQuestionEvidenceOptions(currentEvidence),
      resultKey,
      value: {
        annotation: '',
        expectedEvidenceIds: [],
        matchPolicy: 'all',
        question: selectedQuery,
        tags: ['retrieval-test'],
      },
    })
  }

  const saveBadCase = async (reason: BadCaseReason) => {
    if (!resultKey || !selectedQuery) return
    setQualityPendingKey(resultKey)
    try {
      if (!selectedTraceId) {
        toast.error(t(($) => $.unknownError))
        return
      }
      await consoleClient.knowledgeFs.spaces.byControlSpaceId.quality.badCases.post({
        body: {
          reason,
          tags: ['retrieval-test'],
          trace_id: selectedTraceId,
        },
        params: { control_space_id: knowledgeSpaceId },
      })
      setQualityDecisions((current) => ({ ...current, [resultKey]: 'bad-case' }))
    } catch {
      toast.error(t(($) => $.unknownError))
    } finally {
      setQualityPendingKey(undefined)
    }
  }

  const submitGoldenPromotion = async (draft: GoldenQuestionDraft) => {
    if (!goldenPromotion) return
    const promotion = goldenPromotion
    setGoldenPromotionError(undefined)
    setQualityPendingKey(promotion.resultKey)
    try {
      await consoleClient.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.post({
        body: {
          annotation: draft.annotation,
          expected_evidence_ids: draft.expectedEvidenceIds,
          match_policy: draft.matchPolicy,
          question: draft.question,
          tags: draft.tags,
        },
        params: { control_space_id: knowledgeSpaceId },
      })
      await queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.get.key({
          input: { params: { control_space_id: knowledgeSpaceId } },
          type: 'infinite',
        }),
      })
      setQualityDecisions((current) => ({ ...current, [promotion.resultKey]: 'golden' }))
      setGoldenPromotion(undefined)
    } catch {
      setGoldenPromotionError(t(($) => $.unknownError))
    } finally {
      setQualityPendingKey(undefined)
    }
  }

  const runFastQuery = async (input?: { mode: RetrievalTestMode; query: string }) => {
    const cleanQuery = (input?.query ?? query).trim()
    if (!cleanQuery || runInFlightRef.current) return
    runInFlightRef.current = true
    const requestedMode = input?.mode ?? mode
    const runMode = requestedMode === 'deep' ? 'deep' : 'fast'
    if (
      (
        await ensureModelReady({
          capability: runMode === 'deep' ? 'deep' : 'query',
          intent: 'retrieval-test',
        })
      ).status !== 'ready'
    ) {
      runInFlightRef.current = false
      return
    }
    queryAbortControllerRef.current?.abort()
    const controller = new AbortController()
    queryAbortControllerRef.current = controller
    const id = crypto.randomUUID()
    const startedAt = Date.now()
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
    void setLinkedSelection({ research: null, retest: null, trace: null }, { history: 'replace' })
    setExpandedResultKey(undefined)
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
      const evidence = extractRetrievalEvidence(eventData)
      if (traceId && evidence.length === 0) {
        const traceEvidence =
          await consoleClient.knowledgeFs.spaces.byControlSpaceId.traces.byTraceId.evidence.get({
            params: { control_space_id: knowledgeSpaceId, trace_id: traceId },
            query: { limit: 100 },
          })
        evidence.push(...extractRetrievalEvidence(traceEvidence.data))
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
      if (
        traceId &&
        refreshedTraces.data?.pages.some((page) => page.data.some((trace) => trace.id === traceId))
      )
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

  const startResearch = async (input?: { query: string }) => {
    const cleanQuery = (input?.query ?? query).trim()
    if (!cleanQuery || runInFlightRef.current) return
    runInFlightRef.current = true
    try {
      if (
        (await ensureModelReady({ capability: 'research', intent: 'retrieval-test' })).status !==
        'ready'
      )
        return
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
      setComposerDraft({
        mode: 'research',
        query: cleanQuery,
        selectionKey: `research:${task.id}`,
      })
      setLocalSelected(undefined)
      void setLinkedSelection(
        { research: task.id, retest: null, trace: null },
        { history: 'push', shallow: false },
      )
      setExpandedResultKey(undefined)
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

  const runRetest = useEffectEvent((command: { mode: RetrievalTestMode; query: string }) => {
    if (command.mode === 'research') void startResearch({ query: command.query })
    else void runFastQuery(command)
  })

  useEffect(() => {
    if (
      !linkedRetestTraceId ||
      linkedTraceId !== linkedRetestTraceId ||
      selected?.kind !== 'trace' ||
      selected.id !== linkedRetestTraceId ||
      !query.trim() ||
      consumedRetestTraceIdRef.current === linkedRetestTraceId
    )
      return
    consumedRetestTraceIdRef.current = linkedRetestTraceId
    runRetest({ mode, query })
  }, [linkedRetestTraceId, linkedTraceId, mode, query, selected?.id, selected?.kind])

  const toggleSelectedResearchProcess = () => {
    if (!selectedResearchTask) return
    setResearchExpanded((current) => ({
      ...current,
      [selectedResearchTask.id]: {
        ...current[selectedResearchTask.id],
        [selectedResearchExpansionPhase]: !(
          current[selectedResearchTask.id]?.[selectedResearchExpansionPhase] ??
          selectedResearchDefaultExpanded
        ),
      },
    }))
  }

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-components-panel-bg px-6 pt-3 pb-5">
      <header className="shrink-0">
        <h1 className="title-xl-semi-bold leading-6 text-text-primary">
          {t(($) => $['newKnowledge.retrievalTest.title'])}
        </h1>
        <p className="mt-1 w-full system-xs-regular text-text-tertiary">
          {t(($) => $['newKnowledge.retrievalTest.description'])}
        </p>
      </header>
      <KnowledgeModelReadinessBanner
        capability={mode === 'deep' ? 'deep' : mode === 'research' ? 'research' : 'query'}
        className="mt-4"
        knowledgeSpaceId={knowledgeSpaceId}
      />

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
                  {(tracesQuery.hasNextPage || researchTasksQuery.hasNextPage) && (
                    <div className="px-3 py-2">
                      <Button
                        className="w-full"
                        disabled={
                          tracesQuery.isFetchingNextPage || researchTasksQuery.isFetchingNextPage
                        }
                        onClick={() => {
                          if (tracesQuery.hasNextPage) void tracesQuery.fetchNextPage()
                          if (researchTasksQuery.hasNextPage)
                            void researchTasksQuery.fetchNextPage()
                        }}
                      >
                        {t(($) => $['newKnowledge.loadMore'])}
                      </Button>
                    </div>
                  )}
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
                    onClick={toggleSelectedResearchProcess}
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
                    onToggle={toggleSelectedResearchProcess}
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

                {selectedDataError && (
                  <FailedResult
                    description={t(($) => $['newKnowledge.retrievalTest.failedDescription'])}
                    onRetry={retrySelectedData}
                  />
                )}

                {!selectedIsLoading &&
                  !selectedFailed &&
                  !selectedDataError &&
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

              {!showAll &&
                (currentEvidence.length > initialEvidenceCount || hasMoreEvidencePages) && (
                  <div className="shrink-0 pl-1">
                    <button
                      type="button"
                      className="flex items-center gap-1 rounded-md px-1.5 py-1 system-xs-medium text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                      onClick={() => setExpandedResultKey(resultKey)}
                    >
                      {t(($) => $['newKnowledge.retrievalTest.showAllChunks'], {
                        count: currentEvidence.length,
                      })}
                      <span aria-hidden className="i-ri-arrow-down-s-line size-3.5" />
                    </button>
                  </div>
                )}

              {showAll && traceEvidenceQuery.hasNextPage && (
                <div className="shrink-0 pl-1">
                  <Button
                    loading={traceEvidenceQuery.isFetchingNextPage}
                    disabled={traceEvidenceQuery.isFetchingNextPage}
                    onClick={() => void traceEvidenceQuery.fetchNextPage()}
                  >
                    {t(($) => $['newKnowledge.loadMore'])}
                  </Button>
                </div>
              )}

              {showAll && selectedResearchTask && researchPartialsQuery.hasNextPage && (
                <div className="shrink-0 pl-1">
                  <Button
                    loading={researchPartialsQuery.isFetchingNextPage}
                    disabled={researchPartialsQuery.isFetchingNextPage}
                    onClick={() => void researchPartialsQuery.fetchNextPage()}
                  >
                    {t(($) => $['newKnowledge.loadMore'])}
                  </Button>
                </div>
              )}

              {canEditQuality &&
                !selectedIsLoading &&
                !selectedFailed &&
                !selectedDataError &&
                !researchTaskIsActive(selectedResearchTask) &&
                resultKey && (
                  <QualityActions
                    badCaseAvailable={Boolean(selectedTraceId)}
                    noResults={currentEvidence.length === 0}
                    decision={qualityDecisions[resultKey]}
                    onBadCase={saveBadCase}
                    onGolden={startGoldenPromotion}
                    pending={qualityPendingKey === resultKey}
                    qualityHref={newKnowledgeQualityPath(knowledgeSpaceId)}
                  />
                )}
            </div>
          )}
        </section>
      </div>
      {canEditQuality && goldenPromotion && (
        <GoldenQuestionDialog
          key={goldenPromotion.resultKey}
          evidenceOptions={goldenPromotion.evidenceOptions}
          error={goldenPromotionError}
          initialValue={goldenPromotion.value}
          knowledgeSpaceId={knowledgeSpaceId}
          mode="promote"
          open
          pending={qualityPendingKey === goldenPromotion.resultKey}
          onOpenChange={(open) => {
            if (!open) {
              setGoldenPromotion(undefined)
              setGoldenPromotionError(undefined)
            }
          }}
          onSubmit={submitGoldenPromotion}
        />
      )}
      <KnowledgeModelSetupDialog
        open={modelSetupDialogOpen}
        readiness={modelReadiness}
        onConfigure={configureModelSetup}
        onOpenChange={setModelSetupDialogOpen}
      />
    </main>
  )
}
