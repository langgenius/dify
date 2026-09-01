'use client'

import type { FC } from 'react'
import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useProviderContext } from '@/context/provider-context'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { DataSourceType } from '@/models/datasets'
import { useRouter } from '@/next/navigation'
import {
  useBatchSyncNotion,
  useBatchSyncWebsite,
  useDocumentList,
  useInvalidDocumentDetail,
  useInvalidDocumentList,
} from '@/service/knowledge/use-document'
import { useChildSegmentListKey, useSegmentListKey } from '@/service/knowledge/use-segment'
import { useInvalid } from '@/service/use-base'
import { asyncRunSafe } from '@/utils'
import { getDatasetACLCapabilities } from '@/utils/permission'
import useEditDocumentMetadata from '../metadata/hooks/use-edit-dataset-metadata'
import DocumentsHeader from './components/documents-header'
import EmptyElement from './components/empty-element'
import List from './components/list'
import { useDocumentsPageState } from './hooks/use-documents-page-state'

type IDocumentsProps = {
  datasetId: string
}

const POLLING_INTERVAL = 2500
const TERMINAL_INDEXING_STATUSES = new Set(['completed', 'paused', 'error'])
const FORCED_POLLING_STATUSES = new Set(['queuing', 'indexing', 'paused'])

const Documents: FC<IDocumentsProps> = ({ datasetId }) => {
  const router = useRouter()
  const { t } = useTranslation()
  const { plan } = useProviderContext()
  const isFreePlan = plan.type === 'sandbox'

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
    setSelectedIds,
  } = useDocumentsPageState()

  // Fetch document list
  const { data: documentsRes, isLoading: isListLoading } = useDocumentList({
    datasetId,
    query: {
      page: currPage + 1,
      limit,
      keyword: debouncedSearchValue,
      status: normalizedStatusFilterValue,
      sort: sortValue,
    },
    refetchInterval: (query) => {
      const shouldForcePolling =
        normalizedStatusFilterValue !== 'all' &&
        FORCED_POLLING_STATUSES.has(normalizedStatusFilterValue)
      const documents = query.state.data?.data
      if (!documents) return POLLING_INTERVAL
      const hasIncompleteDocuments = documents.some(
        ({ indexing_status }) => !TERMINAL_INDEXING_STATUSES.has(indexing_status),
      )
      return shouldForcePolling || hasIncompleteDocuments ? POLLING_INTERVAL : false
    },
  })

  // Invalidation hooks
  const invalidDocumentList = useInvalidDocumentList(datasetId)
  const invalidDocumentDetail = useInvalidDocumentDetail()
  const invalidChunkList = useInvalid(useSegmentListKey)
  const invalidChildChunkList = useInvalid(useChildSegmentListKey)

  const handleUpdate = useCallback(() => {
    invalidDocumentList()
    invalidDocumentDetail()
    setTimeout(() => {
      invalidChunkList()
      invalidChildChunkList()
    }, 5000)
  }, [invalidDocumentList, invalidDocumentDetail, invalidChunkList, invalidChildChunkList])

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

  const total = documentsRes?.total || 0
  const documentsList = documentsRes?.data

  const { mutateAsync: batchSyncNotion, isPending: isSyncingNotion } = useBatchSyncNotion()
  const { mutateAsync: batchSyncWebsite, isPending: isSyncingWebsite } = useBatchSyncWebsite()
  const isSyncingAll = isSyncingNotion || isSyncingWebsite

  const handleSyncAll = useCallback(async () => {
    const isNotion = dataset?.data_source_type === DataSourceType.NOTION
    const isWebsite = dataset?.data_source_type === DataSourceType.WEB
    // The Sync All button is only rendered for Notion/website knowledge bases.
    if (!isNotion && !isWebsite) return

    const [e] = await asyncRunSafe(
      isNotion ? batchSyncNotion({ datasetId }) : batchSyncWebsite({ datasetId }),
    )
    if (e) {
      toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
      return
    }

    // The request only queues the sync; the work happens on Celery workers. Refresh once so the
    // documents flip out of a terminal status, after which the list's own refetch interval
    // (see useDocumentList above) reports per-document progress until everything settles.
    invalidDocumentList()
    toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
  }, [
    batchSyncNotion,
    batchSyncWebsite,
    dataset?.data_source_type,
    datasetId,
    invalidDocumentList,
    t,
  ])

  // Route to document creation page
  const routeToDocCreate = useCallback(() => {
    if (!datasetACLCapabilities.canUse) return
    if (dataset?.runtime_mode === 'rag_pipeline') {
      router.push(`/datasets/${datasetId}/documents/create-from-pipeline`)
      return
    }
    router.push(`/datasets/${datasetId}/documents/create`)
  }, [dataset?.runtime_mode, datasetACLCapabilities.canUse, datasetId, router])

  // Render content based on loading and data state
  const renderContent = () => {
    if (isListLoading && !documentsRes) return <Loading type="app" />

    if (total > 0) {
      return (
        <List
          embeddingAvailable={embeddingAvailable}
          documents={documentsList || []}
          datasetId={datasetId}
          onUpdate={handleUpdate}
          selectedIds={selectedIds}
          onSelectedIdChange={setSelectedIds}
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
        dataSourceType={dataset?.data_source_type}
        embeddingAvailable={embeddingAvailable}
        canManageMetadata={datasetACLCapabilities.canEdit}
        canAddDocument={datasetACLCapabilities.canUse}
        canEditDocument={datasetACLCapabilities.canEdit}
        isFreePlan={isFreePlan}
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
        onSyncAll={datasetACLCapabilities.canEdit ? handleSyncAll : undefined}
        isSyncingAll={isSyncingAll}
        onAddDocument={routeToDocCreate}
      />
      <div className="flex h-0 grow flex-col px-6 pt-4">{renderContent()}</div>
    </div>
  )
}

export default Documents
