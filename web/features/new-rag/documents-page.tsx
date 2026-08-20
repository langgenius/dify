'use client'

import type { DocumentAction } from './document-actions-dropdown'
import type { DocumentProcessingTask } from './document-models'
import type { DocumentUploadFormHandle } from './document-upload-form'
import type { DocumentUploadIssue } from './document-upload-policy'
import type { KnowledgeFsUploadPhase, KnowledgeFsUploadProgress } from './knowledge-fs-upload'
import type {
  ProcessingTaskEvent,
  ProcessingTaskProgressEvent,
} from './services/processing-task-events'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { debounce, parseAsString, parseAsStringLiteral, useQueryState } from 'nuqs'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import {
  datasetDefaultPermissionKeysAtom,
  refreshWorkspacePermissionKeysAfterMutationDenialAtom,
  retryWorkspacePermissionKeysAtom,
  workspacePermissionKeysErrorAtom,
  workspacePermissionKeysFetchingAtom,
  workspacePermissionKeysLoadingAtom,
} from '@/context/permission-state'
import { knowledgeFsUploadEnabledAtom } from '@/features/system-features/state'
import { consoleClient, consoleQuery } from '@/service/client'
import { downloadBlob } from '@/utils/download'
import { DatasetACLPermission, hasPermission } from '@/utils/permission'
import { useAuxiliaryTaskReadGuard } from './auxiliary-task-read-guard'
import { KnowledgeModelReadinessBanner } from './components/knowledge-model-readiness-banner'
import { KnowledgeModelSetupDialog } from './components/knowledge-model-setup-dialog'
import {
  DocumentBulkActions,
  DocumentDropOverlay,
  DocumentsEmpty,
  DocumentsList,
} from './document-list'
import { DocumentMetadataDrawer } from './document-metadata-drawer'
import {
  ACTIVE_TASK_STATES,
  documentCanDownload,
  documentCanReindex,
  documentCanToggleAvailability,
  documentDisplayStatus,
  documentShowsAvailabilityAction,
  documentTitle,
  newestTaskByDocument,
  sourceName,
  taskCanRetry,
  taskIsActive,
  taskNeedsAttention,
  taskVersionIsAfter,
} from './document-model'
import {
  backgroundTaskFromApi,
  backgroundTaskListFromApi,
  documentTaskFromApi,
  documentTaskListFromApi,
  logicalDocumentListFromApi,
} from './document-models'
import { DocumentUploadForm } from './document-upload-form'
import { documentUploadIssue } from './document-upload-policy'
import { knowledgeFsTaskFailureMessageKey } from './knowledge-fs-task-error'
import {
  discardKnowledgeFsStagedUpload,
  stageKnowledgeFsDocument,
  uploadKnowledgeFsDocuments,
} from './knowledge-fs-upload'
import { ProcessingTasksDrawer } from './processing-tasks-drawer'
import { createRequestId } from './request-id'
import { newKnowledgeDocumentDetailPath } from './routes'
import { sourceFromApi } from './source-models'
import { TaskEventObserver } from './task-event-observer'
import { createTaskProgressStore } from './task-progress-store'
import { useKnowledgeModelSetupGuard } from './use-knowledge-model-setup-guard'
import { useQueryDataUpdateCount } from './use-query-data-update-count'

const TASK_PAGE_SIZE = 100
const KNOWLEDGE_FS_BATCH_DOCUMENT_MAX_DOCUMENTS = 100
const MAX_TASK_EVENT_STREAMS = 6
const MAX_AUTO_CURSOR_PAGES = 20
const FAILED_TASK_POLL_REQUEST_TIMEOUT = 3000
const TERMINAL_RECONCILIATION_REQUEST_TIMEOUT = 3000
const DOCUMENT_STAGING_REQUEST_TIMEOUT = 30_000
const BLOCKED_ACTIVE_TASK_REFRESH_INTERVAL = 5000
const MAX_BLOCKED_ACTIVE_TASK_REFRESH_INTERVAL = 30000
const documentFilterParser = parseAsStringLiteral([
  'all',
  'ready',
  'queued',
  'processing',
  'failed',
  'disabled',
] as const)
  .withDefault('all')
  .withOptions({ history: 'push' })
const documentSearchParser = parseAsString.withDefault('').withOptions({
  limitUrlUpdates: debounce(300),
})
const documentUploadParser = parseAsStringLiteral(['1'] as const).withOptions({
  history: 'replace',
})
const documentMetadataParser = parseAsStringLiteral(['1'] as const).withOptions({
  history: 'replace',
})

class DocumentStagingCanceledError extends Error {
  constructor() {
    super('Document staging was canceled')
    this.name = 'DocumentStagingCanceledError'
  }
}

class DocumentStagingTimeoutError extends Error {
  constructor() {
    super('Document staging timed out')
    this.name = 'DocumentStagingTimeoutError'
  }
}

const uploadExclusionReasonKey = {
  batch_byte_limit_exceeded: 'batchLimit',
  document_not_found: 'target',
  file_count_limit_exceeded: 'countLimit',
  file_too_large: 'fileSize',
  invalid_file: 'fileType',
  invalid_target: 'target',
  processing_failed: 'processing',
  quota_exceeded: 'quota',
  revision_conflict: 'target',
  unsupported_mime_type: 'fileType',
} as const

async function findBackgroundTask(knowledgeSpaceId: string, taskId: string, signal?: AbortSignal) {
  return (await findBackgroundTasks(knowledgeSpaceId, new Set([taskId]), signal)).get(taskId)
}

async function findBackgroundTasks(
  knowledgeSpaceId: string,
  taskIds: ReadonlySet<string>,
  signal?: AbortSignal,
) {
  const remainingTaskIds = new Set(taskIds)
  const tasks = new Map<string, DocumentProcessingTask>()
  if (!remainingTaskIds.size) return tasks
  let cursor: string | undefined
  for (let page = 0; page < MAX_AUTO_CURSOR_PAGES; page += 1) {
    const response = await consoleClient.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get(
      {
        params: { control_space_id: knowledgeSpaceId },
        query: { ...(cursor ? { cursor } : {}), limit: TASK_PAGE_SIZE },
      },
      { signal },
    )
    for (const candidate of response.data) {
      if (!remainingTaskIds.has(candidate.id)) continue
      const task = documentTaskFromApi(candidate)
      if (!task) continue
      tasks.set(task.id, task)
      remainingTaskIds.delete(task.id)
    }
    if (!remainingTaskIds.size) return tasks
    cursor = response.next_cursor ?? undefined
    if (!cursor) return tasks
  }
  return tasks
}

type UploadExclusionReasonKey =
  | DocumentUploadIssue
  | (typeof uploadExclusionReasonKey)[keyof typeof uploadExclusionReasonKey]

type TerminalTaskPin = {
  observedAt: string
  taskListGeneration: number
}

type TrustedActiveOverride = {
  taskListGeneration: number
  updatedAt: string
}

type AuxiliaryTaskReadDenial = {
  taskListGeneration: number
  taskVersion: string
}

const DOCUMENT_PERMISSION_DENIED = 1
const TASK_PERMISSION_DENIED = 2
const SOURCE_PERMISSION_DENIED = 4

function recoveryQueryMaskForPermissionDenials(permissionDenialMask: number) {
  let recoveryQueryMask = 0
  if (permissionDenialMask & DOCUMENT_PERMISSION_DENIED)
    recoveryQueryMask |= TASK_PERMISSION_DENIED | SOURCE_PERMISSION_DENIED
  if (permissionDenialMask & TASK_PERMISSION_DENIED) recoveryQueryMask |= SOURCE_PERMISSION_DENIED
  if (permissionDenialMask & SOURCE_PERMISSION_DENIED) recoveryQueryMask |= TASK_PERMISSION_DENIED
  return recoveryQueryMask & ~permissionDenialMask
}

function responseStatus(error: unknown): number | undefined {
  if (error instanceof Response) return error.status
  if (error && typeof error === 'object' && 'status' in error)
    return typeof error.status === 'number' ? error.status : undefined
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data
    if (data && typeof data === 'object' && 'status' in data)
      return typeof data.status === 'number' ? data.status : undefined
  }
}

function taskSnapshotErrorIsTransient(error: unknown) {
  const status = responseStatus(error)
  return status === undefined || status === 408 || status === 429 || status >= 500
}

function queryKeyMatchesKnowledgeSpace(queryKey: readonly unknown[], knowledgeSpaceId: string) {
  const state = queryKey[1]
  if (!state || typeof state !== 'object' || !('input' in state)) return false
  const input = state.input
  if (!input || typeof input !== 'object' || !('params' in input)) return false
  const params = input.params
  return Boolean(
    params &&
    typeof params === 'object' &&
    'control_space_id' in params &&
    params.control_space_id === knowledgeSpaceId,
  )
}

function normalizedTaskSnapshot(task: DocumentProcessingTask): DocumentProcessingTask {
  return {
    ...task,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
  }
}

function mergeTaskOverride(
  task: DocumentProcessingTask,
  override: Partial<DocumentProcessingTask>,
): DocumentProcessingTask {
  const stateChanged = override.state !== undefined && override.state !== task.state
  return {
    ...task,
    ...(stateChanged ? { canCancel: undefined, canRetry: undefined } : {}),
    ...override,
  }
}

export function DocumentsPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const datasetDefaultPermissionKeys = useAtomValue(datasetDefaultPermissionKeysAtom)
  const workspacePermissionKeysLoading = useAtomValue(workspacePermissionKeysLoadingAtom)
  const workspacePermissionKeysFetching = useAtomValue(workspacePermissionKeysFetchingAtom)
  const workspacePermissionKeysError = useAtomValue(workspacePermissionKeysErrorAtom)
  const uploadAvailable = useAtomValue(knowledgeFsUploadEnabledAtom)
  const retryWorkspacePermissionKeys = useSetAtom(retryWorkspacePermissionKeysAtom)
  const refreshWorkspacePermissionKeysAfterMutationDenial = useSetAtom(
    refreshWorkspacePermissionKeysAfterMutationDenialAtom,
  )
  const canEdit = hasPermission(datasetDefaultPermissionKeys, DatasetACLPermission.Edit)
  const hasDocumentDownloadPermission = hasPermission(
    datasetDefaultPermissionKeys,
    DatasetACLPermission.DocumentDownload,
  )
  const permissionPending = workspacePermissionKeysLoading
  const permissionQueryError = Boolean(workspacePermissionKeysError)
  const hasWorkspaceWritePermission = canEdit && !permissionPending && !permissionQueryError
  const canDownload = hasDocumentDownloadPermission && !permissionPending && !permissionQueryError
  const documentPermissionAlertRef = useRef<HTMLDivElement>(null)
  const writePermissionFocusRecoveryRequestedRef = useRef(false)
  const writePermissionFocusOriginRef = useRef<HTMLElement | null>(null)
  const uploadPendingRef = useRef(false)
  const uploadActivityCountRef = useRef(0)
  const uploadProgressRef = useRef<KnowledgeFsUploadProgress>(new Map())
  const uploadRequestIdsRef = useRef(new Map<string, string>())
  const stagedUploadIdsRef = useRef(new Map<File, string>())
  const stagingPromisesRef = useRef(new Map<File, Promise<string>>())
  const stagingControllersRef = useRef(new Map<File, AbortController>())
  const reindexPendingRef = useRef(false)
  const documentActionPendingRef = useRef(false)
  const bulkActionPendingRef = useRef(false)
  const [filter, setFilter] = useQueryState('status', documentFilterParser)
  const [search, setSearch] = useQueryState('query', documentSearchParser)
  const [uploadRequest, setUploadRequest] = useQueryState('upload', documentUploadParser)
  const [metadataRequest, setMetadataRequest] = useQueryState('metadata', documentMetadataParser)
  const metadataOpen = metadataRequest === '1'
  const setMetadataOpen = useCallback(
    (open: boolean) => {
      void setMetadataRequest(open ? '1' : null)
    },
    [setMetadataRequest],
  )
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(() => new Set())
  const [uploadFormInitialFiles, setUploadFormInitialFiles] = useState<File[]>([])
  const uploadFormRef = useRef<DocumentUploadFormHandle>(null)
  const [isFileDragActive, setIsFileDragActive] = useState(false)
  const fileDragDepthRef = useRef(0)
  const [tasksOpen, setTasksOpen] = useState(false)
  const [writePermissionRevoked, setWritePermissionRevoked] = useState(false)
  const [writePermissionRecoveryGeneration, setWritePermissionRecoveryGeneration] = useState<
    number | undefined
  >()
  const writePermissionDenialGenerationRef = useRef(0)
  const writePermissionRecoveryFetchSeenRef = useRef(false)
  const [blockingDependencyRetries, setBlockingDependencyRetries] = useState({
    sources: false,
    tasks: false,
  })
  const [taskStreamOffset, setTaskStreamOffset] = useState(0)
  const failedTaskPollOffsetRef = useRef(0)
  const [taskOverrides, setTaskOverrides] = useState<
    Record<string, Partial<DocumentProcessingTask>>
  >({})
  const [terminalTaskPins, setTerminalTaskPins] = useState<Record<string, TerminalTaskPin>>({})
  const [taskObserverGenerations, setTaskObserverGenerations] = useState<Record<string, number>>({})
  const terminalReconciliationGenerationsRef = useRef(new Map<string, number>())
  const failedTaskPollGenerationsRef = useRef(new Map<string, number>())
  const blockedFailedTaskPollVersionsRef = useRef(new Map<string, string>())
  const failedPollAuxiliaryDenialsRef = useRef(new Map<string, AuxiliaryTaskReadDenial>())
  const terminalConfirmableAuxiliaryDenialsRef = useRef(new Map<string, AuxiliaryTaskReadDenial>())
  const equalRetryListGenerationsRef = useRef(new Map<string, number>())
  const terminalReconciliationTimeoutsRef = useRef(new Map<string, number>())
  const terminalReconciliationControllersRef = useRef(new Map<string, AbortController>())
  const pendingTerminalProgressRef = useRef(new Map<string, ProcessingTaskProgressEvent>())
  const taskEventCursorsRef = useRef(new Map<string, string>())
  const listedBackgroundTaskStatesRef = useRef<{
    knowledgeSpaceId: string
    states: Map<string, string>
  }>({
    knowledgeSpaceId,
    states: new Map(),
  })
  const streamActiveOverrideVersionsRef = useRef(new Map<string, string>())
  const trustedActiveOverrideVersionsRef = useRef(new Map<string, TrustedActiveOverride>())
  const trustedOverrideListGenerationsRef = useRef(new Map<string, number>())
  const taskProgressStoreRef = useRef<ReturnType<typeof createTaskProgressStore> | null>(null)
  if (!taskProgressStoreRef.current) taskProgressStoreRef.current = createTaskProgressStore()
  const taskProgressStore = taskProgressStoreRef.current
  const [uploading, setUploading] = useState(false)
  const [stagedUploadProgress, setStagedUploadProgress] = useState<
    ReadonlyMap<File, KnowledgeFsUploadPhase>
  >(() => new Map())
  const [bulkActionPending, setBulkActionPending] = useState<
    'availability' | 'download' | 'reindex' | 'remove' | undefined
  >()
  const [pendingDocumentAction, setPendingDocumentAction] = useState<
    { action: DocumentAction; documentId: string } | undefined
  >()
  const { mutateAsync: reindexDocuments } = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.reindex.post.mutationOptions(),
  )
  const {
    configureModelSetup,
    ensureModelReady,
    modelReadiness,
    modelSetupDialogOpen,
    setModelSetupDialogOpen,
  } = useKnowledgeModelSetupGuard(knowledgeSpaceId)

  const documentsQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get.infiniteOptions({
      input: (pageParam) => ({
        params: { control_space_id: knowledgeSpaceId },
        query: {
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) => lastPage.next_cursor,
      initialPageParam: null as string | null,
    }),
  )
  const documentPermissionDenied = responseStatus(documentsQuery.error) === 403
  const refetchDocumentsQuery = documentsQuery.refetch
  const {
    deny: denyAuxiliaryTaskRead,
    guard: auxiliaryTaskReadGuard,
    permissionDenied: auxiliaryReadPermissionDenied,
    retry: retryAuxiliaryTaskRead,
  } = useAuxiliaryTaskReadGuard({
    documentPermissionDenied,
    refetchDocuments: refetchDocumentsQuery,
  })
  useEffect(() => {
    if (!documentPermissionDenied) return
    failedPollAuxiliaryDenialsRef.current.clear()
    terminalConfirmableAuxiliaryDenialsRef.current.clear()
  }, [documentPermissionDenied])
  const tasksQueryOptions = useMemo(
    () =>
      consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get.infiniteOptions({
        enabled: !documentPermissionDenied,
        input: (pageParam) => ({
          params: { control_space_id: knowledgeSpaceId },
          query: {
            limit: TASK_PAGE_SIZE,
            ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
          },
        }),
        getNextPageParam: (lastPage) => lastPage.next_cursor,
        initialPageParam: null as string | null,
      }),
    [documentPermissionDenied, knowledgeSpaceId],
  )
  const tasksQuery = useInfiniteQuery(tasksQueryOptions)
  const sourcesQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.sources.get.infiniteOptions({
      enabled: !documentPermissionDenied,
      input: (pageParam) => ({
        params: { control_space_id: knowledgeSpaceId },
        query: {
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) => lastPage.next_cursor,
      initialPageParam: null as string | null,
    }),
  )
  const permissionDenialMask =
    (documentPermissionDenied || auxiliaryReadPermissionDenied ? DOCUMENT_PERMISSION_DENIED : 0) |
    (responseStatus(tasksQuery.error) === 403 ? TASK_PERMISSION_DENIED : 0) |
    (responseStatus(sourcesQuery.error) === 403 ? SOURCE_PERMISSION_DENIED : 0)
  const permissionDenied = permissionDenialMask !== 0
  const previousPermissionDenialMaskRef = useRef(permissionDenialMask)
  const permissionRecoveryQueryMaskRef = useRef(
    recoveryQueryMaskForPermissionDenials(permissionDenialMask),
  )
  const canWrite = hasWorkspaceWritePermission && !permissionDenied && !writePermissionRevoked
  const canUpload = canWrite && uploadAvailable
  const uploadFormOpen = canUpload && uploadRequest === '1'
  const beginUploadActivity = useCallback(() => {
    uploadActivityCountRef.current += 1
    setUploading(true)
  }, [])
  const endUploadActivity = useCallback(() => {
    uploadActivityCountRef.current = Math.max(0, uploadActivityCountRef.current - 1)
    if (!uploadActivityCountRef.current) setUploading(false)
  }, [])
  const stageFiles = useCallback(async (files: File[]) => {
    const tasks = files.map((file) => {
      const stagedUploadId = stagedUploadIdsRef.current.get(file)
      if (stagedUploadId) return Promise.resolve(stagedUploadId)
      const active = stagingPromisesRef.current.get(file)
      if (active) return active

      const controller = new AbortController()
      let settled = false
      let timeout: number | undefined
      const promise = new Promise<string>((resolve, reject) => {
        function cleanup() {
          if (timeout !== undefined) window.clearTimeout(timeout)
          controller.signal.removeEventListener('abort', handleAbort)
          if (stagingControllersRef.current.get(file) === controller) {
            stagingPromisesRef.current.delete(file)
            stagingControllersRef.current.delete(file)
          }
        }
        function rejectOnce(error: unknown) {
          if (settled) return
          settled = true
          cleanup()
          reject(error)
        }
        function handleAbort() {
          rejectOnce(
            controller.signal.reason instanceof Error
              ? controller.signal.reason
              : new DocumentStagingCanceledError(),
          )
        }
        controller.signal.addEventListener('abort', handleAbort, { once: true })
        timeout = window.setTimeout(
          () => controller.abort(new DocumentStagingTimeoutError()),
          DOCUMENT_STAGING_REQUEST_TIMEOUT,
        )
        void stageKnowledgeFsDocument(file, controller.signal).then(
          (uploadId) => {
            if (settled) {
              void discardKnowledgeFsStagedUpload(uploadId).catch(() => undefined)
              return
            }
            settled = true
            cleanup()
            stagedUploadIdsRef.current.set(file, uploadId)
            resolve(uploadId)
          },
          (error) => {
            rejectOnce(error)
          },
        )
      })
      stagingPromisesRef.current.set(file, promise)
      stagingControllersRef.current.set(file, controller)
      return promise
    })
    if (!tasks.length) return

    const results = await Promise.allSettled(tasks)
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    const failed =
      failures.find(({ reason }) => !(reason instanceof DocumentStagingCanceledError)) ??
      failures[0]
    if (failed) throw failed.reason
  }, [])
  const discardStagedFile = useCallback((file: File) => {
    stagingControllersRef.current.get(file)?.abort(new DocumentStagingCanceledError())
    const uploadId = stagedUploadIdsRef.current.get(file)
    stagedUploadIdsRef.current.delete(file)
    if (uploadId) void discardKnowledgeFsStagedUpload(uploadId).catch(() => undefined)
  }, [])
  const discardStagedUploadObjects = useCallback(() => {
    const uploadIds = [...stagedUploadIdsRef.current.values()]
    for (const controller of stagingControllersRef.current.values())
      controller.abort(new DocumentStagingCanceledError())
    stagingControllersRef.current.clear()
    stagingPromisesRef.current.clear()
    stagedUploadIdsRef.current.clear()
    uploadProgressRef.current.clear()
    uploadRequestIdsRef.current.clear()
    for (const uploadId of uploadIds)
      void discardKnowledgeFsStagedUpload(uploadId).catch(() => undefined)
  }, [])
  const discardAllStagedFiles = useCallback(() => {
    discardStagedUploadObjects()
    setStagedUploadProgress(new Map())
  }, [discardStagedUploadObjects])
  const openUploadForm = useCallback(
    (files: File[] = []) => {
      writePermissionFocusRecoveryRequestedRef.current = true
      writePermissionFocusOriginRef.current = document.activeElement as HTMLElement | null
      fileDragDepthRef.current = 0
      setIsFileDragActive(false)
      setStagedUploadProgress(new Map())
      setUploadFormInitialFiles(files)
      void setUploadRequest('1')
    },
    [setUploadRequest],
  )
  const closeUploadForm = useCallback(() => {
    setStagedUploadProgress(new Map())
    setUploadFormInitialFiles([])
    void setUploadRequest(null)
  }, [setUploadRequest])
  const cancelUploadForm = useCallback(() => {
    discardAllStagedFiles()
    closeUploadForm()
  }, [closeUploadForm, discardAllStagedFiles])
  useEffect(
    () => () => {
      discardStagedUploadObjects()
    },
    [discardStagedUploadObjects],
  )
  useEffect(() => {
    if (uploadRequest !== '1' || permissionPending || canUpload) return
    discardStagedUploadObjects()
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Consume the route-owned one-shot signal after authorization resolves.
    void setUploadRequest(null)
  }, [canUpload, discardStagedUploadObjects, permissionPending, setUploadRequest, uploadRequest])
  const documentWriteRestrictionReasonId = permissionPending
    ? 'documents-permission-pending'
    : permissionQueryError
      ? 'documents-permission-error'
      : !canEdit || writePermissionRevoked
        ? 'documents-readonly-reason'
        : undefined
  const documentUploadRestrictionReasonId = !uploadAvailable
    ? 'documents-upload-unavailable'
    : documentWriteRestrictionReasonId
  const documentsRecoveryDescription = auxiliaryReadPermissionDenied
    ? t(($) => $['newKnowledge.documentsPermissionDescription'])
    : t(($) => $['newKnowledge.documentsErrorDescription'])
  const documentsSectionRef = useRef<HTMLElement>(null)
  const documentsTitleRef = useRef<HTMLHeadingElement>(null)
  const documentSurfaceHadFocusRef = useRef(false)
  const bulkActionsHadFocusRef = useRef(false)
  const mainRetryFocusRequestedRef = useRef(false)
  const permissionRetryButtonRef = useRef<HTMLButtonElement>(null)
  const documentsRetryButtonRef = useRef<HTMLButtonElement>(null)
  const dependencyRetryButtonRef = useRef<HTMLButtonElement>(null)
  const {
    fetchNextPage: fetchNextDocumentPage,
    hasNextPage: hasNextDocumentPage,
    isFetchNextPageError: isFetchNextDocumentPageError,
    isFetchingNextPage: isFetchingNextDocumentPage,
  } = documentsQuery
  const {
    fetchNextPage: fetchNextTaskPage,
    hasNextPage: hasNextTaskPage,
    isFetchNextPageError: isFetchNextTaskPageError,
    isFetchingNextPage: isFetchingNextTaskPage,
    refetch: refetchTasksQuery,
  } = tasksQuery
  const {
    fetchNextPage: fetchNextSourcePage,
    hasNextPage: hasNextSourcePage,
    isFetchNextPageError: isFetchNextSourcePageError,
    isFetchingNextPage: isFetchingNextSourcePage,
    refetch: refetchSourcesQuery,
  } = sourcesQuery
  const canAutoFetchDocumentPage = Boolean(
    hasNextDocumentPage && (documentsQuery.data?.pages.length ?? 0) < MAX_AUTO_CURSOR_PAGES,
  )
  const canAutoFetchTaskPage = Boolean(
    hasNextTaskPage && (tasksQuery.data?.pages.length ?? 0) < MAX_AUTO_CURSOR_PAGES,
  )
  const documents = useMemo(
    () =>
      documentsQuery.data?.pages.flatMap((page) => logicalDocumentListFromApi(page).items) ?? [],
    [documentsQuery.data],
  )
  const baseTasks = useMemo(
    () => tasksQuery.data?.pages.flatMap((page) => documentTaskListFromApi(page).items) ?? [],
    [tasksQuery.data],
  )
  const backgroundTasks = useMemo(
    () => tasksQuery.data?.pages.flatMap((page) => backgroundTaskListFromApi(page).items) ?? [],
    [tasksQuery.data],
  )
  const documentIds = useMemo(() => new Set(documents.map((document) => document.id)), [documents])
  const unresolvedTaskDocumentIds = useMemo(
    () =>
      new Set(
        baseTasks.flatMap((task) => (!documentIds.has(task.documentId) ? [task.documentId] : [])),
      ),
    [baseTasks, documentIds],
  )
  const taskDataUpdateCount = useQueryDataUpdateCount(queryClient, tasksQueryOptions.queryKey)
  const taskListSnapshotRef = useRef({
    data: tasksQuery.data,
    dataUpdateCount: taskDataUpdateCount,
    dataUpdatedAt: tasksQuery.dataUpdatedAt,
  })
  const taskListGenerationRef = useRef(0)
  const [taskListGeneration, setTaskListGeneration] = useState(0)
  useLayoutEffect(() => {
    if (
      taskListSnapshotRef.current.dataUpdateCount === taskDataUpdateCount &&
      taskListSnapshotRef.current.dataUpdatedAt === tasksQuery.dataUpdatedAt &&
      taskListSnapshotRef.current.data === tasksQuery.data
    )
      return
    taskListSnapshotRef.current = {
      data: tasksQuery.data,
      dataUpdateCount: taskDataUpdateCount,
      dataUpdatedAt: tasksQuery.dataUpdatedAt,
    }
    taskListGenerationRef.current += 1
    setTaskListGeneration(taskListGenerationRef.current)
  }, [taskDataUpdateCount, tasksQuery.data, tasksQuery.dataUpdatedAt])
  const baseTaskById = useMemo(() => new Map(baseTasks.map((task) => [task.id, task])), [baseTasks])
  const sources = useMemo(
    () => sourcesQuery.data?.pages.flatMap((page) => page.data.map(sourceFromApi)) ?? [],
    [sourcesQuery.data],
  )
  const sourceNames = useMemo(
    () => new Map(sources.map((source) => [source.id, source.name])),
    [sources],
  )
  const unresolvedDocumentSourceIds = useMemo(
    () =>
      new Set(
        documents.flatMap((document) =>
          document.sourceId && !sourceNames.has(document.sourceId) ? [document.sourceId] : [],
        ),
      ),
    [documents, sourceNames],
  )
  const hasRelevantNextSourcePage = Boolean(hasNextSourcePage && unresolvedDocumentSourceIds.size)
  const isFetchingNextResultsPage = Boolean(
    isFetchingNextDocumentPage ||
    (hasNextTaskPage && isFetchingNextTaskPage) ||
    (hasRelevantNextSourcePage && isFetchingNextSourcePage),
  )
  const canAutoFetchSourcePage = Boolean(
    hasRelevantNextSourcePage && (sourcesQuery.data?.pages.length ?? 0) < MAX_AUTO_CURSOR_PAGES,
  )
  const baseTaskByIdRef = useRef(baseTaskById)
  useLayoutEffect(() => {
    baseTaskByIdRef.current = baseTaskById
  }, [baseTaskById])
  const tasks = useMemo(
    () =>
      baseTasks.map((task) => {
        const override = taskOverrides[task.id]
        const terminalTaskPin = terminalTaskPins[task.id]
        if (
          terminalTaskPin &&
          override &&
          taskIsActive(task) &&
          !taskVersionIsAfter(task.updatedAt, terminalTaskPin.observedAt)
        )
          return mergeTaskOverride(task, override)
        if (!override?.updatedAt) return override ? mergeTaskOverride(task, override) : task
        if (taskVersionIsAfter(task.updatedAt, override.updatedAt)) return task
        const mergedTask = mergeTaskOverride(task, override)
        if (
          !taskIsActive(task) &&
          taskIsActive(mergedTask) &&
          !taskVersionIsAfter(override.updatedAt, task.updatedAt) &&
          streamActiveOverrideVersionsRef.current.get(task.id) === override.updatedAt
        )
          return task
        return mergedTask
      }),
    [baseTasks, taskOverrides, terminalTaskPins],
  )
  const effectiveTaskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const drawerTasks = useMemo(
    () => backgroundTasks.map((task) => effectiveTaskById.get(task.id) ?? task),
    [backgroundTasks, effectiveTaskById],
  )
  useEffect(() => {
    for (const task of tasks) {
      if (!taskIsActive(task)) {
        taskEventCursorsRef.current.delete(task.id)
        streamActiveOverrideVersionsRef.current.delete(task.id)
        trustedActiveOverrideVersionsRef.current.delete(task.id)
        trustedOverrideListGenerationsRef.current.delete(task.id)
      }
    }
  }, [tasks])

  useEffect(() => {
    const clearedActiveTaskIds: string[] = []
    for (const task of baseTasks) {
      const denial = terminalConfirmableAuxiliaryDenialsRef.current.get(task.id)
      if (!denial || taskListGeneration <= denial.taskListGeneration) continue
      if (taskIsActive(task)) {
        if (!taskVersionIsAfter(task.updatedAt, denial.taskVersion)) continue
        auxiliaryTaskReadGuard.clearTask(task.id)
        terminalConfirmableAuxiliaryDenialsRef.current.delete(task.id)
        continue
      }
      if (!auxiliaryTaskReadGuard.clearThrough(task.id, task.updatedAt)) continue
      terminalConfirmableAuxiliaryDenialsRef.current.delete(task.id)
      const effectiveTask = effectiveTaskById.get(task.id)
      if (effectiveTask && taskIsActive(effectiveTask)) clearedActiveTaskIds.push(task.id)
    }
    if (!clearedActiveTaskIds.length) return
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Clearing a committed terminal guard must remount effective active observers.
    setTaskObserverGenerations((current) => {
      const next = { ...current }
      for (const taskId of clearedActiveTaskIds) next[taskId] = (next[taskId] ?? 0) + 1
      return next
    })
  }, [auxiliaryTaskReadGuard, baseTasks, effectiveTaskById, taskListGeneration])
  const currentTaskStateRef = useRef(new Map(tasks.map((task) => [task.id, task.state])))
  const currentTaskVersionRef = useRef(new Map(tasks.map((task) => [task.id, task.updatedAt])))
  useLayoutEffect(() => {
    const currentTaskIds = new Set(tasks.map((task) => task.id))
    for (const task of tasks) {
      const currentVersion = currentTaskVersionRef.current.get(task.id)
      if (!currentVersion || !taskVersionIsAfter(currentVersion, task.updatedAt)) {
        currentTaskStateRef.current.set(task.id, task.state)
        currentTaskVersionRef.current.set(task.id, task.updatedAt)
      }
    }
    for (const taskId of currentTaskVersionRef.current.keys()) {
      if (currentTaskIds.has(taskId)) continue
      currentTaskStateRef.current.delete(taskId)
      currentTaskVersionRef.current.delete(taskId)
    }
  }, [tasks])

  const taskByDocument = useMemo(() => newestTaskByDocument(tasks), [tasks])
  const retryableDocumentIds = useMemo(
    () =>
      new Set(
        [...taskByDocument].flatMap(([documentId, task]) =>
          taskCanRetry(task) ? [documentId] : [],
        ),
      ),
    [taskByDocument],
  )
  const documentStatuses = useMemo(
    () =>
      new Map(
        documents.map((document) => [
          document.id,
          documentDisplayStatus(document, taskByDocument.get(document.id)),
        ]),
      ),
    [documents, taskByDocument],
  )
  const documentFailureReasons = useMemo(
    () =>
      new Map(
        documents.flatMap((document) => {
          if (documentStatuses.get(document.id) !== 'failed') return []
          const task = taskByDocument.get(document.id)
          const messageKey =
            knowledgeFsTaskFailureMessageKey(
              task?.failure,
              task?.errorCode ?? (task?.errorMessage ? 'LEGACY_TASK_FAILURE' : undefined),
            ) ?? 'newKnowledge.taskFailure.internal'
          return [[document.id, t(($) => $[messageKey])] as const]
        }),
      ),
    [documentStatuses, documents, t, taskByDocument],
  )
  const filterActive = filter !== 'all' || Boolean(search.trim())
  const statusFilterActive = filter !== 'all'
  const availableDocumentIds = useMemo(
    () =>
      new Set(
        documents
          .filter((document) => document.status !== 'deleting')
          .map((document) => document.id),
      ),
    [documents],
  )
  const validSelectedDocumentIds = useMemo(
    () =>
      new Set(
        [...selectedDocumentIds].filter((documentId) => availableDocumentIds.has(documentId)),
      ),
    [availableDocumentIds, selectedDocumentIds],
  )
  const selectedDocuments = useMemo(
    () => documents.filter((document) => validSelectedDocumentIds.has(document.id)),
    [documents, validSelectedDocumentIds],
  )
  const selectedDocumentStatuses = useMemo(
    () =>
      selectedDocuments.map((document) => documentStatuses.get(document.id) ?? ('queued' as const)),
    [documentStatuses, selectedDocuments],
  )
  const availabilityTargetEnabled =
    selectedDocuments.length > 0 && selectedDocuments.every((document) => !document.enabled)
  const bulkSelectionInvalid =
    selectedDocuments.length !== validSelectedDocumentIds.size ||
    selectedDocuments.length > KNOWLEDGE_FS_BATCH_DOCUMENT_MAX_DOCUMENTS
  const availabilityDisabled =
    bulkSelectionInvalid ||
    selectedDocumentStatuses.some((status) => !documentCanToggleAvailability(status))
  const bulkAvailabilityActionVisible = selectedDocumentStatuses.every(
    documentShowsAvailabilityAction,
  )
  const bulkReindexDisabled = selectedDocumentStatuses.some((status) => !documentCanReindex(status))
  const downloadableSelectedDocumentIds = useMemo(() => {
    if (
      bulkSelectionInvalid ||
      selectedDocuments.some((document) => !document.active) ||
      selectedDocumentStatuses.some((status) => !documentCanDownload(status))
    )
      return []
    return selectedDocuments.map((document) => document.id)
  }, [bulkSelectionInvalid, selectedDocuments, selectedDocumentStatuses])
  const filteredDocuments = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase()
    return documents.filter((document) => {
      const status = documentStatuses.get(document.id)
      if (filter !== 'all' && status !== filter) return false
      if (!normalizedSearch) return true
      const resolvedSourceName =
        (document.sourceId && sourceNames.get(document.sourceId)) ?? sourceName(document)
      return `${document.title} ${resolvedSourceName ?? ''}`
        .toLocaleLowerCase()
        .includes(normalizedSearch)
    })
  }, [documentStatuses, documents, filter, search, sourceNames])
  const completingFilteredResults =
    filterActive &&
    !documentsQuery.isFetchNextPageError &&
    (canAutoFetchDocumentPage || documentsQuery.isFetchingNextPage)
  const filteredResultsIncomplete = Boolean(
    (filterActive &&
      (hasNextDocumentPage ||
        documentsQuery.isFetchingNextPage ||
        documentsQuery.isFetchNextPageError)) ||
    (statusFilterActive &&
      (hasNextTaskPage || tasksQuery.isFetchingNextPage || tasksQuery.isFetchNextPageError)) ||
    (filterActive &&
      unresolvedDocumentSourceIds.size > 0 &&
      (hasNextSourcePage || sourcesQuery.isFetchingNextPage || sourcesQuery.isFetchNextPageError)),
  )
  const taskQueryBlockingError = Boolean(
    !tasksQuery.data && (tasksQuery.error || blockingDependencyRetries.tasks),
  )
  const sourceQueryBlockingError = Boolean(
    !sourcesQuery.data && (sourcesQuery.error || blockingDependencyRetries.sources),
  )
  const dependencyQueryBlockingError = taskQueryBlockingError || sourceQueryBlockingError
  const dependencyQueryWarning = Boolean(
    (tasksQuery.error && tasksQuery.data) ||
    tasksQuery.isFetchNextPageError ||
    (sourcesQuery.error && sourcesQuery.data) ||
    sourcesQuery.isFetchNextPageError,
  )
  const taskResultsIncomplete = Boolean(
    !tasksQuery.data || tasksQuery.isPending || tasksQuery.isFetchingNextPage,
  )
  const sourceResultsIncomplete = Boolean(
    !sourcesQuery.data ||
    sourcesQuery.isPending ||
    (unresolvedDocumentSourceIds.size &&
      (hasNextSourcePage ||
        sourcesQuery.error ||
        sourcesQuery.isFetchingNextPage ||
        sourcesQuery.isFetchNextPageError)),
  )
  const sourceQueryWarning = Boolean(
    (sourcesQuery.error && sourcesQuery.data) || sourcesQuery.isFetchNextPageError,
  )
  const taskQueryWarning = Boolean(
    (tasksQuery.error && tasksQuery.data) || tasksQuery.isFetchNextPageError,
  )
  const documentQueryWarning = Boolean(documentsQuery.error && documentsQuery.data)
  const dependencyRetryFetching = Boolean(
    (taskQueryWarning && tasksQuery.isFetching) || (sourceQueryWarning && sourcesQuery.isFetching),
  )
  const blockingDependencyRetryFetching = Boolean(
    (taskQueryBlockingError && tasksQuery.isFetching) ||
    (sourceQueryBlockingError && sourcesQuery.isFetching),
  )
  const mainRecoveryVisible = Boolean(
    permissionQueryError ||
    documentsQuery.error ||
    dependencyQueryBlockingError ||
    dependencyQueryWarning,
  )
  const mainRecoveryIdentity = [
    permissionQueryError ? 'permission' : '',
    documentsQuery.error ? 'documents' : '',
    taskQueryBlockingError ? 'tasks-blocking' : '',
    sourceQueryBlockingError ? 'sources-blocking' : '',
    taskQueryWarning ? 'tasks-warning' : '',
    sourceQueryWarning ? 'sources-warning' : '',
  ].join(':')
  const dependencyResultsIncomplete = taskResultsIncomplete || sourceResultsIncomplete
  const selectionDisabled =
    !canWrite ||
    dependencyResultsIncomplete ||
    documentQueryWarning ||
    taskQueryWarning ||
    (sourceQueryWarning && unresolvedDocumentSourceIds.size > 0) ||
    filteredResultsIncomplete
  const reindexUnavailableReason =
    tasksQuery.error || tasksQuery.isFetchNextPageError
      ? t(($) => $['newKnowledge.tasksErrorDescription'])
      : (sourcesQuery.error || sourcesQuery.isFetchNextPageError) &&
          unresolvedDocumentSourceIds.size > 0
        ? t(($) => $['newKnowledge.sourcesErrorDescription'])
        : documentsQuery.error || documentsQuery.isFetchNextPageError
          ? t(($) => $['newKnowledge.documentsErrorDescription'])
          : dependencyResultsIncomplete
            ? tCommon(($) => $.loading)
            : filteredResultsIncomplete
              ? t(($) => $['newKnowledge.partialDocumentResults'])
              : undefined
  const selectableFilteredDocuments = filteredDocuments.filter(
    (document) => document.status !== 'deleting',
  )
  const attentionTasks = drawerTasks.filter(taskNeedsAttention)
  const hasTaskError = attentionTasks.some(
    (task) => task.state === 'failed' || task.state === 'canceled',
  )
  const activeTasks = useMemo(() => tasks.filter(taskIsActive), [tasks])
  const orderedActiveTasks = useMemo(
    () =>
      [...activeTasks].sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      ),
    [activeTasks],
  )
  const taskObserverVersion = (task: DocumentProcessingTask) => {
    let latestVersion = task.updatedAt
    for (const candidate of [
      currentTaskVersionRef.current.get(task.id),
      taskProgressStore.get(task.id)?.updatedAt,
    ]) {
      if (candidate && taskVersionIsAfter(candidate, latestVersion)) latestVersion = candidate
    }
    return latestVersion
  }
  const streamedActiveTasks = (() => {
    if (permissionDenied) return []
    const streamableActiveTasks = orderedActiveTasks.filter(
      (task) => !auxiliaryTaskReadGuard.isBlocked(task.id, taskObserverVersion(task)),
    )
    const streamCount = Math.min(MAX_TASK_EVENT_STREAMS, streamableActiveTasks.length)
    if (!streamCount) return []
    const offset = taskStreamOffset % streamableActiveTasks.length
    return Array.from(
      { length: streamCount },
      (_, index) => streamableActiveTasks[(offset + index) % streamableActiveTasks.length]!,
    )
  })()
  const blockedActiveTaskSignature = orderedActiveTasks
    .map((task) => [task.id, taskObserverVersion(task)] as const)
    .filter(([taskId, taskVersion]) => auxiliaryTaskReadGuard.isBlocked(taskId, taskVersion))
    .map(([taskId, taskVersion]) => `${taskId}:${taskVersion}`)
    .join('|')
  const orderedFailedTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.state === 'failed')
        .sort((left, right) => {
          if (taskVersionIsAfter(left.updatedAt, right.updatedAt)) return -1
          if (taskVersionIsAfter(right.updatedAt, left.updatedAt)) return 1
          return right.id.localeCompare(left.id)
        }),
    [tasks],
  )
  const orderedFailedTasksRef = useRef(orderedFailedTasks)
  useLayoutEffect(() => {
    orderedFailedTasksRef.current = orderedFailedTasks
  }, [orderedFailedTasks])
  const failedTaskPollSignature = orderedFailedTasks
    .map((task) => `${task.id}:${task.updatedAt}`)
    .join('|')
  const incompleteTaskHistoryHint = hasNextTaskPage
    ? ` · ${t(($) => $['newKnowledge.taskHistoryIncomplete'])}`
    : ''
  const attentionTaskBadge =
    attentionTasks.length || hasNextTaskPage
      ? `${attentionTasks.length}${hasNextTaskPage ? '+' : ''}`
      : undefined
  const tasksButtonLabel = `${
    attentionTasks.length || hasNextTaskPage
      ? t(($) => $['newKnowledge.tasksWithAttention'], { count: attentionTasks.length })
      : t(($) => $['newKnowledge.tasks'])
  }${incompleteTaskHistoryHint}`
  const tasksLiveStatus = `${
    hasTaskError
      ? t(($) => $['newKnowledge.taskAttentionErrorCount'], { count: attentionTasks.length })
      : attentionTasks.length || hasNextTaskPage
        ? t(($) => $['newKnowledge.taskAttentionCount'], { count: attentionTasks.length })
        : t(($) => $['newKnowledge.taskAttentionClear'])
  }${incompleteTaskHistoryHint}`
  const allFilteredSelected =
    selectableFilteredDocuments.length > 0 &&
    selectableFilteredDocuments.every((document) => validSelectedDocumentIds.has(document.id))
  const someFilteredSelected = selectableFilteredDocuments.some((document) =>
    validSelectedDocumentIds.has(document.id),
  )
  const bulkActionsVisible = canWrite && validSelectedDocumentIds.size > 0
  const previousBulkActionsVisibleRef = useRef(bulkActionsVisible)

  useLayoutEffect(() => {
    const wasVisible = previousBulkActionsVisibleRef.current
    previousBulkActionsVisibleRef.current = bulkActionsVisible
    if (!wasVisible || bulkActionsVisible || !bulkActionsHadFocusRef.current) return
    if (permissionDenied) return
    bulkActionsHadFocusRef.current = false
    documentsTitleRef.current?.focus()
  }, [bulkActionsVisible, permissionDenied])

  useEffect(() => {
    if (permissionDenied || orderedActiveTasks.length <= MAX_TASK_EVENT_STREAMS) return
    const interval = window.setInterval(
      () => setTaskStreamOffset((current) => current + MAX_TASK_EVENT_STREAMS),
      5000,
    )
    return () => window.clearInterval(interval)
  }, [orderedActiveTasks.length, permissionDenied])

  useEffect(() => {
    if (permissionDenied || !blockedActiveTaskSignature) return
    let canceled = false
    let refreshInterval = BLOCKED_ACTIVE_TASK_REFRESH_INTERVAL
    let timeout: number | undefined
    const refreshBlockedTasks = async () => {
      if (canceled) return
      await refetchTasksQuery({ cancelRefetch: false }).catch(() => undefined)
      if (canceled) return
      refreshInterval = Math.min(refreshInterval * 2, MAX_BLOCKED_ACTIVE_TASK_REFRESH_INTERVAL)
      timeout = window.setTimeout(refreshBlockedTasks, refreshInterval)
    }
    timeout = window.setTimeout(refreshBlockedTasks, BLOCKED_ACTIVE_TASK_REFRESH_INTERVAL)
    return () => {
      canceled = true
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
  }, [blockedActiveTaskSignature, permissionDenied, refetchTasksQuery])

  useLayoutEffect(() => {
    if (!writePermissionRevoked || !writePermissionFocusRecoveryRequestedRef.current) return
    writePermissionFocusRecoveryRequestedRef.current = false
    writePermissionFocusOriginRef.current = null
    documentsTitleRef.current?.focus()
  }, [writePermissionRevoked])

  useEffect(() => {
    const previousPermissionDenialMask = previousPermissionDenialMaskRef.current
    previousPermissionDenialMaskRef.current = permissionDenialMask
    const addedPermissionDenials = permissionDenialMask & ~previousPermissionDenialMask
    let recoveryQueryMask =
      permissionRecoveryQueryMaskRef.current |
      recoveryQueryMaskForPermissionDenials(addedPermissionDenials)
    if (
      previousPermissionDenialMask & TASK_PERMISSION_DENIED &&
      !(permissionDenialMask & TASK_PERMISSION_DENIED)
    )
      recoveryQueryMask &= ~TASK_PERMISSION_DENIED
    if (
      previousPermissionDenialMask & SOURCE_PERMISSION_DENIED &&
      !(permissionDenialMask & SOURCE_PERMISSION_DENIED)
    )
      recoveryQueryMask &= ~SOURCE_PERMISSION_DENIED
    recoveryQueryMask &= ~permissionDenialMask
    permissionRecoveryQueryMaskRef.current = recoveryQueryMask
    if (previousPermissionDenialMask && !permissionDenied) {
      blockedFailedTaskPollVersionsRef.current.clear()
      if (recoveryQueryMask & TASK_PERMISSION_DENIED)
        void refetchTasksQuery({ cancelRefetch: false })
      if (recoveryQueryMask & SOURCE_PERMISSION_DENIED)
        void refetchSourcesQuery({ cancelRefetch: false })
      permissionRecoveryQueryMaskRef.current = 0
      if (documentSurfaceHadFocusRef.current || bulkActionsHadFocusRef.current)
        documentsTitleRef.current?.focus()
      bulkActionsHadFocusRef.current = false
      return
    }
    if (previousPermissionDenialMask || !permissionDenied) return
    const shouldRestoreFocus =
      tasksOpen || documentSurfaceHadFocusRef.current || bulkActionsHadFocusRef.current
    if (tasksOpen) {
      // oxlint-disable-next-line eslint-react/set-state-in-effect -- Permission revocation permanently closes the controlled task drawer.
      setTasksOpen(false)
    }
    if (shouldRestoreFocus) documentPermissionAlertRef.current?.focus()
    bulkActionsHadFocusRef.current = false
  }, [permissionDenialMask, permissionDenied, refetchSourcesQuery, refetchTasksQuery, tasksOpen])

  useEffect(() => {
    if (
      !writePermissionRevoked ||
      writePermissionRecoveryGeneration !== writePermissionDenialGenerationRef.current
    ) {
      writePermissionRecoveryFetchSeenRef.current = false
      return
    }
    if (workspacePermissionKeysFetching) {
      writePermissionRecoveryFetchSeenRef.current = true
      return
    }
    if (
      !writePermissionRecoveryFetchSeenRef.current ||
      permissionPending ||
      permissionQueryError ||
      !canEdit
    )
      return
    writePermissionRecoveryFetchSeenRef.current = false
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- A post-denial permission request is the authoritative event that retires the local mutation lock.
    setWritePermissionRevoked(false)
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- The completed recovery generation is retired with its write lock.
    setWritePermissionRecoveryGeneration(undefined)
  }, [
    canEdit,
    permissionPending,
    permissionQueryError,
    workspacePermissionKeysFetching,
    writePermissionRecoveryGeneration,
    writePermissionRevoked,
  ])

  useEffect(() => {
    if (!mainRetryFocusRequestedRef.current) return
    if (mainRecoveryVisible) {
      if (documentPermissionDenied) {
        mainRetryFocusRequestedRef.current = false
        documentPermissionAlertRef.current?.focus()
      } else if (permissionQueryError) permissionRetryButtonRef.current?.focus()
      else if (documentsQuery.error && !permissionDenied) documentsRetryButtonRef.current?.focus()
      else dependencyRetryButtonRef.current?.focus()
      return
    }
    mainRetryFocusRequestedRef.current = false
    documentsTitleRef.current?.focus()
  }, [
    documentsQuery.error,
    documentPermissionDenied,
    mainRecoveryIdentity,
    mainRecoveryVisible,
    permissionDenied,
    permissionQueryError,
  ])

  useEffect(() => {
    if (!blockingDependencyRetries.tasks && !blockingDependencyRetries.sources) return
    if (
      (!blockingDependencyRetries.tasks || !tasksQuery.data) &&
      (!blockingDependencyRetries.sources || !sourcesQuery.data)
    )
      return
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Successful first-page retries retire the locally stabilized blocking state.
    setBlockingDependencyRetries((current) => ({
      sources: current.sources && !sourcesQuery.data,
      tasks: current.tasks && !tasksQuery.data,
    }))
  }, [blockingDependencyRetries, sourcesQuery.data, tasksQuery.data])

  useEffect(() => {
    if (
      !permissionDenied &&
      (filterActive || (tasksOpen && unresolvedTaskDocumentIds.size > 0)) &&
      canAutoFetchDocumentPage &&
      !isFetchingNextDocumentPage &&
      !isFetchNextDocumentPageError
    )
      void fetchNextDocumentPage()
  }, [
    fetchNextDocumentPage,
    filterActive,
    tasksOpen,
    unresolvedTaskDocumentIds,
    canAutoFetchDocumentPage,
    isFetchNextDocumentPageError,
    isFetchingNextDocumentPage,
    permissionDenied,
  ])

  useEffect(() => {
    if (
      !permissionDenied &&
      canAutoFetchTaskPage &&
      !isFetchingNextTaskPage &&
      !isFetchNextTaskPageError
    )
      void fetchNextTaskPage()
  }, [
    canAutoFetchTaskPage,
    fetchNextTaskPage,
    isFetchNextTaskPageError,
    isFetchingNextTaskPage,
    permissionDenied,
  ])

  useEffect(() => {
    if (
      !permissionDenied &&
      canAutoFetchSourcePage &&
      !isFetchingNextSourcePage &&
      !isFetchNextSourcePageError
    )
      void fetchNextSourcePage()
  }, [
    canAutoFetchSourcePage,
    fetchNextSourcePage,
    isFetchNextSourcePageError,
    isFetchingNextSourcePage,
    permissionDenied,
  ])

  const refreshDocuments = useCallback(() => {
    void queryClient.invalidateQueries({
      predicate: (query) => queryKeyMatchesKnowledgeSpace(query.queryKey, knowledgeSpaceId),
      queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get.key(),
    })
  }, [knowledgeSpaceId, queryClient])

  useEffect(() => {
    const previousStates =
      listedBackgroundTaskStatesRef.current.knowledgeSpaceId === knowledgeSpaceId
        ? listedBackgroundTaskStatesRef.current.states
        : new Map<string, string>()
    const states = new Map<string, string>()
    let documentTaskReachedTerminal = false

    for (const page of tasksQuery.data?.pages ?? []) {
      for (const task of page.data) {
        states.set(task.id, task.state)
        const previousState = previousStates.get(task.id)
        if (
          (previousState === 'queued' || previousState === 'running') &&
          task.state !== 'queued' &&
          task.state !== 'running' &&
          (task.task_kind === 'document' || task.task_kind === 'document_bulk')
        )
          documentTaskReachedTerminal = true
      }
    }

    listedBackgroundTaskStatesRef.current = { knowledgeSpaceId, states }
    if (documentTaskReachedTerminal) refreshDocuments()
  }, [knowledgeSpaceId, refreshDocuments, tasksQuery.data])

  const refreshDocumentsAndTasks = useCallback(() => {
    void Promise.allSettled([
      queryClient.invalidateQueries({
        predicate: (query) => queryKeyMatchesKnowledgeSpace(query.queryKey, knowledgeSpaceId),
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get.key(),
      }),
      queryClient.invalidateQueries({
        predicate: (query) => queryKeyMatchesKnowledgeSpace(query.queryKey, knowledgeSpaceId),
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get.key(),
      }),
    ])
  }, [knowledgeSpaceId, queryClient])

  const refreshWorkspacePermissions = useCallback(
    async (releaseWriteLockOnSuccess: boolean) => {
      const denialGeneration = writePermissionDenialGenerationRef.current
      const result = await (releaseWriteLockOnSuccess && writePermissionRevoked
        ? refreshWorkspacePermissionKeysAfterMutationDenial()
        : retryWorkspacePermissionKeys())
      const refreshedPermissionKeys = result.data?.dataset?.default_permission_keys
      if (
        releaseWriteLockOnSuccess &&
        writePermissionDenialGenerationRef.current === denialGeneration &&
        !result.error &&
        refreshedPermissionKeys &&
        hasPermission(refreshedPermissionKeys, DatasetACLPermission.Edit)
      ) {
        writePermissionRecoveryFetchSeenRef.current = false
        setWritePermissionRevoked(false)
        setWritePermissionRecoveryGeneration(undefined)
      }
    },
    [
      refreshWorkspacePermissionKeysAfterMutationDenial,
      retryWorkspacePermissionKeys,
      writePermissionRevoked,
    ],
  )

  const handleWritePermissionDenied = useCallback(() => {
    const denialGeneration = writePermissionDenialGenerationRef.current + 1
    writePermissionDenialGenerationRef.current = denialGeneration
    writePermissionRecoveryFetchSeenRef.current = false
    setWritePermissionRecoveryGeneration(undefined)
    setWritePermissionRevoked(true)
    void refreshWorkspacePermissionKeysAfterMutationDenial().then((result) => {
      const refreshedPermissionKeys = result.data?.dataset?.default_permission_keys
      if (writePermissionDenialGenerationRef.current !== denialGeneration) return
      if (
        !result.error &&
        refreshedPermissionKeys &&
        hasPermission(refreshedPermissionKeys, DatasetACLPermission.Edit)
      ) {
        writePermissionRecoveryFetchSeenRef.current = false
        setWritePermissionRevoked(false)
        setWritePermissionRecoveryGeneration(undefined)
        return
      }
      setWritePermissionRecoveryGeneration(denialGeneration)
    })
  }, [refreshWorkspacePermissionKeysAfterMutationDenial])

  const reconcileTerminalTask = useCallback(
    async function reconcileTerminalTaskRequest(
      taskId: string,
      terminalVersion: string,
      reconciliationGeneration: number,
      retryAttempt = 0,
    ) {
      const currentTask = baseTaskByIdRef.current.get(taskId)
      if (!currentTask || auxiliaryTaskReadGuard.isBlocked(taskId, terminalVersion)) return
      const pendingRetryTimeout = terminalReconciliationTimeoutsRef.current.get(taskId)
      if (pendingRetryTimeout !== undefined) window.clearTimeout(pendingRetryTimeout)
      terminalReconciliationTimeoutsRef.current.delete(taskId)
      terminalReconciliationControllersRef.current.get(taskId)?.abort()
      const controller = new AbortController()
      terminalReconciliationControllersRef.current.set(taskId, controller)
      const requestTimeout = window.setTimeout(
        () => controller.abort(),
        TERMINAL_RECONCILIATION_REQUEST_TIMEOUT,
      )
      try {
        const snapshot = await findBackgroundTask(knowledgeSpaceId, taskId, controller.signal)
        if (!snapshot) return
        if (
          terminalReconciliationControllersRef.current.get(taskId) !== controller ||
          terminalReconciliationGenerationsRef.current.get(taskId) !== reconciliationGeneration
        )
          return
        terminalReconciliationControllersRef.current.delete(taskId)
        const currentTaskVersion = currentTaskVersionRef.current.get(taskId)
        if (currentTaskVersion && taskVersionIsAfter(currentTaskVersion, snapshot.updatedAt)) return
        if (taskVersionIsAfter(terminalVersion, snapshot.updatedAt)) return
        auxiliaryTaskReadGuard.clearTask(taskId)
        failedPollAuxiliaryDenialsRef.current.delete(taskId)
        terminalConfirmableAuxiliaryDenialsRef.current.delete(taskId)
        const normalizedSnapshot = normalizedTaskSnapshot(snapshot)
        if (taskIsActive(snapshot))
          trustedActiveOverrideVersionsRef.current.set(taskId, {
            taskListGeneration: taskListGenerationRef.current,
            updatedAt: snapshot.updatedAt,
          })
        else trustedActiveOverrideVersionsRef.current.delete(taskId)
        taskProgressStore.delete(taskId)
        currentTaskStateRef.current.set(taskId, snapshot.state)
        currentTaskVersionRef.current.set(taskId, snapshot.updatedAt)
        setTaskOverrides((current) => {
          const currentVersion = current[taskId]?.updatedAt
          if (currentVersion && taskVersionIsAfter(currentVersion, snapshot.updatedAt))
            return current
          return { ...current, [taskId]: normalizedSnapshot }
        })
        if (taskIsActive(snapshot)) {
          blockedFailedTaskPollVersionsRef.current.delete(taskId)
          taskEventCursorsRef.current.delete(taskId)
          const pollGeneration = failedTaskPollGenerationsRef.current.get(taskId) ?? 0
          failedTaskPollGenerationsRef.current.set(taskId, pollGeneration + 1)
          setTerminalTaskPins((current) => {
            const pin = current[taskId]
            if (!pin || taskVersionIsAfter(pin.observedAt, snapshot.updatedAt)) return current
            const next = { ...current }
            delete next[taskId]
            return next
          })
          setTaskObserverGenerations((current) => ({
            ...current,
            [taskId]: (current[taskId] ?? 0) + 1,
          }))
        }
      } catch (error) {
        if (terminalReconciliationControllersRef.current.get(taskId) !== controller) return
        terminalReconciliationControllersRef.current.delete(taskId)
        if (responseStatus(error) === 403) {
          const currentTaskVersion = currentTaskVersionRef.current.get(taskId)
          const deniedVersion =
            currentTaskVersion && taskVersionIsAfter(currentTaskVersion, terminalVersion)
              ? currentTaskVersion
              : terminalVersion
          terminalConfirmableAuxiliaryDenialsRef.current.set(taskId, {
            taskListGeneration: taskListGenerationRef.current,
            taskVersion: deniedVersion,
          })
          denyAuxiliaryTaskRead(taskId, deniedVersion)
          return
        }
        if (
          retryAttempt >= 4 ||
          !taskSnapshotErrorIsTransient(error) ||
          terminalReconciliationGenerationsRef.current.get(taskId) !== reconciliationGeneration
        )
          return
        const timeout = window.setTimeout(
          () => {
            terminalReconciliationTimeoutsRef.current.delete(taskId)
            if (
              terminalReconciliationGenerationsRef.current.get(taskId) === reconciliationGeneration
            )
              void reconcileTerminalTaskRequest(
                taskId,
                terminalVersion,
                reconciliationGeneration,
                retryAttempt + 1,
              )
          },
          Math.min(1000 * 2 ** retryAttempt, 30000),
        )
        terminalReconciliationTimeoutsRef.current.set(taskId, timeout)
      } finally {
        window.clearTimeout(requestTimeout)
      }
    },
    [auxiliaryTaskReadGuard, denyAuxiliaryTaskRead, knowledgeSpaceId, taskProgressStore],
  )

  useEffect(() => {
    if (permissionDenied) return
    for (const task of baseTasks) {
      if (taskIsActive(task)) continue
      const override = taskOverrides[task.id]
      const trustedOverride = trustedActiveOverrideVersionsRef.current.get(task.id)
      if (
        !override?.updatedAt ||
        !taskIsActive(mergeTaskOverride(task, override)) ||
        taskVersionIsAfter(override.updatedAt, task.updatedAt) ||
        trustedOverride?.updatedAt !== override.updatedAt ||
        taskListGeneration <= trustedOverride.taskListGeneration ||
        trustedOverrideListGenerationsRef.current.get(task.id) === taskListGeneration
      )
        continue
      trustedOverrideListGenerationsRef.current.set(task.id, taskListGeneration)
      const reconciliationGeneration =
        (terminalReconciliationGenerationsRef.current.get(task.id) ?? 0) + 1
      terminalReconciliationGenerationsRef.current.set(task.id, reconciliationGeneration)
      void reconcileTerminalTask(task.id, task.updatedAt, reconciliationGeneration)
    }
  }, [baseTasks, permissionDenied, reconcileTerminalTask, taskListGeneration, taskOverrides])

  useEffect(
    () => () => {
      for (const controller of terminalReconciliationControllersRef.current.values())
        controller.abort()
      terminalReconciliationControllersRef.current.clear()
      for (const timeout of terminalReconciliationTimeoutsRef.current.values())
        window.clearTimeout(timeout)
      terminalReconciliationTimeoutsRef.current.clear()
    },
    [knowledgeSpaceId],
  )

  useEffect(() => {
    if (!permissionDenied) return
    void queryClient.cancelQueries({
      predicate: (query) => queryKeyMatchesKnowledgeSpace(query.queryKey, knowledgeSpaceId),
      queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get.key(),
    })
    void queryClient.cancelQueries({
      predicate: (query) => queryKeyMatchesKnowledgeSpace(query.queryKey, knowledgeSpaceId),
      queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.sources.get.key(),
    })
    for (const [taskId, controller] of terminalReconciliationControllersRef.current) {
      controller.abort()
      terminalReconciliationControllersRef.current.delete(taskId)
      const generation = terminalReconciliationGenerationsRef.current.get(taskId) ?? 0
      terminalReconciliationGenerationsRef.current.set(taskId, generation + 1)
    }
    for (const timeout of terminalReconciliationTimeoutsRef.current.values())
      window.clearTimeout(timeout)
    terminalReconciliationTimeoutsRef.current.clear()
    equalRetryListGenerationsRef.current.clear()
  }, [knowledgeSpaceId, permissionDenied, queryClient])

  useEffect(() => {
    const taskIds = new Set(baseTasks.map((task) => task.id))
    const pruneMap = (map: Map<string, unknown>) => {
      for (const taskId of map.keys()) {
        if (!taskIds.has(taskId)) map.delete(taskId)
      }
    }

    for (const [taskId, controller] of terminalReconciliationControllersRef.current) {
      if (taskIds.has(taskId)) continue
      controller.abort()
      terminalReconciliationControllersRef.current.delete(taskId)
    }
    for (const [taskId, timeout] of terminalReconciliationTimeoutsRef.current) {
      if (taskIds.has(taskId)) continue
      window.clearTimeout(timeout)
      terminalReconciliationTimeoutsRef.current.delete(taskId)
    }
    pruneMap(terminalReconciliationGenerationsRef.current)
    pruneMap(failedTaskPollGenerationsRef.current)
    pruneMap(blockedFailedTaskPollVersionsRef.current)
    pruneMap(failedPollAuxiliaryDenialsRef.current)
    pruneMap(terminalConfirmableAuxiliaryDenialsRef.current)
    auxiliaryTaskReadGuard.retain(taskIds)
    pruneMap(equalRetryListGenerationsRef.current)
    pruneMap(pendingTerminalProgressRef.current)
    pruneMap(taskEventCursorsRef.current)
    pruneMap(trustedOverrideListGenerationsRef.current)
    for (const map of [
      streamActiveOverrideVersionsRef.current,
      trustedActiveOverrideVersionsRef.current,
    ]) {
      for (const taskId of map.keys()) {
        if (!taskIds.has(taskId)) map.delete(taskId)
      }
    }
    taskProgressStore.retain(taskIds)

    const retainTaskState = <Value,>(current: Record<string, Value>) => {
      const staleTaskIds = Object.keys(current).filter((taskId) => !taskIds.has(taskId))
      if (!staleTaskIds.length) return current
      const next = { ...current }
      for (const taskId of staleTaskIds) delete next[taskId]
      return next
    }
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Prune state for tasks removed by a refreshed cursor result.
    setTaskOverrides(retainTaskState)
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Prune state for tasks removed by a refreshed cursor result.
    setTerminalTaskPins(retainTaskState)
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Prune state for tasks removed by a refreshed cursor result.
    setTaskObserverGenerations(retainTaskState)
  }, [auxiliaryTaskReadGuard, baseTasks, taskProgressStore])

  useEffect(() => {
    if (permissionDenied) return
    const strictRetries = new Map<string, DocumentProcessingTask>()
    const equalTimestampRetries = new Map<string, TerminalTaskPin>()
    const confirmedTerminals = new Map<string, DocumentProcessingTask>()
    for (const task of baseTasks) {
      const pin = terminalTaskPins[task.id]
      if (!pin || taskListGeneration <= pin.taskListGeneration) continue
      if (!taskIsActive(task)) {
        if (!taskVersionIsAfter(pin.observedAt, task.updatedAt))
          confirmedTerminals.set(task.id, task)
        continue
      }
      if (taskVersionIsAfter(task.updatedAt, pin.observedAt)) strictRetries.set(task.id, task)
      else if (!taskVersionIsAfter(pin.observedAt, task.updatedAt))
        equalTimestampRetries.set(task.id, pin)
    }

    for (const taskId of confirmedTerminals.keys()) {
      const generation = terminalReconciliationGenerationsRef.current.get(taskId) ?? 0
      terminalReconciliationGenerationsRef.current.set(taskId, generation + 1)
      terminalReconciliationControllersRef.current.get(taskId)?.abort()
      terminalReconciliationControllersRef.current.delete(taskId)
      const timeout = terminalReconciliationTimeoutsRef.current.get(taskId)
      if (timeout !== undefined) window.clearTimeout(timeout)
      terminalReconciliationTimeoutsRef.current.delete(taskId)
    }
    if (confirmedTerminals.size) {
      // oxlint-disable-next-line eslint-react/set-state-in-effect -- A current terminal list snapshot supersedes the partial SSE terminal payload.
      setTerminalTaskPins((current) => {
        const next = { ...current }
        for (const taskId of confirmedTerminals.keys()) delete next[taskId]
        return next
      })
      // oxlint-disable-next-line eslint-react/set-state-in-effect -- Restore complete server error details from the authoritative terminal list snapshot.
      setTaskOverrides((current) => {
        const next = { ...current }
        for (const [taskId, task] of confirmedTerminals) {
          const overrideVersion = current[taskId]?.updatedAt
          if (!overrideVersion || !taskVersionIsAfter(overrideVersion, task.updatedAt))
            delete next[taskId]
        }
        return next
      })
    }

    for (const taskId of strictRetries.keys()) {
      taskProgressStore.delete(taskId)
      blockedFailedTaskPollVersionsRef.current.delete(taskId)
      auxiliaryTaskReadGuard.clearTask(taskId)
      failedPollAuxiliaryDenialsRef.current.delete(taskId)
      terminalConfirmableAuxiliaryDenialsRef.current.delete(taskId)
      taskEventCursorsRef.current.delete(taskId)
      const pollGeneration = failedTaskPollGenerationsRef.current.get(taskId) ?? 0
      failedTaskPollGenerationsRef.current.set(taskId, pollGeneration + 1)
      const generation = terminalReconciliationGenerationsRef.current.get(taskId) ?? 0
      terminalReconciliationGenerationsRef.current.set(taskId, generation + 1)
      terminalReconciliationControllersRef.current.get(taskId)?.abort()
      terminalReconciliationControllersRef.current.delete(taskId)
      const timeout = terminalReconciliationTimeoutsRef.current.get(taskId)
      if (timeout !== undefined) window.clearTimeout(timeout)
      terminalReconciliationTimeoutsRef.current.delete(taskId)
    }
    if (strictRetries.size) {
      // oxlint-disable-next-line eslint-react/set-state-in-effect -- A strictly newer active list snapshot proves a retry without another request.
      setTerminalTaskPins((current) => {
        const next = { ...current }
        for (const taskId of strictRetries.keys()) delete next[taskId]
        return next
      })
      // oxlint-disable-next-line eslint-react/set-state-in-effect -- Drop terminal overrides only after a strictly newer active list snapshot.
      setTaskOverrides((current) => {
        const next = { ...current }
        for (const [taskId, task] of strictRetries) {
          const overrideVersion = current[taskId]?.updatedAt
          if (!overrideVersion || !taskVersionIsAfter(overrideVersion, task.updatedAt))
            delete next[taskId]
        }
        return next
      })
    }

    for (const [taskId, pin] of equalTimestampRetries) {
      if (equalRetryListGenerationsRef.current.get(taskId) === taskListGeneration) continue
      equalRetryListGenerationsRef.current.set(taskId, taskListGeneration)
      auxiliaryTaskReadGuard.clearTask(taskId)
      failedPollAuxiliaryDenialsRef.current.delete(taskId)
      terminalConfirmableAuxiliaryDenialsRef.current.delete(taskId)
      const timeout = terminalReconciliationTimeoutsRef.current.get(taskId)
      if (timeout !== undefined) window.clearTimeout(timeout)
      terminalReconciliationTimeoutsRef.current.delete(taskId)
      const reconciliationGeneration =
        (terminalReconciliationGenerationsRef.current.get(taskId) ?? 0) + 1
      terminalReconciliationGenerationsRef.current.set(taskId, reconciliationGeneration)
      void reconcileTerminalTask(taskId, pin.observedAt, reconciliationGeneration)
    }
  }, [
    auxiliaryTaskReadGuard,
    baseTasks,
    permissionDenied,
    reconcileTerminalTask,
    taskListGeneration,
    taskProgressStore,
    terminalTaskPins,
  ])

  const handleUploadFiles = useCallback(
    async (files: File[]): Promise<boolean> => {
      if (!canUpload || !files.length || uploadPendingRef.current) return false
      const uploadableFiles: File[] = []
      const localExclusions: Array<{
        filename: string
        reasonKey: UploadExclusionReasonKey
      }> = []
      for (const file of files) {
        const issue = documentUploadIssue(file)
        if (issue) localExclusions.push({ filename: file.name, reasonKey: issue })
        else uploadableFiles.push(file)
      }
      const formatExclusionDetails = (
        exclusions: Array<{ filename: string; reasonKey: UploadExclusionReasonKey }>,
      ) => {
        const detailItems = exclusions
          .slice(0, 3)
          .map(
            ({ filename, reasonKey }) =>
              `${filename} (${t(($) => $[`newKnowledge.documentUploadExclusion.${reasonKey}`])})`,
          )
        if (exclusions.length > detailItems.length)
          detailItems.push(
            t(($) => $['newKnowledge.documentUploadExclusion.more'], {
              count: exclusions.length - detailItems.length,
            }),
          )
        return detailItems.join('; ')
      }
      if (!uploadableFiles.length) {
        toast.error(
          t(($) => $['newKnowledge.documentUploadRejected'], {
            details: formatExclusionDetails(localExclusions),
          }),
        )
        return false
      }
      let writePermissionDenied = false
      uploadPendingRef.current = true
      beginUploadActivity()
      try {
        if ((await ensureModelReady({ capability: 'ingest', intent: 'upload' })).status !== 'ready')
          return false
        let acceptedCount = 0
        const exclusions = [...localExclusions]
        const unstagedFiles = uploadableFiles.filter(
          (file) => !stagedUploadIdsRef.current.has(file),
        )
        if (unstagedFiles.length) await stageFiles(unstagedFiles)
        const uploads = uploadableFiles.map((file) => {
          const fingerprint = `${knowledgeSpaceId}:${file.name}:${file.size}:${file.lastModified}`
          const id = uploadRequestIdsRef.current.get(fingerprint) ?? createRequestId()
          uploadRequestIdsRef.current.set(fingerprint, id)
          const uploadId = stagedUploadIdsRef.current.get(file)
          if (!uploadId) throw new Error('KnowledgeFS file was not staged')
          return { file, id, uploadId }
        })
        await uploadKnowledgeFsDocuments(
          knowledgeSpaceId,
          uploads,
          uploadProgressRef.current,
          (file, phase) => {
            setStagedUploadProgress((current) => {
              const next = new Map(current)
              next.set(file, phase)
              return next
            })
          },
        )
        uploadProgressRef.current.clear()
        uploadRequestIdsRef.current.clear()
        stagedUploadIdsRef.current.clear()
        acceptedCount = uploadableFiles.length
        const exclusionDetails = formatExclusionDetails(exclusions)
        if (!acceptedCount) {
          toast.error(
            t(($) => $['newKnowledge.documentUploadRejected'], {
              details: exclusionDetails,
            }),
          )
          return false
        }
        if (exclusions.length)
          toast.warning(
            t(($) => $['newKnowledge.documentUploadPartial'], {
              accepted: acceptedCount,
              details: exclusionDetails,
              excluded: exclusions.length,
            }),
          )
        else toast.success(t(($) => $['newKnowledge.documentUploadStarted']))
        refreshDocumentsAndTasks()
        return true
      } catch (error) {
        if (responseStatus(error) === 403) {
          writePermissionDenied = true
          cancelUploadForm()
          handleWritePermissionDenied()
        } else toast.error(t(($) => $['newKnowledge.documentUploadFailed']))
        return false
      } finally {
        if (!writePermissionDenied) {
          writePermissionFocusRecoveryRequestedRef.current = false
          writePermissionFocusOriginRef.current = null
        }
        uploadPendingRef.current = false
        endUploadActivity()
        setStagedUploadProgress(new Map())
      }
    },
    [
      canUpload,
      beginUploadActivity,
      cancelUploadForm,
      endUploadActivity,
      ensureModelReady,
      handleWritePermissionDenied,
      knowledgeSpaceId,
      refreshDocumentsAndTasks,
      stageFiles,
      t,
    ],
  )

  const handleReindexDocuments = useCallback(async () => {
    if (
      !canWrite ||
      selectionDisabled ||
      !validSelectedDocumentIds.size ||
      bulkReindexDisabled ||
      reindexPendingRef.current ||
      bulkActionPendingRef.current
    )
      return
    reindexPendingRef.current = true
    bulkActionPendingRef.current = true
    setBulkActionPending('reindex')
    try {
      if ((await ensureModelReady({ capability: 'index', intent: 'reindex' })).status !== 'ready')
        return
      const selectedIds = [...validSelectedDocumentIds].sort()
      const result = await reindexDocuments({
        body: { documentIds: selectedIds },
        params: { control_space_id: knowledgeSpaceId },
      })
      const missingIds = result.items
        .filter((item) => item.status === 'not_found')
        .flatMap((item) => (item.document_id ? [item.document_id] : []))
      const disabledIds = result.items
        .filter((item) => item.status === 'disabled')
        .flatMap((item) => (item.document_id ? [item.document_id] : []))
      const queuedCount = result.items.filter((item) => item.status === 'queued').length
      if (!queuedCount) {
        setSelectedDocumentIds(new Set(disabledIds))
        toast.error(
          disabledIds.length
            ? t(($) => $['newKnowledge.documentsReindexFailed'])
            : t(($) => $['newKnowledge.documentsReindexPartial'], {
                missing: missingIds.length,
                queued: 0,
              }),
        )
        refreshDocumentsAndTasks()
        return
      }
      setSelectedDocumentIds(new Set([...missingIds, ...disabledIds]))
      if (disabledIds.length) toast.warning(t(($) => $['newKnowledge.documentsReindexFailed']))
      else if (missingIds.length)
        toast.warning(
          t(($) => $['newKnowledge.documentsReindexPartial'], {
            missing: missingIds.length,
            queued: queuedCount,
          }),
        )
      else toast.success(t(($) => $['newKnowledge.documentsReindexStarted']))
      refreshDocumentsAndTasks()
    } catch (error) {
      if (responseStatus(error) === 403) handleWritePermissionDenied()
      else toast.error(t(($) => $['newKnowledge.documentsReindexFailed']))
    } finally {
      reindexPendingRef.current = false
      bulkActionPendingRef.current = false
      setBulkActionPending(undefined)
    }
  }, [
    canWrite,
    bulkReindexDisabled,
    ensureModelReady,
    handleWritePermissionDenied,
    knowledgeSpaceId,
    refreshDocumentsAndTasks,
    reindexDocuments,
    selectionDisabled,
    t,
    validSelectedDocumentIds,
  ])

  const handleReindexDocument = useCallback(
    async (documentId: string) => {
      const status = documentStatuses.get(documentId)
      if (!canWrite || !status || !documentCanReindex(status) || reindexPendingRef.current) return
      reindexPendingRef.current = true
      try {
        if ((await ensureModelReady({ capability: 'index', intent: 'reindex' })).status !== 'ready')
          return
        const result = await reindexDocuments({
          body: { documentIds: [documentId] },
          params: { control_space_id: knowledgeSpaceId },
        })
        const item = result.items[0]
        if (!item || item.status === 'not_found')
          toast.error(
            t(($) => $['newKnowledge.documentsReindexPartial'], {
              missing: 1,
              queued: 0,
            }),
          )
        else if (item.status === 'disabled')
          toast.error(t(($) => $['newKnowledge.documentsReindexFailed']))
        else toast.success(t(($) => $['newKnowledge.documentsReindexStarted']))
        refreshDocumentsAndTasks()
      } catch (error) {
        if (responseStatus(error) === 403) handleWritePermissionDenied()
        else toast.error(t(($) => $['newKnowledge.documentsReindexFailed']))
      } finally {
        reindexPendingRef.current = false
      }
    },
    [
      canWrite,
      documentStatuses,
      ensureModelReady,
      handleWritePermissionDenied,
      knowledgeSpaceId,
      refreshDocumentsAndTasks,
      reindexDocuments,
      t,
    ],
  )

  const handleRenameDocument = useCallback(
    async (documentId: string, title: string) => {
      if (!canWrite || documentActionPendingRef.current) return false
      const currentDocument = documents.find((document) => document.id === documentId)
      const normalizedTitle = title.trim()
      if (
        !currentDocument ||
        !normalizedTitle ||
        normalizedTitle === documentTitle(currentDocument)
      )
        return false
      documentActionPendingRef.current = true
      setPendingDocumentAction({ action: 'rename', documentId })
      try {
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.documents.byDocumentId.patch({
          body: {
            expectedRowVersion: currentDocument.rowVersion,
            patch: { displayName: normalizedTitle },
          },
          params: { control_space_id: knowledgeSpaceId, document_id: documentId },
        })
        refreshDocuments()
        return true
      } catch (error) {
        if (responseStatus(error) === 403) handleWritePermissionDenied()
        else toast.error(t(($) => $['newKnowledge.settings.saveFailed']))
        return false
      } finally {
        documentActionPendingRef.current = false
        setPendingDocumentAction(undefined)
      }
    },
    [canWrite, documents, handleWritePermissionDenied, knowledgeSpaceId, refreshDocuments, t],
  )

  const handleDownloadDocument = useCallback(
    async (documentId: string) => {
      if (!canDownload || documentActionPendingRef.current) return false
      const currentDocument = documents.find((document) => document.id === documentId)
      const status = documentStatuses.get(documentId)
      if (!currentDocument?.active || !status || !documentCanDownload(status)) return false
      documentActionPendingRef.current = true
      setPendingDocumentAction({ action: 'download', documentId })
      try {
        const file =
          await consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.byDocumentId.download.get(
            {
              params: { control_space_id: knowledgeSpaceId, document_id: documentId },
            },
          )
        downloadBlob({
          data: file,
          fileName:
            typeof File !== 'undefined' && file instanceof File && file.name
              ? file.name
              : currentDocument.title,
        })
        return true
      } catch {
        toast.error(tCommon(($) => $['actionMsg.downloadUnsuccessfully']))
        return false
      } finally {
        documentActionPendingRef.current = false
        setPendingDocumentAction(undefined)
      }
    },
    [canDownload, documentStatuses, documents, knowledgeSpaceId, tCommon],
  )

  const handleToggleDocumentAvailability = useCallback(
    async (documentId: string) => {
      if (!canWrite || documentActionPendingRef.current) return false
      const currentDocument = documents.find((document) => document.id === documentId)
      const status = documentStatuses.get(documentId)
      if (!currentDocument || !status || !documentCanToggleAvailability(status)) return false
      documentActionPendingRef.current = true
      setPendingDocumentAction({ action: 'toggle-availability', documentId })
      try {
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.byDocumentId.patch(
          {
            body: {
              enabled: !currentDocument.enabled,
              expectedRowVersion: currentDocument.rowVersion,
            },
            params: { control_space_id: knowledgeSpaceId, document_id: documentId },
          },
        )
        refreshDocuments()
        return true
      } catch (error) {
        if (responseStatus(error) === 403) handleWritePermissionDenied()
        else if (responseStatus(error) === 409) {
          refreshDocuments()
          toast.warning(t(($) => $['newKnowledge.taskActionFailed']))
        } else toast.error(t(($) => $['newKnowledge.documentsErrorDescription']))
        return false
      } finally {
        documentActionPendingRef.current = false
        setPendingDocumentAction(undefined)
      }
    },
    [
      canWrite,
      documentStatuses,
      documents,
      handleWritePermissionDenied,
      knowledgeSpaceId,
      refreshDocuments,
      t,
    ],
  )

  const handleUpdateDocumentsAvailability = useCallback(async () => {
    if (
      !canWrite ||
      selectionDisabled ||
      !validSelectedDocumentIds.size ||
      availabilityDisabled ||
      bulkActionPendingRef.current
    )
      return
    if (!selectedDocuments.length) return
    bulkActionPendingRef.current = true
    setBulkActionPending('availability')
    try {
      const result = await consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.patch(
        {
          body: {
            documents: selectedDocuments.map((document) => ({
              documentId: document.id,
              expectedRowVersion: document.rowVersion,
            })),
            enabled: availabilityTargetEnabled,
          },
          params: { control_space_id: knowledgeSpaceId },
        },
      )
      const failedIds = result.items.flatMap((item) =>
        item.status === 'conflict' || item.status === 'not_found' ? [item.document_id] : [],
      )
      setSelectedDocumentIds(new Set(failedIds))
      if (failedIds.length) toast.warning(t(($) => $['newKnowledge.documentsErrorDescription']))
      refreshDocuments()
    } catch (error) {
      if (responseStatus(error) === 403) handleWritePermissionDenied()
      else toast.error(t(($) => $['newKnowledge.documentsErrorDescription']))
    } finally {
      bulkActionPendingRef.current = false
      setBulkActionPending(undefined)
    }
  }, [
    canWrite,
    availabilityDisabled,
    availabilityTargetEnabled,
    handleWritePermissionDenied,
    knowledgeSpaceId,
    refreshDocuments,
    selectedDocuments,
    selectionDisabled,
    t,
    validSelectedDocumentIds,
  ])

  const handleDownloadDocuments = useCallback(async () => {
    if (!canDownload || !downloadableSelectedDocumentIds.length || bulkActionPendingRef.current)
      return
    bulkActionPendingRef.current = true
    setBulkActionPending('download')
    try {
      const file =
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.downloadZip.post({
          body: { document_ids: downloadableSelectedDocumentIds },
          params: { control_space_id: knowledgeSpaceId },
        })
      downloadBlob({
        data: file,
        fileName:
          typeof File !== 'undefined' && file instanceof File && file.name
            ? file.name
            : 'knowledge-documents.zip',
      })
    } catch {
      toast.error(tCommon(($) => $['actionMsg.downloadUnsuccessfully']))
    } finally {
      bulkActionPendingRef.current = false
      setBulkActionPending(undefined)
    }
  }, [canDownload, downloadableSelectedDocumentIds, knowledgeSpaceId, tCommon])

  const handleRemoveDocuments = useCallback(async () => {
    if (
      !canWrite ||
      selectionDisabled ||
      !validSelectedDocumentIds.size ||
      bulkActionPendingRef.current
    )
      return false
    const selectedDocuments = documents.filter((document) =>
      validSelectedDocumentIds.has(document.id),
    )
    if (!selectedDocuments.length) return false
    bulkActionPendingRef.current = true
    setBulkActionPending('remove')
    try {
      await consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.bulk.delete({
        body: {
          documents: selectedDocuments.map((document) => ({
            documentId: document.id,
            expectedRevision: document.rowVersion,
          })),
        },
        headers: { 'Idempotency-Key': createRequestId() },
        params: { control_space_id: knowledgeSpaceId },
      })
      setSelectedDocumentIds(new Set())
      refreshDocumentsAndTasks()
      return true
    } catch (error) {
      if (responseStatus(error) === 403) handleWritePermissionDenied()
      else toast.error(t(($) => $['newKnowledge.documentsErrorDescription']))
      return false
    } finally {
      bulkActionPendingRef.current = false
      setBulkActionPending(undefined)
    }
  }, [
    canWrite,
    documents,
    handleWritePermissionDenied,
    knowledgeSpaceId,
    refreshDocumentsAndTasks,
    selectionDisabled,
    t,
    validSelectedDocumentIds,
  ])

  const handleRemoveDocument = useCallback(
    async (documentId: string) => {
      if (!canWrite || documentActionPendingRef.current) return false
      const currentDocument = documents.find((document) => document.id === documentId)
      if (!currentDocument) return false
      documentActionPendingRef.current = true
      setPendingDocumentAction({ action: 'remove', documentId })
      try {
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.byDocumentId.delete(
          {
            body: { expectedRevision: currentDocument.rowVersion },
            headers: { 'Idempotency-Key': createRequestId() },
            params: { control_space_id: knowledgeSpaceId, document_id: documentId },
          },
        )
        setSelectedDocumentIds((current) => {
          const next = new Set(current)
          next.delete(documentId)
          return next
        })
        refreshDocumentsAndTasks()
        return true
      } catch (error) {
        if (responseStatus(error) === 403) handleWritePermissionDenied()
        else toast.error(t(($) => $['newKnowledge.documentsErrorDescription']))
        return false
      } finally {
        documentActionPendingRef.current = false
        setPendingDocumentAction(undefined)
      }
    },
    [
      canWrite,
      documents,
      handleWritePermissionDenied,
      knowledgeSpaceId,
      refreshDocumentsAndTasks,
      t,
    ],
  )

  const handleTaskEvent = useCallback(
    (taskId: string, taskVersion: string, event: ProcessingTaskEvent) => {
      const eventVersion = event.event === 'progress' ? event.data.updatedAt : taskVersion
      const terminalSnapshot = !ACTIVE_TASK_STATES.has(event.data.state)
      const currentVersion = currentTaskVersionRef.current.get(taskId)
      if (currentVersion && taskVersionIsAfter(currentVersion, eventVersion)) {
        if (terminalSnapshot) pendingTerminalProgressRef.current.delete(taskId)
        return false
      }

      if (event.event === 'progress' && ACTIVE_TASK_STATES.has(event.data.state)) {
        if (trustedActiveOverrideVersionsRef.current.get(taskId)?.updatedAt === eventVersion)
          streamActiveOverrideVersionsRef.current.delete(taskId)
        else streamActiveOverrideVersionsRef.current.set(taskId, eventVersion)
      } else streamActiveOverrideVersionsRef.current.delete(taskId)

      if (event.event === 'progress' && terminalSnapshot) {
        currentTaskVersionRef.current.set(taskId, eventVersion)
        taskProgressStore.set(taskId, event.data)
        pendingTerminalProgressRef.current.set(taskId, event)
        return true
      }

      const pendingTerminalProgress =
        event.event === 'terminal' ? pendingTerminalProgressRef.current.get(taskId) : undefined
      if (event.event === 'terminal') pendingTerminalProgressRef.current.delete(taskId)

      if (event.event === 'progress') taskProgressStore.set(taskId, event.data)
      else taskProgressStore.delete(taskId)

      const currentTaskState = currentTaskStateRef.current.get(taskId)
      currentTaskVersionRef.current.set(taskId, eventVersion)
      if (event.event === 'progress' && currentTaskState === event.data.state) return true
      currentTaskStateRef.current.set(taskId, event.data.state)

      setTaskOverrides((current) => {
        const previous = current[taskId]
        if (
          event.event === 'progress' &&
          previous?.updatedAt &&
          taskVersionIsAfter(previous.updatedAt, event.data.updatedAt)
        )
          return current
        return {
          ...current,
          [taskId]:
            event.event === 'progress'
              ? {
                  errorCode: undefined,
                  errorMessage: undefined,
                  failure: undefined,
                  progressPercent: event.data.progressPercent,
                  stage: event.data.stage,
                  state: event.data.state,
                  updatedAt: event.data.updatedAt,
                }
              : {
                  errorCode: event.data.errorCode,
                  errorMessage: undefined,
                  failure: event.data.failure,
                  ...(pendingTerminalProgress
                    ? {
                        progressPercent: pendingTerminalProgress.data.progressPercent,
                        stage: pendingTerminalProgress.data.stage,
                      }
                    : {}),
                  state: event.data.state,
                  updatedAt: eventVersion,
                },
        }
      })
      if (event.event === 'terminal') {
        const pollGeneration = failedTaskPollGenerationsRef.current.get(taskId) ?? 0
        failedTaskPollGenerationsRef.current.set(taskId, pollGeneration + 1)
        const timeout = terminalReconciliationTimeoutsRef.current.get(taskId)
        if (timeout !== undefined) window.clearTimeout(timeout)
        terminalReconciliationTimeoutsRef.current.delete(taskId)
        const reconciliationGeneration =
          (terminalReconciliationGenerationsRef.current.get(taskId) ?? 0) + 1
        terminalReconciliationGenerationsRef.current.set(taskId, reconciliationGeneration)
        setTerminalTaskPins((current) => ({
          ...current,
          [taskId]: {
            observedAt: eventVersion,
            taskListGeneration: taskListGenerationRef.current,
          },
        }))
        if (event.data.state === 'failed')
          toast.error(t(($) => $['newKnowledge.taskFailedNotification']))
        refreshDocuments()
        void reconcileTerminalTask(taskId, eventVersion, reconciliationGeneration)
      }
      return true
    },
    [reconcileTerminalTask, refreshDocuments, t, taskProgressStore],
  )

  const handleTaskUpdated = useCallback(
    (task: DocumentProcessingTask) => {
      const currentVersion = currentTaskVersionRef.current.get(task.id)
      if (currentVersion && taskVersionIsAfter(currentVersion, task.updatedAt)) return
      streamActiveOverrideVersionsRef.current.delete(task.id)
      auxiliaryTaskReadGuard.clearTask(task.id)
      failedPollAuxiliaryDenialsRef.current.delete(task.id)
      terminalConfirmableAuxiliaryDenialsRef.current.delete(task.id)
      if (taskIsActive(task))
        trustedActiveOverrideVersionsRef.current.set(task.id, {
          taskListGeneration: taskListGenerationRef.current,
          updatedAt: task.updatedAt,
        })
      else trustedActiveOverrideVersionsRef.current.delete(task.id)
      trustedOverrideListGenerationsRef.current.delete(task.id)
      taskProgressStore.delete(task.id)
      currentTaskStateRef.current.set(task.id, task.state)
      currentTaskVersionRef.current.set(task.id, task.updatedAt)
      // oxlint-disable-next-line eslint-react/set-state-in-effect -- A committed active list lifecycle retires the denied failed snapshot.
      setTaskOverrides((current) => ({ ...current, [task.id]: normalizedTaskSnapshot(task) }))
      if (taskIsActive(task)) {
        blockedFailedTaskPollVersionsRef.current.delete(task.id)
        taskEventCursorsRef.current.delete(task.id)
        terminalReconciliationControllersRef.current.get(task.id)?.abort()
        terminalReconciliationControllersRef.current.delete(task.id)
        const timeout = terminalReconciliationTimeoutsRef.current.get(task.id)
        if (timeout !== undefined) window.clearTimeout(timeout)
        terminalReconciliationTimeoutsRef.current.delete(task.id)
        const generation = terminalReconciliationGenerationsRef.current.get(task.id) ?? 0
        terminalReconciliationGenerationsRef.current.set(task.id, generation + 1)
        const pollGeneration = failedTaskPollGenerationsRef.current.get(task.id) ?? 0
        failedTaskPollGenerationsRef.current.set(task.id, pollGeneration + 1)
        pendingTerminalProgressRef.current.delete(task.id)
        // oxlint-disable-next-line eslint-react/set-state-in-effect -- The authoritative active lifecycle supersedes the terminal pin.
        setTerminalTaskPins((current) => {
          const next = { ...current }
          delete next[task.id]
          return next
        })
      }
    },
    [auxiliaryTaskReadGuard, taskProgressStore],
  )

  const handleRetryDocument = useCallback(
    async (documentId: string) => {
      if (!canWrite || documentActionPendingRef.current) return false
      const task = taskByDocument.get(documentId)
      if (!task || !taskCanRetry(task)) return false
      documentActionPendingRef.current = true
      setPendingDocumentAction({ action: 'retry', documentId })
      try {
        const updated = backgroundTaskFromApi(
          await consoleClient.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.byTaskKind.byTaskId.retry.post(
            {
              params: {
                control_space_id: knowledgeSpaceId,
                task_id: task.id,
                task_kind: task.taskKind,
              },
            },
          ),
        )
        if (updated.documentId && updated.documentRevision)
          handleTaskUpdated(updated as DocumentProcessingTask)
        refreshDocumentsAndTasks()
        return true
      } catch (error) {
        if (responseStatus(error) === 403) handleWritePermissionDenied()
        else toast.error(t(($) => $['newKnowledge.taskActionFailed']))
        return false
      } finally {
        documentActionPendingRef.current = false
        setPendingDocumentAction(undefined)
      }
    },
    [
      canWrite,
      handleTaskUpdated,
      handleWritePermissionDenied,
      knowledgeSpaceId,
      refreshDocumentsAndTasks,
      t,
      taskByDocument,
    ],
  )

  useEffect(() => {
    if (permissionDenied) return
    for (const task of baseTasks) {
      if (!taskIsActive(task)) continue
      const denial = failedPollAuxiliaryDenialsRef.current.get(task.id)
      if (!denial || taskListGeneration <= denial.taskListGeneration) continue
      if (taskVersionIsAfter(denial.taskVersion, task.updatedAt)) continue
      failedPollAuxiliaryDenialsRef.current.delete(task.id)
      handleTaskUpdated(task)
    }
  }, [baseTasks, handleTaskUpdated, permissionDenied, taskListGeneration])

  useEffect(() => {
    for (const task of activeTasks) {
      const hadBlockedPoll = blockedFailedTaskPollVersionsRef.current.delete(task.id)
      if (!hadBlockedPoll) continue
      const generation = failedTaskPollGenerationsRef.current.get(task.id) ?? 0
      failedTaskPollGenerationsRef.current.set(task.id, generation + 1)
    }
  }, [activeTasks])

  useEffect(() => {
    if (permissionDenied || !tasksOpen || !orderedFailedTasksRef.current.length) return
    let canceled = false
    let timeout: number | undefined
    const cancelRequests = new Set<() => void>()
    const pollNextBatch = async () => {
      const failedTasks = orderedFailedTasksRef.current
      const pollableTasks = failedTasks.filter(
        (task) =>
          blockedFailedTaskPollVersionsRef.current.get(task.id) !== task.updatedAt &&
          !auxiliaryTaskReadGuard.isBlocked(task.id, task.updatedAt),
      )
      if (pollableTasks.length) {
        const pollCount = Math.min(MAX_TASK_EVENT_STREAMS, pollableTasks.length)
        const offset = failedTaskPollOffsetRef.current % pollableTasks.length
        const tasksToPoll = Array.from(
          { length: pollCount },
          (_, index) => pollableTasks[(offset + index) % pollableTasks.length]!,
        )
        failedTaskPollOffsetRef.current += MAX_TASK_EVENT_STREAMS
        const requestGenerations = new Map<string, number>()
        for (const task of tasksToPoll) {
          const requestGeneration = (failedTaskPollGenerationsRef.current.get(task.id) ?? 0) + 1
          failedTaskPollGenerationsRef.current.set(task.id, requestGeneration)
          requestGenerations.set(task.id, requestGeneration)
        }
        const requestController = new AbortController()
        let requestTimeout: number | undefined
        let rejectDeadline: ((reason?: unknown) => void) | undefined
        const cancelRequest = () => {
          requestController.abort()
          rejectDeadline?.(new DOMException('Task snapshot request aborted', 'AbortError'))
        }
        try {
          const request = findBackgroundTasks(
            knowledgeSpaceId,
            new Set(tasksToPoll.map((task) => task.id)),
            requestController.signal,
          )
          const deadline = new Promise<never>((_resolve, reject) => {
            rejectDeadline = reject
            requestTimeout = window.setTimeout(() => {
              requestController.abort()
              reject(new DOMException('Task snapshot request timed out', 'TimeoutError'))
            }, FAILED_TASK_POLL_REQUEST_TIMEOUT)
          })
          cancelRequests.add(cancelRequest)
          const snapshots = await Promise.race([request, deadline])
          for (const task of tasksToPoll) {
            const snapshot = snapshots.get(task.id)
            if (
              !snapshot ||
              canceled ||
              failedTaskPollGenerationsRef.current.get(task.id) !== requestGenerations.get(task.id)
            )
              continue
            const currentVersion = currentTaskVersionRef.current.get(task.id)
            if (currentVersion && taskVersionIsAfter(currentVersion, snapshot.updatedAt)) continue
            handleTaskUpdated(snapshot)
          }
        } catch (error) {
          for (const task of tasksToPoll) {
            if (
              canceled ||
              failedTaskPollGenerationsRef.current.get(task.id) !== requestGenerations.get(task.id)
            )
              continue
            if (responseStatus(error) === 403) {
              const currentTaskVersion = currentTaskVersionRef.current.get(task.id)
              const deniedVersion =
                currentTaskVersion && taskVersionIsAfter(currentTaskVersion, task.updatedAt)
                  ? currentTaskVersion
                  : task.updatedAt
              failedPollAuxiliaryDenialsRef.current.set(task.id, {
                taskListGeneration: taskListGenerationRef.current,
                taskVersion: deniedVersion,
              })
              denyAuxiliaryTaskRead(task.id, deniedVersion)
              continue
            }
            if (!taskSnapshotErrorIsTransient(error))
              blockedFailedTaskPollVersionsRef.current.set(task.id, task.updatedAt)
          }
        } finally {
          if (requestTimeout !== undefined) window.clearTimeout(requestTimeout)
          cancelRequests.delete(cancelRequest)
        }
      }
      if (!canceled) timeout = window.setTimeout(() => void pollNextBatch(), 5000)
    }
    timeout = window.setTimeout(() => void pollNextBatch(), 5000)
    return () => {
      canceled = true
      for (const cancelRequest of cancelRequests) cancelRequest()
      cancelRequests.clear()
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
  }, [
    auxiliaryTaskReadGuard,
    denyAuxiliaryTaskRead,
    failedTaskPollSignature,
    handleTaskUpdated,
    knowledgeSpaceId,
    permissionDenied,
    tasksOpen,
  ])

  const toggleDocument = useCallback(
    (documentId: string) => {
      if (!canWrite || selectionDisabled) return
      setSelectedDocumentIds((current) => {
        const next = new Set(current)
        if (next.has(documentId)) next.delete(documentId)
        else next.add(documentId)
        return next
      })
    },
    [canWrite, selectionDisabled],
  )

  const toggleAllFiltered = () => {
    if (!canWrite || selectionDisabled) return
    setSelectedDocumentIds((current) => {
      const next = new Set(current)
      if (allFilteredSelected)
        selectableFilteredDocuments.forEach((document) => next.delete(document.id))
      else selectableFilteredDocuments.forEach((document) => next.add(document.id))
      return next
    })
  }

  const retryDependencyQueries = () => {
    if (taskQueryBlockingError || sourceQueryBlockingError)
      setBlockingDependencyRetries((current) => ({
        sources: current.sources || sourceQueryBlockingError,
        tasks: current.tasks || taskQueryBlockingError,
      }))
    if (tasksQuery.isFetchNextPageError) void tasksQuery.fetchNextPage()
    else if (tasksQuery.error || taskQueryBlockingError) void tasksQuery.refetch()
    if (sourcesQuery.isFetchNextPageError) void sourcesQuery.fetchNextPage()
    else if (sourcesQuery.error || sourceQueryBlockingError) void sourcesQuery.refetch()
  }

  const loadMoreResults = () => {
    const requests: Promise<unknown>[] = []
    if (hasNextDocumentPage && !isFetchingNextDocumentPage) requests.push(fetchNextDocumentPage())
    if (hasNextTaskPage && !isFetchingNextTaskPage) requests.push(fetchNextTaskPage())
    if (hasRelevantNextSourcePage && !isFetchingNextSourcePage) requests.push(fetchNextSourcePage())
    void Promise.allSettled(requests)
  }

  const handleTaskEventCursor = useCallback((taskId: string, eventId?: string) => {
    if (eventId) taskEventCursorsRef.current.set(taskId, eventId)
    else taskEventCursorsRef.current.delete(taskId)
  }, [])

  const handleTaskStreamPermissionDenied = useCallback(
    (taskId: string, taskVersion: string) => {
      terminalConfirmableAuxiliaryDenialsRef.current.set(taskId, {
        taskListGeneration: taskListGenerationRef.current,
        taskVersion,
      })
      denyAuxiliaryTaskRead(taskId, taskVersion)
    },
    [denyAuxiliaryTaskRead],
  )

  return (
    <>
      {streamedActiveTasks.map((task) => {
        const observerVersion = taskObserverVersion(task)
        return (
          <TaskEventObserver
            key={`${task.id}:${taskObserverGenerations[task.id] ?? 0}`}
            documentId={task.documentId}
            knowledgeSpaceId={knowledgeSpaceId}
            lastEventId={taskEventCursorsRef.current.get(task.id)}
            onEvent={handleTaskEvent}
            onLastEventIdChange={handleTaskEventCursor}
            onPermissionDenied={handleTaskStreamPermissionDenied}
            taskId={task.id}
            taskVersion={observerVersion}
          />
        )
      })}
      <section
        ref={documentsSectionRef}
        className={cn(
          'relative flex min-h-full w-full flex-col gap-4 p-4 @min-[768px]/knowledge-content:p-6 @min-[1280px]/knowledge-content:p-8',
          bulkActionsVisible && 'pb-[calc(7rem+env(safe-area-inset-bottom,0px))]',
        )}
        onDragEnter={(event) => {
          const types = Array.from(event.dataTransfer.types ?? [])
          if (types.length && !types.includes('Files')) return
          event.preventDefault()
          if (!canUpload || uploading) return
          fileDragDepthRef.current += 1
          setIsFileDragActive(true)
        }}
        onDragLeave={() => {
          if (!fileDragDepthRef.current) return
          fileDragDepthRef.current -= 1
          if (!fileDragDepthRef.current) setIsFileDragActive(false)
        }}
        onDragOver={(event) => {
          const types = Array.from(event.dataTransfer.types ?? [])
          if (types.length && !types.includes('Files')) return
          event.preventDefault()
          event.dataTransfer.dropEffect = canUpload && !uploading ? 'copy' : 'none'
        }}
        onDrop={(event) => {
          const types = Array.from(event.dataTransfer.types ?? [])
          if (types.length && !types.includes('Files')) return
          event.preventDefault()
          fileDragDepthRef.current = 0
          setIsFileDragActive(false)
          if (!canUpload || uploading) return
          const files = [...event.dataTransfer.files]
          if (!files.length) return
          if (uploadFormOpen) uploadFormRef.current?.addFiles(files)
          else openUploadForm(files)
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            documentSurfaceHadFocusRef.current = false
            if (event.relatedTarget) {
              writePermissionFocusRecoveryRequestedRef.current = false
              writePermissionFocusOriginRef.current = null
            }
          }
        }}
        onFocusCapture={(event) => {
          if (
            writePermissionFocusRecoveryRequestedRef.current &&
            event.target !== writePermissionFocusOriginRef.current
          ) {
            writePermissionFocusRecoveryRequestedRef.current = false
            writePermissionFocusOriginRef.current = null
          }
          documentSurfaceHadFocusRef.current = true
        }}
      >
        {!uploadAvailable && (
          <span id="documents-upload-unavailable" className="sr-only">
            {t(($) => $['cornerLabel.unavailable'])}
          </span>
        )}
        <header>
          <h2
            ref={documentsTitleRef}
            id="new-knowledge-documents-title"
            className="title-xl-semi-bold leading-6 text-text-primary"
            tabIndex={-1}
          >
            {t(($) =>
              uploadFormOpen ? $['newKnowledge.addDocument'] : $['newKnowledge.documents'],
            )}
          </h2>
          <p className="mt-1 system-xs-regular text-text-tertiary">
            {t(($) =>
              uploadFormOpen
                ? $['newKnowledge.uploadFilesDescription']
                : $['newKnowledge.documentsDescription'],
            )}
          </p>
          {permissionPending && (
            <p
              id="documents-permission-pending"
              className="mt-2 system-xs-regular text-text-tertiary"
              role="status"
            >
              {t(($) => $['newKnowledge.permission'])}
              {' · '}
              {tCommon(($) => $.loading)}
            </p>
          )}
          {!permissionPending && !permissionQueryError && (!canEdit || writePermissionRevoked) && (
            <p
              id="documents-readonly-reason"
              className="mt-2 inline-flex items-center gap-1.5 system-xs-regular text-text-warning"
              role="status"
            >
              <span aria-hidden className="i-ri-lock-line size-3.5" />
              {t(($) => $['newKnowledge.documentPermissionRestricted'])}
            </p>
          )}
        </header>
        <KnowledgeModelReadinessBanner capability="index" knowledgeSpaceId={knowledgeSpaceId} />
        {permissionQueryError && (
          <div
            className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-divider-regular bg-background-section px-3 py-2"
            role="alert"
          >
            <span id="documents-permission-error" className="system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.permissionLoadFailed'])}
            </span>
            <Button
              ref={permissionRetryButtonRef}
              aria-label={`${tCommon(($) => $['operation.retry'])} · ${t(($) => $['newKnowledge.permissionLoadFailed'])}`}
              aria-busy={workspacePermissionKeysFetching}
              loading={workspacePermissionKeysFetching}
              size="small"
              onBlur={(event) => {
                if (event.relatedTarget) mainRetryFocusRequestedRef.current = false
              }}
              onClick={() => {
                mainRetryFocusRequestedRef.current = true
                void refreshWorkspacePermissions(true)
              }}
            >
              {tCommon(($) => $['operation.retry'])}
            </Button>
          </div>
        )}
        {documentsQuery.error &&
          documentsQuery.data &&
          !permissionDenied &&
          !documentsQuery.isFetchNextPageError && (
            <div
              className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-divider-regular bg-background-section px-3 py-2"
              role="alert"
            >
              <span className="system-xs-regular text-text-tertiary">
                {t(($) =>
                  responseStatus(documentsQuery.error) === 403
                    ? $['newKnowledge.documentsPermissionDescription']
                    : $['newKnowledge.documentsErrorDescription'],
                )}
              </span>
              {responseStatus(documentsQuery.error) !== 403 && (
                <Button
                  ref={documentsRetryButtonRef}
                  aria-label={`${tCommon(($) => $['operation.retry'])} · ${t(($) => $['newKnowledge.documentsErrorDescription'])}`}
                  aria-busy={documentsQuery.isRefetching}
                  loading={documentsQuery.isRefetching}
                  size="small"
                  onBlur={(event) => {
                    if (event.relatedTarget) mainRetryFocusRequestedRef.current = false
                  }}
                  onClick={() => {
                    mainRetryFocusRequestedRef.current = true
                    void refetchDocumentsQuery()
                  }}
                >
                  {tCommon(($) => $['operation.retry'])}
                </Button>
              )}
            </div>
          )}
        {!permissionDenied && !dependencyQueryBlockingError && dependencyQueryWarning && (
          <div
            className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-divider-regular bg-background-section px-3 py-2"
            role="alert"
          >
            <span className="system-xs-regular text-text-tertiary">
              {sourcesQuery.error || sourcesQuery.isFetchNextPageError
                ? t(($) => $['newKnowledge.sourcesErrorDescription'])
                : t(($) => $['newKnowledge.tasksErrorDescription'])}
            </span>
            <Button
              ref={dependencyRetryButtonRef}
              aria-label={`${tCommon(($) => $['operation.retry'])} · ${
                sourcesQuery.error || sourcesQuery.isFetchNextPageError
                  ? t(($) => $['newKnowledge.sourcesErrorDescription'])
                  : t(($) => $['newKnowledge.tasksErrorDescription'])
              }`}
              aria-busy={dependencyRetryFetching}
              loading={dependencyRetryFetching}
              size="small"
              onBlur={(event) => {
                if (event.relatedTarget) mainRetryFocusRequestedRef.current = false
              }}
              onClick={() => {
                mainRetryFocusRequestedRef.current = true
                retryDependencyQueries()
              }}
            >
              {tCommon(($) => $['operation.retry'])}
            </Button>
          </div>
        )}
        {documentsQuery.isPending && !permissionDenied ? (
          <div className="flex min-h-64 flex-1 items-center justify-center">
            <Loading />
          </div>
        ) : permissionDenied || (documentsQuery.error && !documentsQuery.data) ? (
          <div
            ref={documentPermissionAlertRef}
            className="flex min-h-64 flex-1 flex-col items-center justify-center px-6 text-center"
            role="alert"
            tabIndex={permissionDenied ? -1 : undefined}
          >
            <span aria-hidden className="i-ri-error-warning-line size-7 text-text-tertiary" />
            <h2 className="mt-3 title-xl-semi-bold text-text-primary">
              {t(($) =>
                permissionDenied
                  ? $['newKnowledge.documentsPermissionTitle']
                  : $['newKnowledge.documentsErrorTitle'],
              )}
            </h2>
            <p className="mt-2 max-w-md body-sm-regular text-text-tertiary">
              {t(($) =>
                permissionDenied
                  ? $['newKnowledge.documentsPermissionDescription']
                  : $['newKnowledge.documentsErrorDescription'],
              )}
            </p>
            {(!permissionDenied ||
              (auxiliaryReadPermissionDenied && !documentPermissionDenied)) && (
              <Button
                ref={documentsRetryButtonRef}
                aria-label={`${tCommon(($) => $['operation.retry'])} · ${documentsRecoveryDescription}`}
                aria-busy={documentsQuery.isFetching}
                className="mt-4"
                loading={documentsQuery.isFetching}
                onBlur={(event) => {
                  if (event.relatedTarget) mainRetryFocusRequestedRef.current = false
                }}
                onClick={() => {
                  mainRetryFocusRequestedRef.current = true
                  if (auxiliaryReadPermissionDenied) retryAuxiliaryTaskRead()
                  else void refetchDocumentsQuery()
                }}
              >
                {tCommon(($) => $['operation.retry'])}
              </Button>
            )}
          </div>
        ) : dependencyQueryBlockingError ? (
          <div
            className="flex min-h-64 flex-1 flex-col items-center justify-center px-6 text-center"
            role="alert"
          >
            <span aria-hidden className="i-ri-error-warning-line size-7 text-text-tertiary" />
            <p className="mt-3 max-w-md body-sm-regular text-text-tertiary">
              {taskQueryBlockingError
                ? t(($) => $['newKnowledge.tasksErrorDescription'])
                : t(($) => $['newKnowledge.sourcesErrorDescription'])}
            </p>
            <Button
              ref={dependencyRetryButtonRef}
              aria-label={`${tCommon(($) => $['operation.retry'])} · ${
                taskQueryBlockingError
                  ? t(($) => $['newKnowledge.tasksErrorDescription'])
                  : t(($) => $['newKnowledge.sourcesErrorDescription'])
              }`}
              aria-busy={blockingDependencyRetryFetching}
              className="mt-4"
              loading={blockingDependencyRetryFetching}
              onBlur={(event) => {
                if (event.relatedTarget) mainRetryFocusRequestedRef.current = false
              }}
              onClick={() => {
                mainRetryFocusRequestedRef.current = true
                retryDependencyQueries()
              }}
            >
              {tCommon(($) => $['operation.retry'])}
            </Button>
          </div>
        ) : uploadFormOpen ? (
          <DocumentUploadForm
            ref={uploadFormRef}
            initialFiles={uploadFormInitialFiles}
            uploadProgress={stagedUploadProgress}
            uploading={uploading}
            onCancel={cancelUploadForm}
            onFilesAdded={async (files) => {
              try {
                await stageFiles(files)
              } catch (error) {
                if (error instanceof DocumentStagingCanceledError) return
                toast.error(t(($) => $['newKnowledge.documentUploadFailed']))
                throw error
              }
            }}
            onFileRemoved={discardStagedFile}
            onSubmit={async (files) => {
              writePermissionFocusRecoveryRequestedRef.current = true
              writePermissionFocusOriginRef.current = document.activeElement as HTMLElement | null
              const uploaded = await handleUploadFiles(files)
              if (uploaded) closeUploadForm()
              return uploaded
            }}
          />
        ) : !documents.length ? (
          <DocumentsEmpty
            canEdit={canUpload}
            onAddDocument={() => openUploadForm()}
            onOpenMetadata={() => setMetadataOpen(true)}
            readOnlyReasonId={documentUploadRestrictionReasonId}
            uploading={uploading}
          />
        ) : (
          <DocumentsList
            activeTaskCount={activeTasks.length}
            allSelected={allFilteredSelected}
            attentionTaskBadge={attentionTaskBadge}
            canDownload={canDownload}
            canEdit={canWrite}
            canUpload={canUpload}
            completingResults={completingFilteredResults}
            documents={filteredDocuments}
            failureReasons={documentFailureReasons}
            filter={filter}
            getDocumentHref={(documentId) =>
              newKnowledgeDocumentDetailPath(knowledgeSpaceId, documentId)
            }
            hasNextPage={Boolean(
              hasNextDocumentPage || hasNextTaskPage || hasRelevantNextSourcePage,
            )}
            hasSelectableDocuments={Boolean(selectableFilteredDocuments.length)}
            hasTaskError={hasTaskError}
            isFetchNextPageError={documentsQuery.isFetchNextPageError}
            isFetchingNextDocumentPage={isFetchingNextDocumentPage}
            isFetchingNextPage={isFetchingNextResultsPage}
            onAddDocument={() => openUploadForm()}
            onFilterChange={setFilter}
            onLoadMore={loadMoreResults}
            onDownloadDocument={handleDownloadDocument}
            onOpenMetadata={() => setMetadataOpen(true)}
            onOpenTasks={() => setTasksOpen(true)}
            onRemoveDocument={handleRemoveDocument}
            onRenameDocument={handleRenameDocument}
            onReindexDocument={(documentId) => void handleReindexDocument(documentId)}
            onRetryDocument={handleRetryDocument}
            onSearchChange={setSearch}
            onSelectAll={toggleAllFiltered}
            onSelectDocument={toggleDocument}
            onToggleDocumentAvailability={handleToggleDocumentAvailability}
            pendingDocumentAction={pendingDocumentAction}
            readOnlyReasonId={documentWriteRestrictionReasonId}
            resultsIncomplete={filteredResultsIncomplete}
            retryableDocumentIds={retryableDocumentIds}
            search={search}
            selectionDisabled={selectionDisabled}
            selectedDocumentIds={validSelectedDocumentIds}
            showTasks={Boolean(
              tasks.length ||
              tasksQuery.error ||
              tasksQuery.isFetchNextPageError ||
              hasNextTaskPage,
            )}
            someSelected={someFilteredSelected}
            sourcesPending={sourceResultsIncomplete}
            sourceNames={sourceNames}
            statusPending={dependencyResultsIncomplete}
            statuses={documentStatuses}
            tasksPending={taskResultsIncomplete}
            tasksButtonLabel={tasksButtonLabel}
            tasksLiveStatus={tasksLiveStatus}
            uploadRestrictionReasonId={documentUploadRestrictionReasonId}
            uploading={uploading}
          />
        )}
        {isFileDragActive && canUpload && <DocumentDropOverlay />}
      </section>
      {bulkActionsVisible && (
        <DocumentBulkActions
          actionPending={bulkActionPending}
          availabilityDisabled={availabilityDisabled}
          availabilityTargetEnabled={availabilityTargetEnabled}
          disabled={selectionDisabled}
          disabledReason={reindexUnavailableReason}
          downloadDisabled={!canDownload || !downloadableSelectedDocumentIds.length}
          onClear={() => setSelectedDocumentIds(new Set())}
          onDownload={() => void handleDownloadDocuments()}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              bulkActionsHadFocusRef.current = false
          }}
          onFocusCapture={() => {
            bulkActionsHadFocusRef.current = true
          }}
          onReindex={() => void handleReindexDocuments()}
          onRemove={handleRemoveDocuments}
          onUpdateAvailability={() => void handleUpdateDocumentsAvailability()}
          reindexDisabled={bulkReindexDisabled}
          selectedCount={validSelectedDocumentIds.size}
          showAvailabilityAction={bulkAvailabilityActionVisible}
        />
      )}
      <ProcessingTasksDrawer
        actionResultsValid={!permissionDenied}
        canEdit={canWrite}
        documentQueryError={Boolean(documentsQuery.error || documentsQuery.isFetchNextPageError)}
        documentQueryFetching={documentsQuery.isFetching}
        documents={documents}
        documentsPending={Boolean(hasNextDocumentPage || documentsQuery.isFetchingNextPage)}
        hasNextDocumentPage={Boolean(hasNextDocumentPage)}
        hasNextTaskPage={Boolean(hasNextTaskPage)}
        hasUnresolvedTaskDocuments={unresolvedTaskDocumentIds.size > 0}
        isFetchingNextDocumentPage={isFetchingNextDocumentPage}
        isFetchingNextTaskPage={isFetchingNextTaskPage}
        knowledgeSpaceId={knowledgeSpaceId}
        onLoadMoreDocuments={() => void fetchNextDocumentPage()}
        onLoadMoreTasks={() => void fetchNextTaskPage()}
        onOpenChange={setTasksOpen}
        onRefreshDocumentsAndTasks={refreshDocumentsAndTasks}
        onRetryPermissionQuery={() => void refreshWorkspacePermissions(true)}
        onRetryDocumentQuery={() => {
          if (documentsQuery.isFetchNextPageError) void documentsQuery.fetchNextPage()
          else void refetchDocumentsQuery()
        }}
        onRetryTaskQuery={() => {
          if (tasksQuery.isFetchNextPageError) void tasksQuery.fetchNextPage()
          else void tasksQuery.refetch()
        }}
        onTaskUpdated={handleTaskUpdated}
        onWritePermissionDenied={handleWritePermissionDenied}
        open={tasksOpen && !permissionDenied}
        permissionQueryError={permissionQueryError}
        permissionQueryFetching={workspacePermissionKeysFetching}
        permissionQueryPending={permissionPending}
        readOnlyReason={
          writePermissionRevoked || (!permissionPending && !permissionQueryError && !canEdit)
            ? t(($) => $['newKnowledge.documentPermissionRestricted'])
            : undefined
        }
        sourceNames={sourceNames}
        taskQueryPending={tasksQuery.isPending}
        taskQueryError={Boolean(tasksQuery.error || tasksQuery.isFetchNextPageError)}
        taskQueryFetching={tasksQuery.isFetching}
        taskProgressStore={taskProgressStore}
        tasks={drawerTasks}
      />
      <DocumentMetadataDrawer
        knowledgeSpaceId={knowledgeSpaceId}
        onOpenChange={setMetadataOpen}
        open={metadataOpen && !permissionDenied}
        readOnly={!canWrite}
      />
      <KnowledgeModelSetupDialog
        open={modelSetupDialogOpen}
        readiness={modelReadiness}
        onOpenChange={setModelSetupDialogOpen}
        onConfigure={configureModelSetup}
      />
    </>
  )
}
