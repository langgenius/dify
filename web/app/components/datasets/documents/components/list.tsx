'use client'
import type { SimpleDocumentDetail } from '@/models/datasets'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
import { Pagination } from '@langgenius/dify-ui/pagination'
import { useBoolean } from 'ahooks'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDatasetACLCapabilities } from '@/app/components/datasets/hooks/use-dataset-access'
import EditMetadataBatchModal from '@/app/components/datasets/metadata/edit-metadata-batch/modal'
import useBatchEditDocumentMetadata from '@/app/components/datasets/metadata/hooks/use-batch-edit-document-metadata'
import { useDatasetDetailContextWithSelector as useDatasetDetailContext } from '@/context/dataset-detail'
import { ChunkingMode, DocumentActionType } from '@/models/datasets'
import BatchAction from '../detail/completed/common/batch-action'
import s from '../style.module.css'
import { DocumentTableRow, SortHeader } from './document-list/components'
import { useDocumentActions, useDocumentSelection, useDocumentSort } from './document-list/hooks'
import RenameModal from './rename-modal'

type LocalDoc = SimpleDocumentDetail & { percent?: number }

type PaginationProps = {
  className?: string
  current: number
  total: number
  limit?: number
  onChange: (page: number) => void
  onLimitChange?: (limit: number) => void
}

type DocumentListProps = {
  embeddingAvailable: boolean
  documents: LocalDoc[]
  selectedIds: string[]
  onSelectedIdChange: (selectedIds: string[]) => void
  datasetId: string
  pagination: PaginationProps
  onUpdate: () => void
  onManageMetadata: () => void
  remoteSortValue: string
  onSortChange: (value: string) => void
}

/**
 * Document list component including basic information
 */
const DocumentList = ({
  embeddingAvailable,
  documents = [],
  selectedIds,
  onSelectedIdChange,
  datasetId,
  pagination,
  onUpdate,
  onManageMetadata,
  remoteSortValue,
  onSortChange,
}: DocumentListProps) => {
  const { t } = useTranslation()
  const pageSize = pagination.limit ?? 10
  const totalPages = Math.max(Math.ceil(pagination.total / pageSize), 1)
  const datasetConfig = useDatasetDetailContext(s => s.dataset)
  const datasetACLCapabilities = useDatasetACLCapabilities(datasetConfig)
  const chunkingMode = datasetConfig?.doc_form
  const isGeneralMode = chunkingMode !== ChunkingMode.parentChild
  const isQAMode = chunkingMode === ChunkingMode.qa

  // Sorting
  const { sortField, sortOrder, handleSort } = useDocumentSort({
    remoteSortValue,
    onRemoteSortChange: onSortChange,
  })

  // Selection
  const {
    hasErrorDocumentsSelected,
    downloadableSelectedIds,
    clearSelection,
  } = useDocumentSelection({
    documents,
    selectedIds,
    onSelectedIdChange,
  })
  const documentIds = useMemo(() => documents.map(doc => doc.id), [documents])

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
    <div className="relative mt-3 flex size-full flex-col">
      <CheckboxGroup
        value={selectedIds}
        onValueChange={nextSelectedIds => onSelectedIdChange(nextSelectedIds)}
        allValues={documentIds}
        className="relative h-0 grow overflow-x-auto"
      >
        <table className={`w-full max-w-full min-w-[700px] border-collapse border-0 text-sm ${s.documentTable}`}>
          <thead className="h-8 border-b border-divider-subtle text-xs/8 font-medium text-text-tertiary uppercase">
            <tr>
              <td className="w-12">
                <div className="flex items-center" role="presentation" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                  {embeddingAvailable && (
                    <Checkbox
                      className="mr-2 shrink-0"
                      parent
                      aria-label={t('operation.selectAll', { ns: 'common' })}
                    />
                  )}
                  #
                </div>
              </td>
              <td>
                {t('list.table.header.fileName', { ns: 'datasetDocuments' })}
              </td>
              <td className="w-[130px]">{t('list.table.header.chunkingMode', { ns: 'datasetDocuments' })}</td>
              <td className="w-24">{t('list.table.header.words', { ns: 'datasetDocuments' })}</td>
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
            {documents.map((doc, index) => (
              <DocumentTableRow
                key={doc.id}
                doc={doc}
                index={index}
                datasetId={datasetId}
                isGeneralMode={isGeneralMode}
                isQAMode={isQAMode}
                embeddingAvailable={embeddingAvailable}
                selectedIds={selectedIds}
                onSelectedIdChange={onSelectedIdChange}
                onShowRenameModal={handleShowRenameModal}
                onUpdate={onUpdate}
              />
            ))}
          </tbody>
        </table>
      </CheckboxGroup>

      {selectedIds.length > 0 && (
        <BatchAction
          className="absolute bottom-16 left-0 z-20"
          selectedIds={selectedIds}
          onArchive={datasetACLCapabilities.canEdit ? handleAction(DocumentActionType.archive) : undefined}
          onBatchSummary={datasetACLCapabilities.canEdit ? handleAction(DocumentActionType.summary) : undefined}
          onBatchEnable={datasetACLCapabilities.canEdit ? handleAction(DocumentActionType.enable) : undefined}
          onBatchDisable={datasetACLCapabilities.canEdit ? handleAction(DocumentActionType.disable) : undefined}
          onBatchDownload={datasetACLCapabilities.canDocumentDownload && downloadableSelectedIds.length > 0 ? handleBatchDownload : undefined}
          onBatchDelete={datasetACLCapabilities.canDeleteFile ? handleAction(DocumentActionType.delete) : undefined}
          onEditMetadata={datasetACLCapabilities.canEdit ? showEditModal : undefined}
          onBatchReIndex={datasetACLCapabilities.canEdit && hasErrorDocumentsSelected ? handleBatchReIndex : undefined}
          onCancel={clearSelection}
        />
      )}

      {!!pagination.total && (
        <Pagination
          className="shrink-0"
          page={pagination.current + 1}
          totalPages={totalPages}
          onPageChange={page => pagination.onChange(page - 1)}
          labels={{
            previous: t('pagination.previous', { ns: 'common' }),
            next: t('pagination.next', { ns: 'common' }),
            editPageNumber: (page, totalPages) => t('pagination.editPageNumber', { ns: 'common', page, totalPages }),
            pageNumberInput: t('pagination.pageNumber', { ns: 'common' }),
          }}
          pageSize={pagination.onLimitChange
            ? {
                value: pageSize,
                options: [10, 25, 50],
                onValueChange: pagination.onLimitChange,
                label: t('pagination.perPage', { ns: 'common' }),
                ariaLabel: t('pagination.perPage', { ns: 'common' }),
              }
            : undefined}
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
