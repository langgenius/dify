'use client'
import type { FC } from 'react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect } from 'react'
import Loading from '@/app/components/base/loading'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useProviderContext } from '@/context/provider-context'
import { DataSourceType } from '@/models/datasets'
import { useDocumentList, useInvalidDocumentDetail, useInvalidDocumentList } from '@/service/knowledge/use-document'
import { useChildSegmentListKey, useSegmentListKey } from '@/service/knowledge/use-segment'
import { useInvalid } from '@/service/use-base'
import useEditDocumentMetadata from '../metadata/hooks/use-edit-dataset-metadata'
import DocumentsHeader from './components/documents-header'
import EmptyElement from './components/empty-element'
import List from './components/list'
import useDocumentsPageState from './hooks/use-documents-page-state'

type IDocumentsProps = {
  datasetId: string
}

const Documents: FC<IDocumentsProps> = ({ datasetId }) => {
  const router = useRouter()
  const { plan } = useProviderContext()
  const isFreePlan = plan.type === 'sandbox'

  const dataset = useDatasetDetailContextWithSelector(s => s.dataset)
  const embeddingAvailable = !!dataset?.embedding_available

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
    timerCanRun,
    updatePollingState,
    adjustPageForTotal,
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
    refetchInterval: timerCanRun ? 2500 : 0,
  })

  // Update polling state when documents change
  useEffect(() => {
    updatePollingState(documentsRes)
  }, [documentsRes, updatePollingState])

  // Adjust page when total changes
  useEffect(() => {
    adjustPageForTotal(documentsRes)
  }, [documentsRes, adjustPageForTotal])

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

  // Route to document creation page
  const routeToDocCreate = useCallback(() => {
    if (dataset?.runtime_mode === 'rag_pipeline') {
      router.push(`/datasets/${datasetId}/documents/create-from-pipeline`)
      return
    }
    router.push(`/datasets/${datasetId}/documents/create`)
  }, [dataset?.runtime_mode, datasetId, router])

  const total = documentsRes?.total || 0
  const documentsList = documentsRes?.data

  // Render content based on loading and data state
  const renderContent = () => {
    if (isListLoading)
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
          statusFilterValue={normalizedStatusFilterValue}
          remoteSortValue={sortValue}
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
        canAdd={embeddingAvailable}
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
        onAddDocument={routeToDocCreate}
      />
      <div className="flex h-0 grow flex-col px-6 pt-4">
        {renderContent()}
      </div>
    </div>
  )
}

export default Documents
