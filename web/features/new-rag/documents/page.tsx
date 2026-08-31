'use client'

import { toast } from '@langgenius/dify-ui/toast'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useQueryState } from 'nuqs'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  datasetDefaultPermissionKeysAtom,
  workspacePermissionKeysErrorAtom,
  workspacePermissionKeysLoadingAtom,
} from '@/context/permission-state'
import { consoleQuery } from '@/service/client'
import { DatasetACLPermission, hasPermission } from '@/utils/permission'
import { KnowledgeModelSetupDialog } from '../components/knowledge-model-setup-dialog'
import { sourceFromApi } from '../sources/source-models'
import { useKnowledgeModelSetupGuard } from '../use-knowledge-model-setup-guard'
import { DocumentMetadataDrawer } from './metadata/drawer'
import { logicalDocumentListFromApi } from './models'
import { useDocumentPermissionRecovery } from './permission-recovery/use-permission-recovery'
import { documentSourcesInfiniteOptions, logicalDocumentsInfiniteOptions } from './queries'
import { documentMetadataParser } from './query-state'
import { responseStatus } from './request-error'
import { DocumentResultsSurface } from './results/surface'
import { useAuxiliaryTaskReadGuard } from './tasks/auxiliary-read-guard'
import { ProcessingTasksDrawer } from './tasks/drawer'
import { TaskEventObserver } from './tasks/event-observer'
import { queryKeyMatchesKnowledgeSpace } from './tasks/recovery'
import { useTaskRuntime } from './tasks/use-task-runtime'

export function DocumentsPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')
  const queryClient = useQueryClient()
  const datasetDefaultPermissionKeys = useAtomValue(datasetDefaultPermissionKeysAtom)
  const workspacePermissionKeysLoading = useAtomValue(workspacePermissionKeysLoadingAtom)
  const workspacePermissionKeysError = useAtomValue(workspacePermissionKeysErrorAtom)
  const hasDocumentDownloadPermission = hasPermission(
    datasetDefaultPermissionKeys,
    DatasetACLPermission.DocumentDownload,
  )
  const canDownload =
    hasDocumentDownloadPermission &&
    !workspacePermissionKeysLoading &&
    !workspacePermissionKeysError
  const [metadataRequest, setMetadataRequest] = useQueryState('metadata', documentMetadataParser)
  const metadataOpen = metadataRequest === '1'
  const setMetadataOpen = useCallback(
    (open: boolean) => {
      void setMetadataRequest(open ? '1' : null)
    },
    [setMetadataRequest],
  )
  const [tasksOpen, setTasksOpen] = useState(false)
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
  const taskRuntime = useTaskRuntime({
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
  const {
    acceptTaskSnapshot: handleTaskUpdated,
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
    tasksQuery,
  } = taskRuntime
  const refetchTasksQuery = tasksQuery.refetch
  const refetchSourcesQuery = sourcesQuery.refetch
  const {
    canRead,
    canWrite,
    denyWrite: handleWritePermissionDenied,
    recoverySurface,
    retryWorkspacePermission,
    workspacePermissionRefreshing,
  } = useDocumentPermissionRecovery({
    auxiliaryReadPermissionDenied,
    documentPermissionDenied,
    knowledgeSpaceId,
    onRetryAuxiliaryRead: retryAuxiliaryTaskRead,
    refetchSources: refetchSourcesQuery,
    refetchTasks: refetchTasksQuery,
    resetFailedPollBlocks,
    sourcePermissionDenied,
    taskPermissionDenied,
  })
  const uploadPermission = useMemo(
    () => ({ canRead, canWrite, denyWrite: handleWritePermissionDenied }),
    [canRead, canWrite, handleWritePermissionDenied],
  )
  const {
    fetchNextPage: fetchNextDocumentPage,
    hasNextPage: hasNextDocumentPage,
    isFetchingNextPage: isFetchingNextDocumentPage,
  } = documentsQuery
  const {
    fetchNextPage: fetchNextTaskPage,
    hasNextPage: hasNextTaskPage,
    isFetchingNextPage: isFetchingNextTaskPage,
  } = tasksQuery
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
  const handleReadPermissionDenied = useCallback(() => {
    setTasksOpen(false)
    setMetadataOpen(false)
  }, [setMetadataOpen])

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
      <DocumentResultsSurface
        canDownload={canDownload}
        ensureModelReady={ensureModelReady}
        knowledgeSpaceId={knowledgeSpaceId}
        metadataOpen={metadataOpen}
        onOpenMetadata={() => setMetadataOpen(true)}
        onOpenTasks={() => setTasksOpen(true)}
        onReadDenied={handleReadPermissionDenied}
        permission={uploadPermission}
        recoverySurface={recoverySurface}
        taskRuntime={taskRuntime}
        tasksOpen={tasksOpen}
      />
      <ProcessingTasksDrawer
        actionResultsValid={canRead}
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
        onRetryPermissionQuery={() => void retryWorkspacePermission()}
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
        open={tasksOpen && canRead}
        permissionQueryError={false}
        permissionQueryFetching={workspacePermissionRefreshing}
        permissionQueryPending={false}
        readOnlyReason={
          canWrite ? undefined : t(($) => $['newKnowledge.documentPermissionRestricted'])
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
        open={metadataOpen && canRead}
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
