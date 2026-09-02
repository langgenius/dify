'use client'

import type {
  KnowledgeFsQueryImageReference,
  KnowledgeFsResearchTaskResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { RetrievalTestMode } from './model'
import type { KnowledgeQueryEvent } from './services/knowledge-query-events'
import { toast } from '@langgenius/dify-ui/toast'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleClient } from '@/service/client'
import { KnowledgeModelSetupDialog } from '../components/knowledge-model-setup-dialog'
import { useKnowledgeModelSetupGuard } from '../use-knowledge-model-setup-guard'
import { mergeResearchProgressEvent } from './history-utils'
import {
  extractRetrievalEvidence,
  extractStreamError,
  extractTraceId,
  researchTaskCanRetry,
  researchTaskIsActive,
  shouldRefreshResearchPartials,
} from './model'
import { streamKnowledgeQuery } from './services/knowledge-query-events'
import { streamResearchTaskEvents } from './services/research-task-events'
import {
  retrievalComposerModeAtom,
  retrievalComposerQueryAtom,
  retrievalRuntimeQueryFactsAtom,
  retrievalSelectedAtom,
  retrievalSelectedResearchTaskAtom,
} from './state/graph'
import { retrievalKnowledgeSpaceIdAtom, retrievalLinkedSelectionAtom } from './state/inputs'
import { retrievalRuntimeBridgeAtom } from './state/runtime'
import {
  retrievalAdmittedResearchTasksAtom,
  retrievalComposerDraftAtom,
  retrievalComposerImagesAtom,
  retrievalLocalRunAtom,
  retrievalLocalSelectedAtom,
  retrievalResearchEventsAtom,
  retrievalResearchPlansAtom,
  retrievalResearchRetryPendingAtom,
} from './state/scoped'

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

export function RetrievalRuntimeController() {
  const { t } = useTranslation('dataset')
  const knowledgeSpaceId = useAtomValue(retrievalKnowledgeSpaceIdAtom)
  const linkedSelection = useAtomValue(retrievalLinkedSelectionAtom)
  const updateLocation = useSetAtom(retrievalLinkedSelectionAtom)
  const query = useAtomValue(retrievalComposerQueryAtom)
  const queryImages = useAtomValue(retrievalComposerImagesAtom)
  const mode = useAtomValue(retrievalComposerModeAtom)
  const localRun = useAtomValue(retrievalLocalRunAtom)
  const selected = useAtomValue(retrievalSelectedAtom)
  const selectedResearchTask = useAtomValue(retrievalSelectedResearchTaskAtom)
  const { refetchResearchPartials, refetchResearchTasks, refetchTraces } = useAtomValue(
    retrievalRuntimeQueryFactsAtom,
  )
  const setRuntimeBridge = useSetAtom(retrievalRuntimeBridgeAtom)
  const setComposerDraft = useSetAtom(retrievalComposerDraftAtom)
  const setLocalRun = useSetAtom(retrievalLocalRunAtom)
  const setLocalSelected = useSetAtom(retrievalLocalSelectedAtom)
  const setResearchPlans = useSetAtom(retrievalResearchPlansAtom)
  const setResearchEvents = useSetAtom(retrievalResearchEventsAtom)
  const setAdmittedResearchTasks = useSetAtom(retrievalAdmittedResearchTasksAtom)
  const setResearchRetryPending = useSetAtom(retrievalResearchRetryPendingAtom)
  const {
    configureModelSetup,
    ensureModelReady,
    modelReadiness,
    modelSetupDialogOpen,
    setModelSetupDialogOpen,
  } = useKnowledgeModelSetupGuard(knowledgeSpaceId)
  const queryAbortControllerRef = useRef<AbortController>(undefined)
  const consumedRetestTraceIdRef = useRef<string | undefined>(undefined)
  const runInFlightRef = useRef(false)
  const selectedResearchActive = researchTaskIsActive(selectedResearchTask)
  const selectedResearchActiveRef = useRef(selectedResearchActive)
  const refreshedTerminalPartialsTaskIdRef = useRef<string | undefined>(undefined)
  const previousSelectedResearchTaskRef = useRef<KnowledgeFsResearchTaskResponse | undefined>(
    undefined,
  )

  useEffect(() => {
    selectedResearchActiveRef.current = selectedResearchActive
  }, [selectedResearchActive])

  useEffect(
    () => () => {
      queryAbortControllerRef.current?.abort()
    },
    [],
  )

  useEffect(() => {
    const previousTask = previousSelectedResearchTaskRef.current
    previousSelectedResearchTaskRef.current = selectedResearchTask
    if (!shouldRefreshResearchPartials(previousTask, selectedResearchTask)) return
    if (refreshedTerminalPartialsTaskIdRef.current === selectedResearchTask?.id) return
    refreshedTerminalPartialsTaskIdRef.current = selectedResearchTask?.id
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
              if (event.type === 'research_task.stage_changed' && event.stage === 'generating')
                void refetchResearchPartials()
              const terminal =
                event.stage === 'canceled' ||
                event.stage === 'completed' ||
                event.stage === 'failed'
              if (!terminal || !selectedResearchActiveRef.current) return
              if (event.stage === 'completed')
                refreshedTerminalPartialsTaskIdRef.current = selectedResearchTaskId
              void Promise.all([refetchResearchTasks(), refetchResearchPartials()])
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
  }, [
    knowledgeSpaceId,
    refetchResearchPartials,
    refetchResearchTasks,
    selectedResearchTaskId,
    setAdmittedResearchTasks,
    setResearchEvents,
  ])

  const runFastQuery = useCallback(
    async (input?: { mode: RetrievalTestMode; query: string }) => {
      const cleanQuery = (input?.query ?? query).trim()
      const activeImages = input ? [] : queryImages
      if ((!cleanQuery && activeImages.length === 0) || runInFlightRef.current) return
      const imageReferences = activeImages.map((image) => ({ uploadFileId: image.uploadFileId }))
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
      void updateLocation({ research: null, retest: null, trace: null }, { history: 'replace' })
      const events: KnowledgeQueryEvent[] = []
      try {
        const admission =
          await consoleClient.knowledgeFs.spaces.byControlSpaceId.queries.admission.post({
            body: {
              mode: runMode,
              query: cleanQuery,
              ...(imageReferences.length ? { queryImages: imageReferences } : {}),
            },
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
        if (traceId) setLocalSelected({ id: traceId, kind: 'trace' })
        await refetchTraces()
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
    },
    [
      ensureModelReady,
      knowledgeSpaceId,
      mode,
      query,
      queryImages,
      refetchTraces,
      setComposerDraft,
      setLocalRun,
      setLocalSelected,
      updateLocation,
    ],
  )

  const startResearch = useCallback(
    async (input?: { query: string; queryImages?: readonly KnowledgeFsQueryImageReference[] }) => {
      const cleanQuery = (input?.query ?? query).trim()
      const imageReferences = input
        ? [...(input.queryImages ?? [])]
        : queryImages.map((image) => ({ uploadFileId: image.uploadFileId }))
      if ((!cleanQuery && imageReferences.length === 0) || runInFlightRef.current) return
      runInFlightRef.current = true
      try {
        if (
          (await ensureModelReady({ capability: 'research', intent: 'retrieval-test' })).status !==
          'ready'
        )
          return
        const plan =
          await consoleClient.knowledgeFs.spaces.byControlSpaceId.researchTasks.plan.post({
            body: {
              mode: 'research',
              query: cleanQuery,
              ...(imageReferences.length ? { queryImages: imageReferences } : {}),
            },
            params: { control_space_id: knowledgeSpaceId },
          })
        const task = await consoleClient.knowledgeFs.spaces.byControlSpaceId.researchTasks.post({
          body: {
            budgetUsd: plan.budget.budget_usd,
            mode: 'research',
            query: cleanQuery,
            ...(imageReferences.length ? { queryImages: imageReferences } : {}),
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
        void updateLocation(
          { research: task.id, retest: null, trace: null },
          { history: 'push', shallow: false },
        )
        await refetchResearchTasks()
      } catch {
        toast.error(t(($) => $['newKnowledge.retrievalTest.failedDescription']))
      } finally {
        runInFlightRef.current = false
      }
    },
    [
      ensureModelReady,
      knowledgeSpaceId,
      query,
      queryImages,
      refetchResearchTasks,
      setAdmittedResearchTasks,
      setComposerDraft,
      setLocalSelected,
      setResearchPlans,
      t,
      updateLocation,
    ],
  )

  const cancelResearch = useCallback(
    async (taskId: string) => {
      try {
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.researchTasks.byTaskId.delete({
          params: { control_space_id: knowledgeSpaceId, task_id: taskId },
        })
        await Promise.all([refetchResearchTasks(), refetchResearchPartials()])
      } catch {
        toast.error(t(($) => $['newKnowledge.taskActionFailed']))
      }
    },
    [knowledgeSpaceId, refetchResearchPartials, refetchResearchTasks, t],
  )

  const run = useCallback(() => {
    if (selectedResearchActive || localRun?.status === 'running') return
    if (mode === 'research') void startResearch()
    else void runFastQuery()
  }, [localRun?.status, mode, runFastQuery, selectedResearchActive, startResearch])

  const retry = useCallback(async () => {
    if (runInFlightRef.current || selectedResearchActive || localRun?.status === 'running') return
    if (selected?.kind === 'research' && selectedResearchTask) {
      if (!researchTaskCanRetry(selectedResearchTask)) return
      setResearchRetryPending(true)
      try {
        await startResearch({
          query: selectedResearchTask.query,
          queryImages: selectedResearchTask.query_images ?? [],
        })
      } finally {
        setResearchRetryPending(false)
      }
      return
    }
    if (mode === 'research') void startResearch()
    else void runFastQuery()
  }, [
    localRun?.status,
    mode,
    runFastQuery,
    selected?.kind,
    selectedResearchActive,
    selectedResearchTask,
    setResearchRetryPending,
    startResearch,
  ])

  useLayoutEffect(() => {
    setRuntimeBridge({
      cancelResearch: (taskId) => void cancelResearch(taskId),
      retry,
      run,
      runFastQuery: (input) => void runFastQuery(input),
    })
  }, [cancelResearch, retry, run, runFastQuery, setRuntimeBridge])

  const runRetest = useEffectEvent((command: { mode: RetrievalTestMode; query: string }) => {
    if (command.mode === 'research') void startResearch({ query: command.query })
    else void runFastQuery(command)
  })

  useEffect(() => {
    const linkedRetestTraceId = linkedSelection.retest
    const linkedTraceId = linkedSelection.trace
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
  }, [linkedSelection.retest, linkedSelection.trace, mode, query, selected?.id, selected?.kind])

  return (
    <KnowledgeModelSetupDialog
      open={modelSetupDialogOpen}
      readiness={modelReadiness}
      onConfigure={configureModelSetup}
      onOpenChange={setModelSetupDialogOpen}
    />
  )
}
