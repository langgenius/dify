'use client'
import type { FC } from 'react'
import type { Props as PaginationProps } from '@/app/components/base/pagination'
import type { SimpleDocumentDetail } from '@/models/datasets'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Checkbox from '@/app/components/base/checkbox'
import Pagination from '@/app/components/base/pagination'
import EditMetadataBatchModal from '@/app/components/datasets/metadata/edit-metadata-batch/modal'
import useBatchEditDocumentMetadata from '@/app/components/datasets/metadata/hooks/use-batch-edit-document-metadata'
import { useDatasetDetailContextWithSelector as useDatasetDetailContext } from '@/context/dataset-detail'
import { ChunkingMode, DocumentActionType } from '@/models/datasets'
import BatchAction from '../detail/completed/common/batch-action'
import s from '../style.module.css'
import { DocumentTableRow, renderTdValue, SortHeader } from './document-list/components'
import { useDocumentActions, useDocumentSelection, useDocumentSort } from './document-list/hooks'
import RenameModal from './rename-modal'

type LocalDoc = SimpleDocumentDetail & { percent?: number }

type DocumentListProps = {
  embeddingAvailable: boolean
  documents: LocalDoc[]
  selectedIds: string[]
  onSelectedIdChange: (selectedIds: string[]) => void
  datasetId: string
  pagination: PaginationProps
  onUpdate: () => void
  onManageMetadata: () => void
  statusFilterValue: string
  remoteSortValue: string
}

/**
 * Document list component including basic information
 */
const DocumentList: FC<DocumentListProps> = ({
  embeddingAvailable,
  documents = [],
  selectedIds,
  onSelectedIdChange,
  datasetId,
  pagination,
  onUpdate,
  onManageMetadata,
  statusFilterValue,
  remoteSortValue,
}) => {
  const { t } = useTranslation()
  const datasetConfig = useDatasetDetailContext(s => s.dataset)
  const chunkingMode = datasetConfig?.doc_form
  const isGeneralMode = chunkingMode !== ChunkingMode.parentChild
  const isQAMode = chunkingMode === ChunkingMode.qa

  // Sorting
  const { sortField, sortOrder, handleSort, sortedDocuments } = useDocumentSort({
    documents,
    statusFilterValue,
    remoteSortValue,
  })

  // Selection
  const {
    isAllSelected,
    isSomeSelected,
    onSelectAll,
    onSelectOne,
    hasErrorDocumentsSelected,
    downloadableSelectedIds,
    clearSelection,
  } = useDocumentSelection({
    documents: sortedDocuments,
    selectedIds,
    onSelectedIdChange,
  })

  // Actions
  const { handleAction, handleBatchReIndex, handleBatchDownload } = useDocumentActions({
    datasetId,
    selectedIds,
    downloadableSelectedIds,
    onUpdate,
    onClearSelection: clearSelection,
  })

  // Batch edit metadata
  const {
    isShowEditModal,
    showEditModal,
    hideEditModal,
    originalList,
    handleSave,
  } = useBatchEditDocumentMetadata({
    datasetId,
    docList: documents.filter(doc => selectedIds.includes(doc.id)),
    selectedDocumentIds: selectedIds,
    onUpdate,
  })

  // Rename modal
  const [currDocument, setCurrDocument] = useState<LocalDoc | null>(null)
  const [isShowRenameModal, {
    setTrue: setShowRenameModalTrue,
    setFalse: setShowRenameModalFalse,
  }] = useBoolean(false)

  const handleShowRenameModal = useCallback((doc: LocalDoc) => {
    setCurrDocument(doc)
    setShowRenameModalTrue()
  }, [setShowRenameModalTrue])

  const handleRenamed = useCallback(() => {
    onUpdate()
  }, [onUpdate])

  return (
    <div className="relative mt-3 flex h-full w-full flex-col">
      <div className="relative h-0 grow overflow-x-auto">
        <table className={`w-full min-w-[700px] max-w-full border-collapse border-0 text-sm ${s.documentTable}`}>
          <thead className="h-8 border-b border-divider-subtle text-xs font-medium uppercase leading-8 text-text-tertiary">
            <tr>
              <td className="w-12">
                <div className="flex items-center" onClick={e => e.stopPropagation()}>
                  {embeddingAvailable && (
                    <Checkbox
                      className="mr-2 shrink-0"
                      checked={isAllSelected}
                      indeterminate={!isAllSelected && isSomeSelected}
                      onCheck={onSelectAll}
                    />
                  )}
                  #
                </div>
              </td>
              <td>
                <SortHeader
                  field="name"
                  label={t('list.table.header.fileName', { ns: 'datasetDocuments' })}
                  currentSortField={sortField}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
              </td>
              <td className="w-[130px]">{t('list.table.header.chunkingMode', { ns: 'datasetDocuments' })}</td>
              <td className="w-24">
                <SortHeader
                  field="word_count"
                  label={t('list.table.header.words', { ns: 'datasetDocuments' })}
                  currentSortField={sortField}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
              </td>
              <td className="w-44">
                <SortHeader
                  field="hit_count"
                  label={t('list.table.header.hitCount', { ns: 'datasetDocuments' })}
                  currentSortField={sortField}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
              </td>
              <td className="w-44">
                <SortHeader
                  field="created_at"
                  label={t('list.table.header.uploadTime', { ns: 'datasetDocuments' })}
                  currentSortField={sortField}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
              </td>
              <td className="w-40">{t('list.table.header.status', { ns: 'datasetDocuments' })}</td>
              <td className="w-20">{t('list.table.header.action', { ns: 'datasetDocuments' })}</td>
            </tr>
          </thead>
          <tbody className="text-text-secondary">
            {sortedDocuments.map((doc, index) => (
              <DocumentTableRow
                key={doc.id}
                doc={doc}
                index={index}
                datasetId={datasetId}
                isSelected={selectedIds.includes(doc.id)}
                isGeneralMode={isGeneralMode}
                isQAMode={isQAMode}
                embeddingAvailable={embeddingAvailable}
                selectedIds={selectedIds}
                onSelectOne={onSelectOne}
                onSelectedIdChange={onSelectedIdChange}
                onShowRenameModal={handleShowRenameModal}
                onUpdate={onUpdate}
              />
            ))}
          </tbody>
        </table>
      </div>

      {selectedIds.length > 0 && (
        <BatchAction
          className="absolute bottom-16 left-0 z-20"
          selectedIds={selectedIds}
          onArchive={handleAction(DocumentActionType.archive)}
          onBatchSummary={handleAction(DocumentActionType.summary)}
          onBatchEnable={handleAction(DocumentActionType.enable)}
          onBatchDisable={handleAction(DocumentActionType.disable)}
          onBatchDownload={downloadableSelectedIds.length > 0 ? handleBatchDownload : undefined}
          onBatchDelete={handleAction(DocumentActionType.delete)}
          onEditMetadata={showEditModal}
          onBatchReIndex={hasErrorDocumentsSelected ? handleBatchReIndex : undefined}
          onCancel={clearSelection}
        />
      )}

      {!!pagination.total && (
        <Pagination
          {...pagination}
          className="w-full shrink-0"
        />
      )}

      {isShowRenameModal && currDocument && (
        <RenameModal
          datasetId={datasetId}
          documentId={currDocument.id}
          name={currDocument.name}
          onClose={setShowRenameModalFalse}
          onSaved={handleRenamed}
        />
      )}

      {isShowEditModal && (
        <EditMetadataBatchModal
          datasetId={datasetId}
          documentNum={selectedIds.length}
          list={originalList}
          onSave={handleSave}
          onHide={hideEditModal}
          onShowManage={() => {
            hideEditModal()
            onManageMetadata()
          }}
        />
      )}
    </div>
  )
}

export default DocumentList

export { renderTdValue }
