'use client'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@langgenius/dify-ui/toast'
import Loading from '@/app/components/base/loading'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useProviderContext } from '@/context/provider-context'
import { DataSourceType } from '@/models/datasets'
import { useRouter } from '@/next/navigation'
import { useBatchSyncNotion, useBatchSyncWebsite, useDocumentList, useInvalidDocumentDetail, useInvalidDocumentList } from '@/service/knowledge/use-document'
import { useChildSegmentListKey, useSegmentListKey } from '@/service/knowledge/use-segment'
import { useInvalid } from '@/service/use-base'
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

  const dataset = useDatasetDetailContextWithSelector(s => s.dataset)
  const currentUserId = useAppContextWithSelector(state => state.userProfile?.id)
  const workspacePermissionKeys = useAppContextWithSelector(state => state.workspacePermissionKeys)
  const embeddingAvailable = !!dataset?.embedding_available
  const datasetACLCapabilities = getDatasetACLCapabilities(dataset?.permission_keys, {
    currentUserId,
    resourceMaintainer: dataset?.maintainer ?? dataset?.created_by,
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
      const shouldForcePolling = normalizedStatusFilterValue !== 'all'
        && FORCED_POLLING_STATUSES.has(normalizedStatusFilterValue)
      const documents = query.state.data?.data
      if (!documents)
        return POLLING_INTERVAL
      const hasIncompleteDocuments = documents.some(({ indexing_status }) => !TERMINAL_INDEXING_STATUSES.has(indexing_status))
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

  const { mutateAsync: batchSyncNotion } = useBatchSyncNotion()
  const { mutateAsync: batchSyncWebsite } = useBatchSyncWebsite()
  const [isSyncingAll, setIsSyncingAll] = useState(false)
  const documentsListRef = useRef(documentsList)
  useEffect(() => { documentsListRef.current = documentsList }, [documentsList])

  const handleSyncAll = useCallback(async () => {
    setIsSyncingAll(true)
    try {
      const calls = []
      if (dataset?.data_source_type === DataSourceType.NOTION)
        calls.push(batchSyncNotion({ datasetId }))
      else if (dataset?.data_source_type === DataSourceType.WEB)
        calls.push(batchSyncWebsite({ datasetId }))
      else {
        calls.push(batchSyncNotion({ datasetId }))
        calls.push(batchSyncWebsite({ datasetId }))
      }
      const results = await Promise.allSettled(calls)
      if (results.some(r => r.status === 'rejected')) {
        toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
        return
      }

      // Poll until all documents reach a terminal state (or 5-min timeout)
      const startTime = Date.now()
      const MAX_WAIT_MS = 300_000
      const MIN_WAIT_MS = 3_000  // give Celery workers time to pick up tasks

      await new Promise<void>((resolve) => {
        const poll = () => {
          invalidDocumentList()
          setTimeout(() => {
            const elapsed = Date.now() - startTime
            if (elapsed > MAX_WAIT_MS) { resolve(); return }

            const docs = documentsListRef.current ?? []
            const allTerminal = docs.length === 0
              || docs.every(d => TERMINAL_INDEXING_STATUSES.has(d.indexing_status))

            if (allTerminal && elapsed >= MIN_WAIT_MS)
              resolve()
            else
              poll()
          }, POLLING_INTERVAL)
        }
        poll()
      })

      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
    }
    finally {
      setIsSyncingAll(false)
    }
  }, [batchSyncNotion, batchSyncWebsite, dataset?.data_source_type, datasetId, invalidDocumentList, t])

  // Route to document creation page
  const routeToDocCreate = useCallback(() => {
    if (!datasetACLCapabilities.canUse)
      return
    if (dataset?.runtime_mode === 'rag_pipeline') {
      router.push(`/datasets/${datasetId}/documents/create-from-pipeline`)
      return
    }
    router.push(`/datasets/${datasetId}/documents/create`)
  }, [dataset?.runtime_mode, datasetACLCapabilities.canUse, datasetId, router])

  // Render content based on loading and data state
  const renderContent = () => {
    if (isListLoading && !documentsRes)
      return <Loading type="app" />

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
      <div className="flex h-0 grow flex-col px-6 pt-4">
        {renderContent()}
      </div>
    </div>
  )
}

export default Documents
