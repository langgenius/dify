'use client'
import type { FC } from 'react'
import React, { useCallback, useMemo, useState } from 'react'
import { useBoolean } from 'ahooks'
import { ArrowDownIcon } from '@heroicons/react/24/outline'
import { pick, uniq } from 'lodash-es'
import {
  RiEditLine,
  RiGlobalLine,
} from '@remixicon/react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import ChunkingModeLabel from '../common/chunking-mode-label'
import FileTypeIcon from '../../base/file-uploader/file-type-icon'
import s from './style.module.css'
import RenameModal from './rename-modal'
import BatchAction from './detail/completed/common/batch-action'
import cn from '@/utils/classnames'
import Tooltip from '@/app/components/base/tooltip'
import Toast from '@/app/components/base/toast'
import type { Item } from '@/app/components/base/select'
import { asyncRunSafe } from '@/utils'
import { formatNumber } from '@/utils/format'
import NotionIcon from '@/app/components/base/notion-icon'
import type { LegacyDataSourceInfo, LocalFileInfo, OnlineDocumentInfo, OnlineDriveInfo } from '@/models/datasets'
import { ChunkingMode, DataSourceType, DocumentActionType, type SimpleDocumentDetail } from '@/models/datasets'
import type { CommonResponse } from '@/models/common'
import useTimestamp from '@/hooks/use-timestamp'
import { useDatasetDetailContextWithSelector as useDatasetDetailContext } from '@/context/dataset-detail'
import type { Props as PaginationProps } from '@/app/components/base/pagination'
import Pagination from '@/app/components/base/pagination'
import Checkbox from '@/app/components/base/checkbox'
import { useDocumentArchive, useDocumentDelete, useDocumentDisable, useDocumentEnable } from '@/service/knowledge/use-document'
import { extensionToFileType } from '@/app/components/datasets/hit-testing/utils/extension-to-file-type'
import useBatchEditDocumentMetadata from '../metadata/hooks/use-batch-edit-document-metadata'
import EditMetadataBatchModal from '@/app/components/datasets/metadata/edit-metadata-batch/modal'
import StatusItem from './status-item'
import Operations from './operations'
import { DatasourceType } from '@/models/pipeline'

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
  statusFilter: Item
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
  statusFilter,
}) => {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()
  const router = useRouter()
  const datasetConfig = useDatasetDetailContext(s => s.dataset)
  const chunkingMode = datasetConfig?.doc_form
  const isGeneralMode = chunkingMode !== ChunkingMode.parentChild
  const isQAMode = chunkingMode === ChunkingMode.qa
  const [sortField, setSortField] = useState<'name' | 'word_count' | 'hit_count' | 'created_at' | null>('created_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

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

    if (statusFilter.value !== 'all') {
      filteredDocs = filteredDocs.filter(doc =>
        typeof doc.display_status === 'string'
        && typeof statusFilter.value === 'string'
        && doc.display_status.toLowerCase() === statusFilter.value.toLowerCase(),
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
  }, [documents, sortField, sortOrder, statusFilter])

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
      <div className='flex cursor-pointer items-center hover:text-text-secondary' onClick={() => handleSort(field)}>
        {label}
        <ArrowDownIcon
          className={cn('ml-0.5 h-3 w-3 stroke-current stroke-2 transition-all',
            isActive ? 'text-text-tertiary' : 'text-text-disabled',
            isActive && !isDesc ? 'rotate-180' : '',
          )}
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
  const { mutateAsync: enableDocument } = useDocumentEnable()
  const { mutateAsync: disableDocument } = useDocumentDisable()
  const { mutateAsync: deleteDocument } = useDocumentDelete()

  const handleAction = (actionName: DocumentActionType) => {
    return async () => {
      let opApi
      switch (actionName) {
        case DocumentActionType.archive:
          opApi = archiveDocument
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
        Toast.notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
        onUpdate()
      }
      else { Toast.notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') }) }
    }
  }

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

  return (
    <div className='relative flex h-full w-full flex-col'>
      <div className='relative grow overflow-x-auto'>
        <table className={`mt-3 w-full min-w-[700px] max-w-full border-collapse border-0 text-sm ${s.documentTable}`}>
          <thead className="h-8 border-b border-divider-subtle text-xs font-medium uppercase leading-8 text-text-tertiary">
            <tr>
              <td className='w-12'>
                <div className='flex items-center' onClick={e => e.stopPropagation()}>
                  {embeddingAvailable && (
                    <Checkbox
                      className='mr-2 shrink-0'
                      checked={isAllSelected}
                      indeterminate={!isAllSelected && isSomeSelected}
                      onCheck={onSelectedAll}
                    />
                  )}
                  #
                </div>
              </td>
              <td>
                {renderSortHeader('name', t('datasetDocuments.list.table.header.fileName'))}
              </td>
              <td className='w-[130px]'>{t('datasetDocuments.list.table.header.chunkingMode')}</td>
              <td className='w-24'>
                {renderSortHeader('word_count', t('datasetDocuments.list.table.header.words'))}
              </td>
              <td className='w-44'>
                {renderSortHeader('hit_count', t('datasetDocuments.list.table.header.hitCount'))}
              </td>
              <td className='w-44'>
                {renderSortHeader('created_at', t('datasetDocuments.list.table.header.uploadTime'))}
              </td>
              <td className='w-40'>{t('datasetDocuments.list.table.header.status')}</td>
              <td className='w-20'>{t('datasetDocuments.list.table.header.action')}</td>
            </tr>
          </thead>
          <tbody className="text-text-secondary">
            {localDocs.map((doc, index) => {
              const isFile = isLocalFile(doc.data_source_type)
              const fileType = isFile ? doc.data_source_detail_dict?.upload_file?.extension : ''
              return <tr
                key={doc.id}
                className={'h-8 cursor-pointer border-b border-divider-subtle hover:bg-background-default-hover'}
                onClick={() => {
                  router.push(`/datasets/${datasetId}/documents/${doc.id}`)
                }}>
                <td className='text-left align-middle text-xs text-text-tertiary'>
                  <div className='flex items-center' onClick={e => e.stopPropagation()}>
                    <Checkbox
                      className='mr-2 shrink-0'
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
                  <div className={'group mr-6 flex max-w-[460px] items-center hover:mr-0'}>
                    <div className='flex shrink-0 items-center'>
                      {isOnlineDocument(doc.data_source_type) && (
                        <NotionIcon
                          className='mr-1.5'
                          type='page'
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
                          className='mr-1.5'
                        />
                      )}
                      {isOnlineDrive(doc.data_source_type) && (
                        <FileTypeIcon
                          type={
                            extensionToFileType(
                              getFileExtension((doc?.data_source_info as unknown as OnlineDriveInfo)?.name),
                            )
                          }
                          className='mr-1.5'
                        />
                      )}
                      {isWebsiteCrawl(doc.data_source_type) && (
                        <RiGlobalLine className='mr-1.5 size-4' />
                      )}
                    </div>
                    <Tooltip
                      popupContent={doc.name}
                    >
                      <span className='grow-1 truncate text-sm'>{doc.name}</span>
                    </Tooltip>
                    <div className='hidden shrink-0 group-hover:ml-auto group-hover:flex'>
                      <Tooltip
                        popupContent={t('datasetDocuments.list.table.rename')}
                      >
                        <div
                          className='cursor-pointer rounded-md p-1 hover:bg-state-base-hover'
                          onClick={(e) => {
                            e.stopPropagation()
                            handleShowRenameModal(doc)
                          }}
                        >
                          <RiEditLine className='h-4 w-4 text-text-tertiary' />
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
                <td className='text-[13px] text-text-secondary'>
                  {formatTime(doc.created_at, t('datasetHitTesting.dateTimeFormat') as string)}
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
            })}
          </tbody>
        </table>
      </div>
      {(selectedIds.length > 0) && (
        <BatchAction
          className='absolute bottom-16 left-0 z-20'
          selectedIds={selectedIds}
          onArchive={handleAction(DocumentActionType.archive)}
          onBatchEnable={handleAction(DocumentActionType.enable)}
          onBatchDisable={handleAction(DocumentActionType.disable)}
          onBatchDelete={handleAction(DocumentActionType.delete)}
          onEditMetadata={showEditModal}
          onCancel={() => {
            onSelectedIdChange([])
          }}
        />
      )}
      {/* Show Pagination only if the total is more than the limit */}
      {pagination.total && (
        <Pagination
          {...pagination}
          className='w-full shrink-0 px-0 pb-0'
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
