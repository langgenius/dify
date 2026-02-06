'use client'
import type { FC } from 'react'
import type { Props as PaginationProps } from '@/app/components/base/pagination'
import type { CommonResponse } from '@/models/common'
import type { LegacyDataSourceInfo, LocalFileInfo, OnlineDocumentInfo, OnlineDriveInfo, SimpleDocumentDetail } from '@/models/datasets'
import {
  RiArrowDownLine,
  RiEditLine,
  RiGlobalLine,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { uniq } from 'es-toolkit/array'
import { pick } from 'es-toolkit/object'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Checkbox from '@/app/components/base/checkbox'
import FileTypeIcon from '@/app/components/base/file-uploader/file-type-icon'
import NotionIcon from '@/app/components/base/notion-icon'
import Pagination from '@/app/components/base/pagination'
import Toast from '@/app/components/base/toast'
import Tooltip from '@/app/components/base/tooltip'
import ChunkingModeLabel from '@/app/components/datasets/common/chunking-mode-label'
import { normalizeStatusForQuery } from '@/app/components/datasets/documents/status-filter'
import { extensionToFileType } from '@/app/components/datasets/hit-testing/utils/extension-to-file-type'
import EditMetadataBatchModal from '@/app/components/datasets/metadata/edit-metadata-batch/modal'
import useBatchEditDocumentMetadata from '@/app/components/datasets/metadata/hooks/use-batch-edit-document-metadata'
import { useDatasetDetailContextWithSelector as useDatasetDetailContext } from '@/context/dataset-detail'
import useTimestamp from '@/hooks/use-timestamp'
import { ChunkingMode, DataSourceType, DocumentActionType } from '@/models/datasets'
import { DatasourceType } from '@/models/pipeline'
import { useDocumentArchive, useDocumentBatchRetryIndex, useDocumentDelete, useDocumentDisable, useDocumentDownloadZip, useDocumentEnable, useDocumentSummary } from '@/service/knowledge/use-document'
import { asyncRunSafe } from '@/utils'
import { cn } from '@/utils/classnames'
import { downloadBlob } from '@/utils/download'
import { formatNumber } from '@/utils/format'
import BatchAction from '../detail/completed/common/batch-action'
import SummaryStatus from '../detail/completed/common/summary-status'
import StatusItem from '../status-item'
import s from '../style.module.css'
import Operations from './operations'
import RenameModal from './rename-modal'

export const renderTdValue = (value: string | number | null, isEmptyStyle = false) => {
  return (
    <div className={cn(isEmptyStyle ? 'text-text-tertiary' : 'text-text-secondary', s.tdValue)}>
      {value ?? '-'}
    </div>
  )
}

const renderCount = (count: number | undefined) => {
  if (!count)
    return renderTdValue(0, true)

  if (count < 1000)
    return count

  return `${formatNumber((count / 1000).toFixed(1))}k`
}

type LocalDoc = SimpleDocumentDetail & { percent?: number }
type IDocumentListProps = {
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
const DocumentList: FC<IDocumentListProps> = ({
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
  const { formatTime } = useTimestamp()
  const router = useRouter()
  const datasetConfig = useDatasetDetailContext(s => s.dataset)
  const chunkingMode = datasetConfig?.doc_form
  const isGeneralMode = chunkingMode !== ChunkingMode.parentChild
  const isQAMode = chunkingMode === ChunkingMode.qa
  const [sortField, setSortField] = useState<'name' | 'word_count' | 'hit_count' | 'created_at' | null>(null)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    setSortField(null)
    setSortOrder('desc')
  }, [remoteSortValue])

  const {
    isShowEditModal,
    showEditModal,
    hideEditModal,
    originalList,
    handleSave,
  } = useBatchEditDocumentMetadata({
    datasetId,
    docList: documents.filter(doc => selectedIds.includes(doc.id)),
    selectedDocumentIds: selectedIds, // Pass all selected IDs separately
    onUpdate,
  })

  const localDocs = useMemo(() => {
    let filteredDocs = documents

    if (statusFilterValue && statusFilterValue !== 'all') {
      filteredDocs = filteredDocs.filter(doc =>
        typeof doc.display_status === 'string'
        && normalizeStatusForQuery(doc.display_status) === statusFilterValue,
      )
    }

    if (!sortField)
      return filteredDocs

    const sortedDocs = [...filteredDocs].sort((a, b) => {
      let aValue: any
      let bValue: any

      switch (sortField) {
        case 'name':
          aValue = a.name?.toLowerCase() || ''
          bValue = b.name?.toLowerCase() || ''
          break
        case 'word_count':
          aValue = a.word_count || 0
          bValue = b.word_count || 0
          break
        case 'hit_count':
          aValue = a.hit_count || 0
          bValue = b.hit_count || 0
          break
        case 'created_at':
          aValue = a.created_at
          bValue = b.created_at
          break
        default:
          return 0
      }

      if (sortField === 'name') {
        const result = aValue.localeCompare(bValue)
        return sortOrder === 'asc' ? result : -result
      }
      else {
        const result = aValue - bValue
        return sortOrder === 'asc' ? result : -result
      }
    })

    return sortedDocs
  }, [documents, sortField, sortOrder, statusFilterValue])

  const handleSort = (field: 'name' | 'word_count' | 'hit_count' | 'created_at') => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    }
    else {
      setSortField(field)
      setSortOrder('desc')
    }
  }

  const renderSortHeader = (field: 'name' | 'word_count' | 'hit_count' | 'created_at', label: string) => {
    const isActive = sortField === field
    const isDesc = isActive && sortOrder === 'desc'

    return (
      <div className="flex cursor-pointer items-center hover:text-text-secondary" onClick={() => handleSort(field)}>
        {label}
        <RiArrowDownLine
          className={cn('ml-0.5 h-3 w-3 transition-all', isActive ? 'text-text-tertiary' : 'text-text-disabled', isActive && !isDesc ? 'rotate-180' : '')}
        />
      </div>
    )
  }

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

  const isAllSelected = useMemo(() => {
    return localDocs.length > 0 && localDocs.every(doc => selectedIds.includes(doc.id))
  }, [localDocs, selectedIds])

  const isSomeSelected = useMemo(() => {
    return localDocs.some(doc => selectedIds.includes(doc.id))
  }, [localDocs, selectedIds])

  const onSelectedAll = useCallback(() => {
    if (isAllSelected)
      onSelectedIdChange([])
    else
      onSelectedIdChange(uniq([...selectedIds, ...localDocs.map(doc => doc.id)]))
  }, [isAllSelected, localDocs, onSelectedIdChange, selectedIds])
  const { mutateAsync: archiveDocument } = useDocumentArchive()
  const { mutateAsync: generateSummary } = useDocumentSummary()
  const { mutateAsync: enableDocument } = useDocumentEnable()
  const { mutateAsync: disableDocument } = useDocumentDisable()
  const { mutateAsync: deleteDocument } = useDocumentDelete()
  const { mutateAsync: retryIndexDocument } = useDocumentBatchRetryIndex()
  const { mutateAsync: requestDocumentsZip, isPending: isDownloadingZip } = useDocumentDownloadZip()

  const handleAction = (actionName: DocumentActionType) => {
    return async () => {
      let opApi
      switch (actionName) {
        case DocumentActionType.archive:
          opApi = archiveDocument
          break
        case DocumentActionType.summary:
          opApi = generateSummary
          break
        case DocumentActionType.enable:
          opApi = enableDocument
          break
        case DocumentActionType.disable:
          opApi = disableDocument
          break
        default:
          opApi = deleteDocument
          break
      }
      const [e] = await asyncRunSafe<CommonResponse>(opApi({ datasetId, documentIds: selectedIds }) as Promise<CommonResponse>)

      if (!e) {
        if (actionName === DocumentActionType.delete)
          onSelectedIdChange([])
        Toast.notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
        onUpdate()
      }
      else { Toast.notify({ type: 'error', message: t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }) }) }
    }
  }

  const handleBatchReIndex = async () => {
    const [e] = await asyncRunSafe<CommonResponse>(retryIndexDocument({ datasetId, documentIds: selectedIds }))
    if (!e) {
      onSelectedIdChange([])
      Toast.notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
      onUpdate()
    }
    else {
      Toast.notify({ type: 'error', message: t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }) })
    }
  }

  const hasErrorDocumentsSelected = useMemo(() => {
    return localDocs.some(doc => selectedIds.includes(doc.id) && doc.display_status === 'error')
  }, [localDocs, selectedIds])

  const getFileExtension = useCallback((fileName: string): string => {
    if (!fileName)
      return ''
    const parts = fileName.split('.')
    if (parts.length <= 1 || (parts[0] === '' && parts.length === 2))
      return ''

    return parts[parts.length - 1].toLowerCase()
  }, [])

  const isCreateFromRAGPipeline = useCallback((createdFrom: string) => {
    return createdFrom === 'rag-pipeline'
  }, [])

  /**
   * Calculate the data source type
   * DataSourceType: FILE, NOTION, WEB (legacy)
   * DatasourceType: localFile, onlineDocument, websiteCrawl, onlineDrive (new)
   */
  const isLocalFile = useCallback((dataSourceType: DataSourceType | DatasourceType) => {
    return dataSourceType === DatasourceType.localFile || dataSourceType === DataSourceType.FILE
  }, [])
  const isOnlineDocument = useCallback((dataSourceType: DataSourceType | DatasourceType) => {
    return dataSourceType === DatasourceType.onlineDocument || dataSourceType === DataSourceType.NOTION
  }, [])
  const isWebsiteCrawl = useCallback((dataSourceType: DataSourceType | DatasourceType) => {
    return dataSourceType === DatasourceType.websiteCrawl || dataSourceType === DataSourceType.WEB
  }, [])
  const isOnlineDrive = useCallback((dataSourceType: DataSourceType | DatasourceType) => {
    return dataSourceType === DatasourceType.onlineDrive
  }, [])

  const downloadableSelectedIds = useMemo(() => {
    const selectedSet = new Set(selectedIds)
    return localDocs
      .filter(doc => selectedSet.has(doc.id) && doc.data_source_type === DataSourceType.FILE)
      .map(doc => doc.id)
  }, [localDocs, selectedIds])

  /**
   * Generate a random ZIP filename for bulk document downloads.
   * We intentionally avoid leaking dataset info in the exported archive name.
   */
  const generateDocsZipFileName = useCallback((): string => {
    // Prefer UUID for uniqueness; fall back to time+random when unavailable.
    const randomPart = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    return `${randomPart}-docs.zip`
  }, [])

  const handleBatchDownload = useCallback(async () => {
    if (isDownloadingZip)
      return

    // Download as a single ZIP to avoid browser caps on multiple automatic downloads.
    const [e, blob] = await asyncRunSafe(requestDocumentsZip({ datasetId, documentIds: downloadableSelectedIds }))
    if (e || !blob) {
      Toast.notify({ type: 'error', message: t('actionMsg.downloadUnsuccessfully', { ns: 'common' }) })
      return
    }

    downloadBlob({ data: blob, fileName: generateDocsZipFileName() })
  }, [datasetId, downloadableSelectedIds, generateDocsZipFileName, isDownloadingZip, requestDocumentsZip, t])

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
                      onCheck={onSelectedAll}
                    />
                  )}
                  #
                </div>
              </td>
              <td>
                {renderSortHeader('name', t('list.table.header.fileName', { ns: 'datasetDocuments' }))}
              </td>
              <td className="w-[130px]">{t('list.table.header.chunkingMode', { ns: 'datasetDocuments' })}</td>
              <td className="w-24">
                {renderSortHeader('word_count', t('list.table.header.words', { ns: 'datasetDocuments' }))}
              </td>
              <td className="w-44">
                {renderSortHeader('hit_count', t('list.table.header.hitCount', { ns: 'datasetDocuments' }))}
              </td>
              <td className="w-44">
                {renderSortHeader('created_at', t('list.table.header.uploadTime', { ns: 'datasetDocuments' }))}
              </td>
              <td className="w-40">{t('list.table.header.status', { ns: 'datasetDocuments' })}</td>
              <td className="w-20">{t('list.table.header.action', { ns: 'datasetDocuments' })}</td>
            </tr>
          </thead>
          <tbody className="text-text-secondary">
            {localDocs.map((doc, index) => {
              const isFile = isLocalFile(doc.data_source_type)
              const fileType = isFile ? doc.data_source_detail_dict?.upload_file?.extension : ''
              return (
                <tr
                  key={doc.id}
                  className="h-8 cursor-pointer border-b border-divider-subtle hover:bg-background-default-hover"
                  onClick={() => {
                    router.push(`/datasets/${datasetId}/documents/${doc.id}`)
                  }}
                >
                  <td className="text-left align-middle text-xs text-text-tertiary">
                    <div className="flex items-center" onClick={e => e.stopPropagation()}>
                      <Checkbox
                        className="mr-2 shrink-0"
                        checked={selectedIds.includes(doc.id)}
                        onCheck={() => {
                          onSelectedIdChange(
                            selectedIds.includes(doc.id)
                              ? selectedIds.filter(id => id !== doc.id)
                              : [...selectedIds, doc.id],
                          )
                        }}
                      />
                      {index + 1}
                    </div>
                  </td>
                  <td>
                    <div className="group mr-6 flex max-w-[460px] items-center hover:mr-0">
                      <div className="flex shrink-0 items-center">
                        {isOnlineDocument(doc.data_source_type) && (
                          <NotionIcon
                            className="mr-1.5"
                            type="page"
                            src={
                              isCreateFromRAGPipeline(doc.created_from)
                                ? (doc.data_source_info as OnlineDocumentInfo).page.page_icon
                                : (doc.data_source_info as LegacyDataSourceInfo).notion_page_icon
                            }
                          />
                        )}
                        {isLocalFile(doc.data_source_type) && (
                          <FileTypeIcon
                            type={
                              extensionToFileType(
                                isCreateFromRAGPipeline(doc.created_from)
                                  ? (doc?.data_source_info as LocalFileInfo)?.extension
                                  : ((doc?.data_source_info as LegacyDataSourceInfo)?.upload_file?.extension ?? fileType),
                              )
                            }
                            className="mr-1.5"
                          />
                        )}
                        {isOnlineDrive(doc.data_source_type) && (
                          <FileTypeIcon
                            type={
                              extensionToFileType(
                                getFileExtension((doc?.data_source_info as unknown as OnlineDriveInfo)?.name),
                              )
                            }
                            className="mr-1.5"
                          />
                        )}
                        {isWebsiteCrawl(doc.data_source_type) && (
                          <RiGlobalLine className="mr-1.5 size-4" />
                        )}
                      </div>
                      <Tooltip
                        popupContent={doc.name}
                      >
                        <span className="grow-1 truncate text-sm">{doc.name}</span>
                      </Tooltip>
                      {
                        doc.summary_index_status && (
                          <div className="ml-1 hidden shrink-0 group-hover:flex">
                            <SummaryStatus status={doc.summary_index_status} />
                          </div>
                        )
                      }
                      <div className="hidden shrink-0 group-hover:ml-auto group-hover:flex">
                        <Tooltip
                          popupContent={t('list.table.rename', { ns: 'datasetDocuments' })}
                        >
                          <div
                            className="cursor-pointer rounded-md p-1 hover:bg-state-base-hover"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleShowRenameModal(doc)
                            }}
                          >
                            <RiEditLine className="h-4 w-4 text-text-tertiary" />
                          </div>
                        </Tooltip>
                      </div>
                    </div>
                  </td>
                  <td>
                    <ChunkingModeLabel
                      isGeneralMode={isGeneralMode}
                      isQAMode={isQAMode}
                    />
                  </td>
                  <td>{renderCount(doc.word_count)}</td>
                  <td>{renderCount(doc.hit_count)}</td>
                  <td className="text-[13px] text-text-secondary">
                    {formatTime(doc.created_at, t('dateTimeFormat', { ns: 'datasetHitTesting' }) as string)}
                  </td>
                  <td>
                    <StatusItem status={doc.display_status} />
                  </td>
                  <td>
                    <Operations
                      selectedIds={selectedIds}
                      onSelectedIdChange={onSelectedIdChange}
                      embeddingAvailable={embeddingAvailable}
                      datasetId={datasetId}
                      detail={pick(doc, ['name', 'enabled', 'archived', 'id', 'data_source_type', 'doc_form', 'display_status'])}
                      onUpdate={onUpdate}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {(selectedIds.length > 0) && (
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
          onCancel={() => {
            onSelectedIdChange([])
          }}
        />
      )}
      {/* Show Pagination only if the total is more than the limit */}
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
