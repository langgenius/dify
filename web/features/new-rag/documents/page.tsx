'use client'

import type { DocumentUploadFormHandle } from '../upload/form'
import type { DocumentAction } from './actions-dropdown'
import type { DocumentProcessingTask } from './models'
import type { UploadExclusionReasonKey } from './upload/model'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useQueryState } from 'nuqs'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import {
  datasetDefaultPermissionKeysAtom,
  workspacePermissionKeysErrorAtom,
  workspacePermissionKeysLoadingAtom,
} from '@/context/permission-state'
import { knowledgeFsUploadEnabledAtom } from '@/features/system-features/state'
import { consoleClient, consoleQuery } from '@/service/client'
import { downloadBlob } from '@/utils/download'
import { DatasetACLPermission, hasPermission } from '@/utils/permission'
import { KnowledgeModelReadinessBanner } from '../components/knowledge-model-readiness-banner'
import { KnowledgeModelSetupDialog } from '../components/knowledge-model-setup-dialog'
import { knowledgeFsTaskFailureMessageKey } from '../knowledge-fs-task-error'
import { createRequestId } from '../request-id'
import { newKnowledgeDocumentDetailPath } from '../routes'
import { sourceFromApi } from '../sources/source-models'
import { useKnowledgeSpace } from '../space/context'
import { DocumentUploadForm } from '../upload/form'
import { uploadKnowledgeFsDocuments } from '../upload/knowledge-fs-upload'
import { documentUploadIssue } from '../upload/policy'
import { useKnowledgeFileSizeLimit } from '../upload/use-file-size-limit'
import { useKnowledgeModelSetupGuard } from '../use-knowledge-model-setup-guard'
import { DocumentBulkActions, DocumentDropOverlay, DocumentsEmpty, DocumentsList } from './list'
import { DocumentMetadataDrawer } from './metadata/drawer'
import {
  documentCanDownload,
  documentCanReindex,
  documentCanToggleAvailability,
  documentDisplayStatus,
  documentShowsAvailabilityAction,
  documentTitle,
  newestTaskByDocument,
  sourceName,
  taskCanRetry,
  taskNeedsAttention,
} from './model'
import { backgroundTaskFromApi, logicalDocumentListFromApi } from './models'
import {
  DOCUMENT_PERMISSION_DENIED,
  recoveryQueryMaskForPermissionDenials,
  SOURCE_PERMISSION_DENIED,
  TASK_PERMISSION_DENIED,
} from './permission-recovery'
import { documentSourcesInfiniteOptions, logicalDocumentsInfiniteOptions } from './queries'
import {
  documentFilterParser,
  documentMetadataParser,
  documentSearchParser,
  documentUploadParser,
} from './query-state'
import { responseStatus } from './request-error'
import { useAuxiliaryTaskReadGuard } from './tasks/auxiliary-read-guard'
import { ProcessingTasksDrawer } from './tasks/drawer'
import { TaskEventObserver } from './tasks/event-observer'
import { MAX_AUTO_CURSOR_PAGES, queryKeyMatchesKnowledgeSpace } from './tasks/recovery'
import { useTaskRuntime } from './tasks/use-task-runtime'
import { DocumentStagingCanceledError } from './upload/model'
import { useDocumentUploadSession } from './upload/use-document-upload-session'

const KNOWLEDGE_FS_BATCH_DOCUMENT_MAX_DOCUMENTS = 100

export function DocumentsPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const fileSizeLimitMb = useKnowledgeFileSizeLimit()
  const {
    beginUpload,
    completeUploads,
    discardAllStagedFiles,
    discardStagedFile,
    endUpload,
    prepareUploads,
    progress: stagedUploadProgress,
    resetProgress: resetUploadProgress,
    stageFiles,
    updateProgress: updateUploadProgress,
    uploading,
    uploadProgress,
  } = useDocumentUploadSession(knowledgeSpaceId)
  const queryClient = useQueryClient()
  const { refetch: refetchKnowledgeSpace, space } = useKnowledgeSpace()
  const datasetDefaultPermissionKeys = useAtomValue(datasetDefaultPermissionKeysAtom)
  const workspacePermissionKeysLoading = useAtomValue(workspacePermissionKeysLoadingAtom)
  const workspacePermissionKeysError = useAtomValue(workspacePermissionKeysErrorAtom)
  const uploadAvailable = useAtomValue(knowledgeFsUploadEnabledAtom)
  const canEdit = space.permission_keys.includes('knowledge_space_document_write')
  const hasDocumentDownloadPermission = hasPermission(
    datasetDefaultPermissionKeys,
    DatasetACLPermission.DocumentDownload,
  )
  const permissionPending = false
  const permissionQueryError = false
  const hasWorkspaceWritePermission = canEdit
  const canDownload =
    hasDocumentDownloadPermission &&
    !workspacePermissionKeysLoading &&
    !workspacePermissionKeysError
  const documentPermissionAlertRef = useRef<HTMLDivElement>(null)
  const writePermissionFocusRecoveryRequestedRef = useRef(false)
  const writePermissionFocusOriginRef = useRef<HTMLElement | null>(null)
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
  const [workspacePermissionKeysFetching, setWorkspacePermissionKeysFetching] = useState(false)
  const [writePermissionRecoveryGeneration, setWritePermissionRecoveryGeneration] = useState<
    number | undefined
  >()
  const previousCanEditRef = useRef(canEdit)
  useEffect(() => {
    const permissionRestored = !previousCanEditRef.current && canEdit
    previousCanEditRef.current = canEdit
    if (!writePermissionRevoked || !permissionRestored) return
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- An authoritative permission transition retires the local mutation lock.
    setWritePermissionRevoked(false)
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- The recovery generation belongs to the retired mutation lock.
    setWritePermissionRecoveryGeneration(undefined)
  }, [canEdit, writePermissionRevoked])
  const writePermissionDenialGenerationRef = useRef(0)
  const writePermissionRecoveryFetchSeenRef = useRef(false)
  const [blockingDependencyRetries, setBlockingDependencyRetries] = useState({
    sources: false,
    tasks: false,
  })
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

  const documentsQuery = useInfiniteQuery(logicalDocumentsInfiniteOptions(knowledgeSpaceId))
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
  const sourcesQuery = useInfiniteQuery(
    documentSourcesInfiniteOptions(knowledgeSpaceId, { enabled: !documentPermissionDenied }),
  )
  const sourcePermissionDenied = responseStatus(sourcesQuery.error) === 403
  const refreshDocuments = useCallback(() => {
    void queryClient.invalidateQueries({
      predicate: (query) => queryKeyMatchesKnowledgeSpace(query.queryKey, knowledgeSpaceId),
      queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get.key(),
    })
  }, [knowledgeSpaceId, queryClient])
  const notifyTaskFailed = useCallback(
    () => toast.error(t(($) => $['newKnowledge.taskFailedNotification'])),
    [t],
  )
  const {
    acceptTaskSnapshot: handleTaskUpdated,
    activeTasks,
    baseTasks,
    drawerTasks,
    handleTaskEvent,
    handleTaskEventCursor,
    handleTaskStreamPermissionDenied,
    observerGeneration,
    observerVersion,
    resetFailedPollBlocks,
    runtimeState: taskRuntimeState,
    streamedActiveTasks,
    taskPermissionDenied,
    taskProgressStore,
    tasks,
    tasksQuery,
  } = useTaskRuntime({
    auxiliaryTaskReadGuard,
    denyAuxiliaryTaskRead,
    documentPermissionDenied,
    externalPermissionDenied:
      documentPermissionDenied || auxiliaryReadPermissionDenied || sourcePermissionDenied,
    knowledgeSpaceId,
    onTaskFailed: notifyTaskFailed,
    onTaskReachedTerminal: refreshDocuments,
    tasksOpen,
  })
  const permissionDenialMask =
    (documentPermissionDenied || auxiliaryReadPermissionDenied ? DOCUMENT_PERMISSION_DENIED : 0) |
    (taskPermissionDenied ? TASK_PERMISSION_DENIED : 0) |
    (sourcePermissionDenied ? SOURCE_PERMISSION_DENIED : 0)
  const permissionDenied = permissionDenialMask !== 0
  const previousPermissionDenialMaskRef = useRef(permissionDenialMask)
  const permissionRecoveryQueryMaskRef = useRef(
    recoveryQueryMaskForPermissionDenials(permissionDenialMask),
  )
  const canWrite = hasWorkspaceWritePermission && !permissionDenied && !writePermissionRevoked
  const canUpload = canWrite && uploadAvailable
  const uploadFormOpen = canUpload && uploadRequest === '1'
  const openUploadForm = useCallback(
    (files: File[] = []) => {
      writePermissionFocusRecoveryRequestedRef.current = true
      writePermissionFocusOriginRef.current = document.activeElement as HTMLElement | null
      fileDragDepthRef.current = 0
      setIsFileDragActive(false)
      resetUploadProgress()
      setUploadFormInitialFiles(files)
      void setUploadRequest('1')
    },
    [resetUploadProgress, setUploadRequest],
  )
  const closeUploadForm = useCallback(() => {
    resetUploadProgress()
    setUploadFormInitialFiles([])
    void setUploadRequest(null)
  }, [resetUploadProgress, setUploadRequest])
  const cancelUploadForm = useCallback(() => {
    discardAllStagedFiles()
    closeUploadForm()
  }, [closeUploadForm, discardAllStagedFiles])
  useEffect(() => {
    if (uploadRequest !== '1' || permissionPending || canUpload) return
    discardAllStagedFiles()
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Consume the route-owned one-shot signal after authorization resolves.
    void setUploadRequest(null)
  }, [canUpload, discardAllStagedFiles, permissionPending, setUploadRequest, uploadRequest])
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
  const documents = useMemo(
    () =>
      documentsQuery.data?.pages.flatMap((page) => logicalDocumentListFromApi(page).items) ?? [],
    [documentsQuery.data],
  )
  const documentIds = useMemo(() => new Set(documents.map((document) => document.id)), [documents])
  const unresolvedTaskDocumentIds = useMemo(
    () =>
      new Set(
        baseTasks.flatMap((task) => (!documentIds.has(task.documentId) ? [task.documentId] : [])),
      ),
    [baseTasks, documentIds],
  )
  const sources = useMemo(
    () =>
      sourcesQuery.data?.pages.flatMap((page) =>
        page.data.map((source) => sourceFromApi(source)),
      ) ?? [],
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
    isFetchingNextDocumentPage || (hasRelevantNextSourcePage && isFetchingNextSourcePage),
  )
  const canAutoFetchSourcePage = Boolean(
    hasRelevantNextSourcePage && (sourcesQuery.data?.pages.length ?? 0) < MAX_AUTO_CURSOR_PAGES,
  )
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
  const taskResultsIncomplete = Boolean(!tasksQuery.data || tasksQuery.isPending)
  const filterActive = filter !== 'all' || Boolean(search.trim())
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
      taskResultsIncomplete ||
      selectedDocuments.some((document) => {
        const status = documentStatuses.get(document.id)
        return !status || !documentCanDownload(document, status)
      })
    )
      return []
    return selectedDocuments.map((document) => document.id)
  }, [bulkSelectionInvalid, documentStatuses, selectedDocuments, taskResultsIncomplete])
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
    (sourcesQuery.error && sourcesQuery.data) ||
    sourcesQuery.isFetchNextPageError,
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
  const taskQueryWarning = Boolean(tasksQuery.error && tasksQuery.data)
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
      resetFailedPollBlocks()
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
  }, [
    permissionDenialMask,
    permissionDenied,
    refetchSourcesQuery,
    refetchTasksQuery,
    resetFailedPollBlocks,
    tasksOpen,
  ])

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
      setWorkspacePermissionKeysFetching(true)
      try {
        const refreshedSpace = await refetchKnowledgeSpace()
        if (
          releaseWriteLockOnSuccess &&
          writePermissionDenialGenerationRef.current === denialGeneration &&
          refreshedSpace?.permission_keys.includes('knowledge_space_document_write')
        ) {
          writePermissionRecoveryFetchSeenRef.current = false
          setWritePermissionRevoked(false)
          setWritePermissionRecoveryGeneration(undefined)
        }
      } finally {
        setWorkspacePermissionKeysFetching(false)
      }
    },
    [refetchKnowledgeSpace],
  )

  const handleWritePermissionDenied = useCallback(() => {
    const denialGeneration = writePermissionDenialGenerationRef.current + 1
    writePermissionDenialGenerationRef.current = denialGeneration
    writePermissionRecoveryFetchSeenRef.current = false
    setWritePermissionRecoveryGeneration(undefined)
    setWritePermissionRevoked(true)
    setWorkspacePermissionKeysFetching(true)
    void refetchKnowledgeSpace()
      .then((refreshedSpace) => {
        if (writePermissionDenialGenerationRef.current !== denialGeneration) return
        if (refreshedSpace?.permission_keys.includes('knowledge_space_document_write')) {
          writePermissionRecoveryFetchSeenRef.current = false
          setWritePermissionRevoked(false)
          setWritePermissionRecoveryGeneration(undefined)
          return
        }
        setWritePermissionRecoveryGeneration(denialGeneration)
      })
      .finally(() => setWorkspacePermissionKeysFetching(false))
  }, [refetchKnowledgeSpace])

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
  }, [knowledgeSpaceId, permissionDenied, queryClient])

  const handleUploadFiles = useCallback(
    async (files: File[]): Promise<boolean> => {
      if (!canUpload || !files.length || !beginUpload()) return false
      const uploadableFiles: File[] = []
      const localExclusions: Array<{
        filename: string
        reasonKey: UploadExclusionReasonKey
      }> = []
      for (const file of files) {
        const issue = documentUploadIssue(file, fileSizeLimitMb)
        if (issue) localExclusions.push({ filename: file.name, reasonKey: issue })
        else uploadableFiles.push(file)
      }
      const formatExclusionDetails = (
        exclusions: Array<{ filename: string; reasonKey: UploadExclusionReasonKey }>,
      ) => {
        const detailItems = exclusions.slice(0, 3).map(({ filename, reasonKey }) => {
          const reason =
            reasonKey === 'fileSize'
              ? t(($) => $['newKnowledge.documentUploadExclusion.fileSize'], {
                  size: fileSizeLimitMb,
                })
              : t(($) => $[`newKnowledge.documentUploadExclusion.${reasonKey}`])
          return `${filename} (${reason})`
        })
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
        endUpload()
        return false
      }
      let writePermissionDenied = false
      try {
        if ((await ensureModelReady({ capability: 'ingest', intent: 'upload' })).status !== 'ready')
          return false
        let acceptedCount = 0
        const exclusions = [...localExclusions]
        await stageFiles(uploadableFiles)
        const uploads = prepareUploads(uploadableFiles)
        await uploadKnowledgeFsDocuments(
          knowledgeSpaceId,
          uploads,
          uploadProgress,
          updateUploadProgress,
        )
        completeUploads()
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
        endUpload()
      }
    },
    [
      beginUpload,
      canUpload,
      cancelUploadForm,
      completeUploads,
      endUpload,
      ensureModelReady,
      fileSizeLimitMb,
      handleWritePermissionDenied,
      knowledgeSpaceId,
      prepareUploads,
      refreshDocumentsAndTasks,
      stageFiles,
      t,
      updateUploadProgress,
      uploadProgress,
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
      if (
        taskResultsIncomplete ||
        !currentDocument ||
        !status ||
        !documentCanDownload(currentDocument, status)
      )
        return false
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
    [canDownload, documentStatuses, documents, knowledgeSpaceId, taskResultsIncomplete, tCommon],
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
    if (tasksQuery.error || taskQueryBlockingError) void tasksQuery.refetch()
    if (sourcesQuery.isFetchNextPageError) void sourcesQuery.fetchNextPage()
    else if (sourcesQuery.error || sourceQueryBlockingError) void sourcesQuery.refetch()
  }

  const loadMoreResults = () => {
    const requests: Promise<unknown>[] = []
    if (hasNextDocumentPage && !isFetchingNextDocumentPage) requests.push(fetchNextDocumentPage())
    if (hasRelevantNextSourcePage && !isFetchingNextSourcePage) requests.push(fetchNextSourcePage())
    void Promise.allSettled(requests)
  }

  return (
    <>
      {streamedActiveTasks.map((task) => {
        const taskObserverVersion = observerVersion(task)
        return (
          <TaskEventObserver
            key={`${task.id}:${observerGeneration(task.id)}`}
            documentId={task.documentId}
            knowledgeSpaceId={knowledgeSpaceId}
            lastEventId={taskRuntimeState.eventCursors.get(task.id)}
            onEvent={handleTaskEvent}
            onLastEventIdChange={handleTaskEventCursor}
            onPermissionDenied={handleTaskStreamPermissionDenied}
            taskId={task.id}
            taskVersion={taskObserverVersion}
          />
        )
      })}
      <section
        ref={documentsSectionRef}
        className={cn(
          'relative flex min-h-full w-full flex-col gap-4 px-6 pt-3',
          bulkActionsVisible ? 'pb-[calc(7rem+env(safe-area-inset-bottom,0px))]' : 'pb-6',
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
            fileSizeLimitMb={fileSizeLimitMb}
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
            hasNextPage={Boolean(hasNextDocumentPage || hasRelevantNextSourcePage)}
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
        {isFileDragActive && canUpload && <DocumentDropOverlay fileSizeLimitMb={fileSizeLimitMb} />}
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
