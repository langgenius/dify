import type { RetrievalTestMode, RetrievalTestRecord } from '../model'
import type { RetrievalComposerImage } from './scoped'
import { skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithInfiniteQuery, atomWithQuery } from 'jotai-tanstack-query'
import { selectAtom } from 'jotai/utils'
import { consoleQuery } from '@/service/client'
import { knowledgeFsTaskFailureMessageKey } from '../../knowledge-fs-task-error'
import { timeValue } from '../history-utils'
import {
  extractRetrievalEvidence,
  normalizedRetrievalTestMode,
  researchTaskIsActive,
  retrievalQueryImages,
  retrievalTestRecords,
} from '../model'
import { researchTaskAnswerFromEvents } from '../services/research-task-events'
import { retrievalKnowledgeSpaceIdAtom, retrievalLinkedSelectionAtom } from './inputs'
import {
  retrievalAdmittedResearchTasksAtom,
  retrievalComposerDraftAtom,
  retrievalComposerImagesAtom,
  retrievalLocalRunAtom,
  retrievalLocalSelectedAtom,
  retrievalRecordImagesAtom,
  retrievalResearchEventsAtom,
  retrievalResearchPlansAtom,
  retrievalResearchRetryPendingAtom,
} from './scoped'

const noQueryImages: RetrievalComposerImage[] = []

const tracesQueryAtom = atomWithInfiniteQuery((get) =>
  consoleQuery.knowledgeFs.spaces.byControlSpaceId.traces.get.infiniteOptions({
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: null as string | null,
    input: (pageParam) => ({
      params: { control_space_id: get(retrievalKnowledgeSpaceIdAtom) },
      ...(typeof pageParam === 'string' ? { query: { cursor: pageParam } } : {}),
    }),
    refetchInterval: get(retrievalLocalRunAtom)?.status === 'running' ? 1000 : false,
  }),
)

const researchTasksQueryAtom = atomWithInfiniteQuery((get) =>
  consoleQuery.knowledgeFs.spaces.byControlSpaceId.researchTasks.get.infiniteOptions({
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: null as string | null,
    input: (pageParam) => ({
      params: { control_space_id: get(retrievalKnowledgeSpaceIdAtom) },
      ...(typeof pageParam === 'string' ? { query: { cursor: pageParam } } : {}),
    }),
    refetchInterval: (current) => {
      const persistedTasks = current.state.data?.pages.flatMap((page) => page.data) ?? []
      const persistedById = new Map(persistedTasks.map((task) => [task.id, task]))
      const admittedTaskIsActive = Object.values(get(retrievalAdmittedResearchTasksAtom)).some(
        (task) => {
          const persisted = persistedById.get(task.id)
          const effectiveTask =
            persisted && persisted.updated_at >= task.updated_at ? persisted : task
          return researchTaskIsActive(effectiveTask)
        },
      )
      return admittedTaskIsActive || persistedTasks.some((task) => researchTaskIsActive(task))
        ? 1000
        : false
    },
  }),
)

const tracesQueryDataAtom = selectAtom(tracesQueryAtom, (query) => query.data)
const researchTasksQueryDataAtom = selectAtom(researchTasksQueryAtom, (query) => query.data)

const retrievalTracesAtom = atom(
  (get) => get(tracesQueryDataAtom)?.pages.flatMap((page) => page.data) ?? [],
)

const retrievalResearchTasksAtom = atom((get) => {
  const byId = new Map(
    Object.values(get(retrievalAdmittedResearchTasksAtom)).map((task) => [task.id, task] as const),
  )
  for (const persisted of get(researchTasksQueryDataAtom)?.pages.flatMap((page) => page.data) ??
    []) {
    const admitted = byId.get(persisted.id)
    if (!admitted || persisted.updated_at >= admitted.updated_at) byId.set(persisted.id, persisted)
  }
  return [...byId.values()]
})

const recordsAtom = atom((get) =>
  retrievalTestRecords(get(retrievalTracesAtom), get(retrievalResearchTasksAtom)),
)

const localRecordAtom = atom<RetrievalTestRecord | undefined>((get) => {
  const localRun = get(retrievalLocalRunAtom)
  if (!localRun || localRun.status === 'running') return undefined
  return {
    createdAt: localRun.startedAt,
    durationMs: localRun.endedAt ? localRun.endedAt - localRun.startedAt : undefined,
    id: localRun.id,
    kind: 'local',
    mode: localRun.mode,
    query: localRun.query,
    ...(localRun.queryImages.length > 0 ? { queryImages: localRun.queryImages } : {}),
    resultCount: localRun.evidence.length,
    status: localRun.status === 'no-results' ? 'completed' : localRun.status,
  }
})

const retrievalDisplayRecordsAtom = atom((get) => {
  const records = get(recordsAtom)
  const localRecord = get(localRecordAtom)
  const localRun = get(retrievalLocalRunAtom)
  const traceAlreadyListed = Boolean(
    localRun?.traceId &&
    records.some((record) => record.kind === 'trace' && record.id === localRun.traceId),
  )
  return localRecord && !traceAlreadyListed ? [localRecord, ...records] : records
})

const requestedSelectionAtom = atom((get) => {
  const linked = get(retrievalLinkedSelectionAtom)
  if (linked.research) return { id: linked.research, kind: 'research' as const }
  if (linked.trace) return { id: linked.trace, kind: 'trace' as const }
  return get(retrievalLocalSelectedAtom)
})

export const retrievalSelectedAtom = atom((get) => {
  const requested = get(requestedSelectionAtom)
  if (requested?.kind === 'local') {
    const persistedTraceId = get(retrievalLocalRunAtom)?.traceId
    if (
      persistedTraceId &&
      get(recordsAtom).some((record) => record.kind === 'trace' && record.id === persistedTraceId)
    )
      return { id: persistedTraceId, kind: 'trace' as const }
  }
  if (requested) return requested
  const newest = get(retrievalDisplayRecordsAtom)[0]
  return newest ? { id: newest.id, kind: newest.kind } : undefined
})

const retrievalSelectedHistoryKeyAtom = atom((get) => {
  const selected = get(retrievalSelectedAtom)
  return selected && selected.kind !== 'local' ? `${selected.kind}:${selected.id}` : undefined
})

const selectedRecordAtom = atom((get) => {
  const selected = get(retrievalSelectedAtom)
  return get(recordsAtom).find(
    (record) => record.id === selected?.id && record.kind === selected.kind,
  )
})

const selectedResearchTaskFromHistoryAtom = atom((get) => {
  const selected = get(retrievalSelectedAtom)
  return selected?.kind === 'research'
    ? get(retrievalResearchTasksAtom).find((task) => task.id === selected.id)
    : undefined
})

const needsResearchDetailAtom = atom(
  (get) =>
    get(retrievalSelectedAtom)?.kind === 'research' && !get(selectedResearchTaskFromHistoryAtom),
)

const researchDetailQueryAtom = atomWithQuery((get) => {
  const selected = get(retrievalSelectedAtom)
  const needsDetail = get(needsResearchDetailAtom)
  return consoleQuery.knowledgeFs.spaces.byControlSpaceId.researchTasks.byTaskId.get.queryOptions({
    input:
      needsDetail && selected?.kind === 'research'
        ? {
            params: {
              control_space_id: get(retrievalKnowledgeSpaceIdAtom),
              task_id: selected.id,
            },
          }
        : skipToken,
  })
})

export const retrievalSelectedResearchTaskAtom = atom((get) => {
  const selected = get(retrievalSelectedAtom)
  if (selected?.kind !== 'research') return undefined
  return get(selectedResearchTaskFromHistoryAtom) ?? get(researchDetailQueryAtom).data
})

const selectedFailedAtom = atom((get) => {
  const selected = get(retrievalSelectedAtom)
  const localRun = get(retrievalLocalRunAtom)
  const selectedRecord = get(selectedRecordAtom)
  const selectedResearchTask = get(retrievalSelectedResearchTaskAtom)
  return Boolean(
    (selected?.kind === 'local' && localRun?.status === 'failed') ||
    (selected?.kind === 'trace' && selectedRecord?.status === 'failed') ||
    (selected?.kind === 'research' && selectedResearchTask?.stage === 'failed'),
  )
})

const selectedFailureMessageKeyAtom = atom((get) => {
  const selected = get(retrievalSelectedAtom)
  const selectedResearchTask = get(retrievalSelectedResearchTaskAtom)
  if (selected?.kind !== 'research' || selectedResearchTask?.stage !== 'failed') return undefined
  return (
    knowledgeFsTaskFailureMessageKey(
      selectedResearchTask.failure ?? undefined,
      selectedResearchTask.error ?? undefined,
    ) ?? 'newKnowledge.taskFailure.research'
  )
})

const retrievalSelectedTraceIdAtom = atom((get) => {
  const selected = get(retrievalSelectedAtom)
  if (selected?.kind === 'trace') return selected.id
  if (selected?.kind === 'local') return get(retrievalLocalRunAtom)?.traceId
  return undefined
})

const traceDetailQueryAtom = atomWithQuery((get) => {
  const traceId = get(retrievalSelectedTraceIdAtom)
  return consoleQuery.knowledgeFs.spaces.byControlSpaceId.traces.byTraceId.get.queryOptions({
    input:
      traceId && !get(selectedFailedAtom)
        ? {
            params: {
              control_space_id: get(retrievalKnowledgeSpaceIdAtom),
              trace_id: traceId,
            },
          }
        : skipToken,
  })
})

export const retrievalComposerQueryAtom = atom((get) => {
  const draft = get(retrievalComposerDraftAtom)
  const selectedHistoryKey = get(retrievalSelectedHistoryKeyAtom)
  if (draft.selectionKey === selectedHistoryKey) return draft.query
  const selected = get(retrievalSelectedAtom)
  const selectedRecord = get(selectedRecordAtom)
  return (
    (selected?.kind === 'local' ? undefined : selectedRecord?.query) ??
    get(retrievalSelectedResearchTaskAtom)?.query ??
    get(traceDetailQueryAtom).data?.query ??
    ''
  )
})

export const retrievalComposerModeAtom = atom<RetrievalTestMode>((get) => {
  const draft = get(retrievalComposerDraftAtom)
  const selectedHistoryKey = get(retrievalSelectedHistoryKeyAtom)
  if (draft.selectionKey === selectedHistoryKey) return draft.mode
  const selected = get(retrievalSelectedAtom)
  const selectedRecord = get(selectedRecordAtom)
  return normalizedRetrievalTestMode(
    (selected?.kind === 'local' ? undefined : selectedRecord?.mode) ??
      get(retrievalSelectedResearchTaskAtom)?.mode ??
      get(traceDetailQueryAtom).data?.mode,
  )
})

const traceEvidenceQueryAtom = atomWithInfiniteQuery((get) => {
  const traceId = get(retrievalSelectedTraceIdAtom)
  return consoleQuery.knowledgeFs.spaces.byControlSpaceId.traces.byTraceId.evidence.get.infiniteOptions(
    {
      getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
      initialPageParam: null as string | null,
      input:
        traceId && !get(selectedFailedAtom)
          ? (pageParam) => ({
              params: {
                control_space_id: get(retrievalKnowledgeSpaceIdAtom),
                trace_id: traceId,
              },
              query: {
                ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
                limit: 100,
              },
            })
          : skipToken,
    },
  )
})

const researchPartialsQueryAtom = atomWithInfiniteQuery((get) => {
  const task = get(retrievalSelectedResearchTaskAtom)
  return consoleQuery.knowledgeFs.spaces.byControlSpaceId.researchTasks.byTaskId.partials.get.infiniteOptions(
    {
      getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
      initialPageParam: null as string | null,
      input: task
        ? (pageParam) => ({
            params: {
              control_space_id: get(retrievalKnowledgeSpaceIdAtom),
              task_id: task.id,
            },
            query: {
              ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
              limit: 100,
            },
          })
        : skipToken,
      refetchInterval: researchTaskIsActive(task) ? 1000 : false,
    },
  )
})

const traceEvidenceDataAtom = selectAtom(traceEvidenceQueryAtom, (query) => query.data)
const researchPartialsDataAtom = selectAtom(researchPartialsQueryAtom, (query) => query.data)

const retrievalTraceEvidenceAtom = atom(
  (get) => get(traceEvidenceDataAtom)?.pages.flatMap((page) => page.data) ?? [],
)
const retrievalResearchPartialsAtom = atom(
  (get) => get(researchPartialsDataAtom)?.pages.flatMap((page) => page.data) ?? [],
)

const retrievalCurrentEvidenceAtom = atom((get) => {
  const selected = get(retrievalSelectedAtom)
  if (selected?.kind !== 'research' && get(selectedFailedAtom)) return []
  const localRun = get(retrievalLocalRunAtom)
  const historicalEvidence = extractRetrievalEvidence(get(retrievalTraceEvidenceAtom))
  if (selected?.kind === 'local' && localRun)
    return localRun.evidence.length ? localRun.evidence : historicalEvidence
  if (selected?.kind === 'research')
    return extractRetrievalEvidence(get(retrievalResearchPartialsAtom))
  return historicalEvidence
})

const retrievalSelectedResearchEventsAtom = atom((get) => {
  const task = get(retrievalSelectedResearchTaskAtom)
  return task ? (get(retrievalResearchEventsAtom)[task.id] ?? []) : []
})

const retrievalResearchAnswerFactsAtom = atom((get) => {
  const task = get(retrievalSelectedResearchTaskAtom)
  const partials = get(retrievalResearchPartialsAtom)
  const streamed = researchTaskAnswerFromEvents(get(retrievalSelectedResearchEventsAtom))
  const persisted = [...partials]
    .sort((left, right) => right.sequence - left.sequence)
    .find((partial) => partial.answer?.trim())
    ?.answer?.trim()
  return {
    answer: task ? (persisted ?? streamed) : '',
    persisted,
  }
})

const localRunImagesAtom = atom((get) => get(retrievalLocalRunAtom)?.queryImages ?? noQueryImages)

function recordImagesKey(selected: { id: string; kind: RetrievalTestRecord['kind'] }) {
  return `${selected.kind}:${selected.id}`
}

/**
 * Images the selected record was run with. A run started in this session keeps its local
 * previews; anything else comes from the persisted record, which carries a signed preview URL
 * for files the user still owns.
 */
export const retrievalSelectedQueryImagesAtom = atom((get) => {
  const selected = get(retrievalSelectedAtom)
  if (!selected) return noQueryImages
  if (selected.kind === 'local') {
    const localRun = get(retrievalLocalRunAtom)
    return localRun?.id === selected.id ? localRun.queryImages : noQueryImages
  }
  const remembered = get(retrievalRecordImagesAtom)[recordImagesKey(selected)]
  if (remembered) return remembered
  const persisted = get(selectedRecordAtom)?.queryImages
  if (persisted?.length) return persisted
  const detail =
    selected.kind === 'research'
      ? get(retrievalSelectedResearchTaskAtom)?.query_images
      : get(traceDetailQueryAtom).data?.query_images
  return detail?.length ? retrievalQueryImages(detail) : noQueryImages
})

/**
 * What the composer shows: the images edited under the current selection, otherwise the images
 * the selected record was run with, mirroring how the query text follows the selection.
 */
export const retrievalComposerQueryImagesAtom = atom((get) => {
  const draft = get(retrievalComposerImagesAtom)
  if (draft.selectionKey === get(retrievalSelectedHistoryKeyAtom)) return draft.images
  return get(retrievalSelectedQueryImagesAtom)
})

/** Every object URL still referenced by the composer or by a run started in this session. */
export const retrievalRetainedImagesAtom = atom((get) => {
  const retained = new Map<string, RetrievalComposerImage>()
  for (const image of [
    ...get(retrievalComposerImagesAtom).images,
    ...get(localRunImagesAtom),
    ...Object.values(get(retrievalRecordImagesAtom)).flat(),
  ]) {
    if (image.previewUrl?.startsWith('blob:')) retained.set(image.previewUrl, image)
  }
  return [...retained.values()]
})

export const retrievalComposerFactsAtom = atom((get) => {
  const localRun = get(retrievalLocalRunAtom)
  const selectedResearchActive = researchTaskIsActive(get(retrievalSelectedResearchTaskAtom))
  const query = get(retrievalComposerQueryAtom)
  const images = get(retrievalComposerQueryImagesAtom)
  return {
    disabled: selectedResearchActive || localRun?.status === 'running',
    images,
    mode: get(retrievalComposerModeAtom),
    query,
    runnable:
      (Boolean(query.trim()) || images.length > 0) &&
      !selectedResearchActive &&
      localRun?.status !== 'running',
  }
})

export const retrievalHistoryFactsAtom = atom((get) => {
  const tracesQuery = get(tracesQueryAtom)
  const researchTasksQuery = get(researchTasksQueryAtom)
  const displayRecords = get(retrievalDisplayRecordsAtom)
  const selected = get(retrievalSelectedAtom)
  const persistedLocalTraceId =
    selected?.kind === 'local' ? get(retrievalLocalRunAtom)?.traceId : undefined
  const activeRecordKey =
    persistedLocalTraceId &&
    displayRecords.some((record) => record.kind === 'trace' && record.id === persistedLocalTraceId)
      ? `trace:${persistedLocalTraceId}`
      : selected
        ? `${selected.kind}:${selected.id}`
        : undefined
  return {
    activeRecordKey,
    displayRecords,
    hasNextPage: Boolean(tracesQuery.hasNextPage || researchTasksQuery.hasNextPage),
    isFetchingNextPage: tracesQuery.isFetchingNextPage || researchTasksQuery.isFetchingNextPage,
  }
})

export const retrievalResultFactsAtom = atom((get) => {
  const selected = get(retrievalSelectedAtom)
  const selectedRecord = get(selectedRecordAtom)
  const selectedResearchTask = get(retrievalSelectedResearchTaskAtom)
  const localRun = get(retrievalLocalRunAtom)
  const currentEvidence = get(retrievalCurrentEvidenceAtom)
  const researchDetailQuery = get(researchDetailQueryAtom)
  const traceDetailQuery = get(traceDetailQueryAtom)
  const traceEvidenceQuery = get(traceEvidenceQueryAtom)
  const researchPartialsQuery = get(researchPartialsQueryAtom)
  const needsResearchDetail = get(needsResearchDetailAtom)
  const selectedFailed = get(selectedFailedAtom)
  const selectedResearchActive = researchTaskIsActive(selectedResearchTask)
  const selectedIsLoading = Boolean(
    (selected?.kind === 'local' && localRun?.status === 'running') ||
    (selected?.kind === 'trace' && !selectedRecord && traceDetailQuery.isPending) ||
    (selected?.kind === 'trace' && !selectedFailed && traceEvidenceQuery.isPending) ||
    (needsResearchDetail && researchDetailQuery.isPending) ||
    (selected?.kind === 'research' && selectedResearchTask && researchPartialsQuery.isPending),
  )
  const selectedDataError = Boolean(
    (needsResearchDetail && researchDetailQuery.isError) ||
    (selected?.kind === 'trace' &&
      !selectedFailed &&
      (traceDetailQuery.isError ||
        traceEvidenceQuery.isError ||
        traceEvidenceQuery.isFetchNextPageError)) ||
    (selected?.kind === 'research' &&
      selectedResearchTask &&
      (researchPartialsQuery.isError || researchPartialsQuery.isFetchNextPageError)),
  )
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

  return {
    currentEvidence,
    currentEvidenceDocumentCount: new Set(
      currentEvidence
        .map((evidence) => evidence.documentId ?? evidence.documentAssetId ?? evidence.documentName)
        .filter((document): document is string => Boolean(document)),
    ).size,
    hasMoreEvidencePages: Boolean(
      traceEvidenceQuery.hasNextPage || (selectedResearchTask && researchPartialsQuery.hasNextPage),
    ),
    localError: selected?.kind === 'local' ? localRun?.error : undefined,
    researchAnswer: get(retrievalResearchAnswerFactsAtom),
    researchEvents: get(retrievalSelectedResearchEventsAtom),
    researchPlan: selectedResearchTask
      ? get(retrievalResearchPlansAtom)[selectedResearchTask.id]
      : undefined,
    researchRetryPending: get(retrievalResearchRetryPendingAtom),
    resultKey: selected ? `${selected.kind}:${selected.id}` : undefined,
    selected,
    selectedCreatedAt,
    selectedDataError,
    selectedFailed,
    selectedFailureMessageKey: get(selectedFailureMessageKeyAtom),
    selectedHasNoResults: selected?.kind === 'local' && localRun?.status === 'no-results',
    selectedIsLoading,
    selectedMode,
    selectedOpenBadCaseId:
      selectedRecord?.kind === 'trace' ? selectedRecord.openBadCaseId : undefined,
    selectedQuery,
    selectedQueryImages: get(retrievalSelectedQueryImagesAtom),
    selectedResearchActive,
    selectedResearchTask,
    selectedTraceId: get(retrievalSelectedTraceIdAtom),
    traceHasNextPage: Boolean(traceEvidenceQuery.hasNextPage),
    traceIsFetchingNextPage: traceEvidenceQuery.isFetchingNextPage,
    researchHasNextPage: Boolean(researchPartialsQuery.hasNextPage),
    researchIsFetchingNextPage: researchPartialsQuery.isFetchingNextPage,
  }
})

export const updateRetrievalComposerQueryAtom = atom(null, (get, set, query: string) => {
  set(retrievalComposerDraftAtom, {
    mode: get(retrievalComposerModeAtom),
    query,
    ...(get(retrievalSelectedHistoryKeyAtom)
      ? { selectionKey: get(retrievalSelectedHistoryKeyAtom) }
      : {}),
  })
})

export const updateRetrievalComposerModeAtom = atom(null, (get, set, mode: RetrievalTestMode) => {
  set(retrievalComposerDraftAtom, {
    mode,
    query: get(retrievalComposerQueryAtom),
    ...(get(retrievalSelectedHistoryKeyAtom)
      ? { selectionKey: get(retrievalSelectedHistoryKeyAtom) }
      : {}),
  })
})

export const updateRetrievalComposerImagesAtom = atom(
  null,
  (get, set, images: RetrievalComposerImage[]) => {
    const selectionKey = get(retrievalSelectedHistoryKeyAtom)
    set(retrievalComposerImagesAtom, { images, ...(selectionKey ? { selectionKey } : {}) })
  },
)

export const selectRetrievalRecordAtom = atom(null, (get, set, record: RetrievalTestRecord) => {
  if (record.kind === 'local') {
    set(retrievalLocalSelectedAtom, { id: record.id, kind: record.kind })
    void set(
      retrievalLinkedSelectionAtom,
      { research: null, retest: null, trace: null },
      { history: 'push' },
    )
  } else {
    set(retrievalLocalSelectedAtom, undefined)
    void set(
      retrievalLinkedSelectionAtom,
      {
        research: record.kind === 'research' ? record.id : null,
        retest: null,
        trace: record.kind === 'trace' ? record.id : null,
      },
      { history: 'push', shallow: false },
    )
  }
  set(retrievalComposerDraftAtom, {
    mode: record.mode,
    query: record.query,
    ...(record.kind === 'local' ? {} : { selectionKey: `${record.kind}:${record.id}` }),
  })
  // A persisted record shows the images it was run with until the composer is edited again; a
  // local (unpersisted) run has no history key, so its images are copied into the draft.
  const localRun = get(retrievalLocalRunAtom)
  set(retrievalComposerImagesAtom, {
    images: record.kind === 'local' && localRun?.id === record.id ? localRun.queryImages : [],
  })
})

export const loadMoreRetrievalHistoryAtom = atom(null, (get) => {
  const tracesQuery = get(tracesQueryAtom)
  const researchTasksQuery = get(researchTasksQueryAtom)
  if (tracesQuery.hasNextPage) void tracesQuery.fetchNextPage()
  if (researchTasksQuery.hasNextPage) void researchTasksQuery.fetchNextPage()
})

export const retrySelectedRetrievalDataAtom = atom(null, (get) => {
  const selected = get(retrievalSelectedAtom)
  const researchDetailQuery = get(researchDetailQueryAtom)
  const traceDetailQuery = get(traceDetailQueryAtom)
  const traceEvidenceQuery = get(traceEvidenceQueryAtom)
  const researchPartialsQuery = get(researchPartialsQueryAtom)
  if (get(needsResearchDetailAtom) && researchDetailQuery.isError) {
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
})

export const loadMoreSelectedRetrievalEvidenceAtom = atom(null, (get) => {
  const task = get(retrievalSelectedResearchTaskAtom)
  if (task) {
    const researchPartialsQuery = get(researchPartialsQueryAtom)
    if (researchPartialsQuery.hasNextPage) void researchPartialsQuery.fetchNextPage()
    return
  }
  const traceEvidenceQuery = get(traceEvidenceQueryAtom)
  if (traceEvidenceQuery.hasNextPage) void traceEvidenceQuery.fetchNextPage()
})

export const retrievalRuntimeQueryFactsAtom = atom((get) => ({
  refetchResearchPartials: get(researchPartialsQueryAtom).refetch,
  refetchResearchTasks: get(researchTasksQueryAtom).refetch,
  refetchTraces: get(tracesQueryAtom).refetch,
}))
