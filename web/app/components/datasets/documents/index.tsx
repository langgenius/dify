'use client'

import type { FC } from 'react'
import { keepPreviousData, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { toCreationDataSourceType } from '@/app/components/datasets/dataset-fields'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { DataSourceType } from '@/models/datasets'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { getDatasetACLCapabilities } from '@/utils/permission'
import useEditDocumentMetadata from '../metadata/hooks/use-edit-dataset-metadata'
import DocumentsHeader from './components/documents-header'
import EmptyElement from './components/empty-element'
import List from './components/list'
import { useDocumentsPageState } from './hooks/use-documents-page-state'
import { toDocumentListQuery } from './status-filter'

type IDocumentsProps = {
  datasetId: string
}

const POLLING_INTERVAL = 2500
const TERMINAL_INDEXING_STATUSES = new Set(['completed', 'paused', 'error'])
const FORCED_POLLING_STATUSES = new Set(['queuing', 'indexing'])

const Documents: FC<IDocumentsProps> = ({ datasetId }) => {
  const router = useRouter()

  const dataset = useDatasetDetailContextWithSelector((s) => s.dataset)
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const embeddingAvailable = !!dataset?.embedding_available
  const datasetACLCapabilities = getDatasetACLCapabilities(dataset?.permission_keys, {
    currentUserId,
    resourceMaintainer: dataset?.maintainer,
    workspacePermissionKeys,
  })

  // Use custom hook for page state management
  const {
    inputValue,
    debouncedSearchValue,
    handleInputChange,
    statusFilterValue,
    sortValue,
    normalizedStatusFilterValue,
    handleStatusFilterChange,
    handleStatusFilterClear,
    handleSortChange,
    currPage,
    limit,
    handlePageChange,
    handleLimitChange,
    selectedIds,
    selectedDocuments,
    updateSelectedDocuments,
    removeSelectedDocuments,
    clearSelectedDocuments,
  } = useDocumentsPageState()

  // Fetch document list
  const { data: documentsRes, isLoading: isListLoading } = useQuery(
    consoleQuery.datasets.byDatasetId.documents.get.queryOptions({
      input: {
        params: { dataset_id: datasetId },
        query: toDocumentListQuery({
          page: currPage + 1,
          limit,
          keyword: debouncedSearchValue,
          status: normalizedStatusFilterValue,
          sort: sortValue,
        }),
      },
      placeholderData: keepPreviousData,
      refetchInterval: (query) => {
        const shouldForcePolling =
          normalizedStatusFilterValue !== 'all' &&
          FORCED_POLLING_STATUSES.has(normalizedStatusFilterValue)
        const documents = query.state.data?.data
        if (!documents) return POLLING_INTERVAL
        const hasIncompleteDocuments = documents.some(
          ({ indexing_status }) => !TERMINAL_INDEXING_STATUSES.has(indexing_status ?? ''),
        )
        return shouldForcePolling || hasIncompleteDocuments ? POLLING_INTERVAL : false
      },
    }),
  )

  // Invalidation hooks
  const queryClient = useQueryClient()
  const invalidDocumentList = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: consoleQuery.datasets.byDatasetId.documents.get.key({
          input: { params: { dataset_id: datasetId } },
        }),
      }),
    [queryClient, datasetId],
  )

  const handleUpdate = useCallback(() => {
    invalidDocumentList()
    queryClient.invalidateQueries({
      queryKey: consoleQuery.datasets.byDatasetId.documents.byDocumentId.get.key(),
    })
    setTimeout(() => {
      const params = { dataset_id: datasetId }
      queryClient.invalidateQueries({
        queryKey: consoleQuery.datasets.byDatasetId.documents.byDocumentId.segments.get.key({
          input: { params },
        }),
      })
      queryClient.invalidateQueries({
        queryKey:
          consoleQuery.datasets.byDatasetId.documents.byDocumentId.segments.bySegmentId.childChunks.get.key(
            { input: { params } },
          ),
      })
    }, 5000)
  }, [queryClient, datasetId, invalidDocumentList])

  // Metadata editing hook
  const {
    isShowEditModal: isShowEditMetadataModal,
    showEditModal: showEditMetadataModal,
    hideEditModal: hideEditMetadataModal,
    datasetMetaData,
    handleAddMetaData,
    handleRename,
    handleDeleteMetaData,
    builtInEnabled,
    setBuiltInEnabled,
    builtInMetaData,
  } = useEditDocumentMetadata({
    datasetId,
    dataset,
    onUpdateDocList: invalidDocumentList,
  })

  // Route to document creation page
  const routeToDocCreate = useCallback(() => {
    if (!datasetACLCapabilities.canUse) return
    if (dataset?.runtime_mode === 'rag_pipeline') {
      router.push(`/datasets/${datasetId}/documents/create-from-pipeline`)
      return
    }
    router.push(`/datasets/${datasetId}/documents/create`)
  }, [dataset?.runtime_mode, datasetACLCapabilities.canUse, datasetId, router])

  const total = documentsRes?.total || 0
  const documentsList = documentsRes?.data
  const handleSelectedIdChange = useCallback(
    (nextSelectedIds: string[]) => updateSelectedDocuments(documentsList ?? [], nextSelectedIds),
    [documentsList, updateSelectedDocuments],
  )

  // Render content based on loading and data state
  const renderContent = () => {
    if (isListLoading && !documentsRes) return <LoadingPlaceholder className="h-full" />

    if (total > 0) {
      return (
        <List
          embeddingAvailable={embeddingAvailable}
          documents={documentsList || []}
          datasetId={datasetId}
          onUpdate={handleUpdate}
          selectedIds={selectedIds}
          selectedDocuments={selectedDocuments}
          onSelectedIdChange={handleSelectedIdChange}
          onRemoveSelectedDocuments={removeSelectedDocuments}
          onClearSelection={clearSelectedDocuments}
          remoteSortValue={sortValue}
          onSortChange={handleSortChange}
          pagination={{
            total,
            limit,
            onLimitChange: handleLimitChange,
            current: currPage,
            onChange: handlePageChange,
          }}
          onManageMetadata={showEditMetadataModal}
        />
      )
    }

    const isDataSourceNotion = dataset?.data_source_type === DataSourceType.NOTION
    return (
      <EmptyElement
        canAdd={embeddingAvailable && datasetACLCapabilities.canUse}
        onClick={routeToDocCreate}
        type={isDataSourceNotion ? 'sync' : 'upload'}
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <DocumentsHeader
        datasetId={datasetId}
        dataSourceType={toCreationDataSourceType(dataset?.data_source_type)}
        embeddingAvailable={embeddingAvailable}
        canManageMetadata={datasetACLCapabilities.canEdit}
        canAddDocument={datasetACLCapabilities.canUse}
        canEditDocument={datasetACLCapabilities.canEdit}
        statusFilterValue={statusFilterValue}
        sortValue={sortValue}
        inputValue={inputValue}
        onStatusFilterChange={handleStatusFilterChange}
        onStatusFilterClear={handleStatusFilterClear}
        onSortChange={handleSortChange}
        onInputChange={handleInputChange}
        isShowEditMetadataModal={isShowEditMetadataModal}
        showEditMetadataModal={showEditMetadataModal}
        hideEditMetadataModal={hideEditMetadataModal}
        datasetMetaData={datasetMetaData}
        builtInMetaData={builtInMetaData}
        builtInEnabled={!!builtInEnabled}
        onAddMetaData={handleAddMetaData}
        onRenameMetaData={handleRename}
        onDeleteMetaData={handleDeleteMetaData}
        onBuiltInEnabledChange={setBuiltInEnabled}
        onAddDocument={routeToDocCreate}
      />
      <div className="flex h-0 grow flex-col px-6 pt-4">{renderContent()}</div>
    </div>
  )
}

export default Documents
