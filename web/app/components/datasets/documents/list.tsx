'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useBoolean, useDebounceFn } from 'ahooks'
import { ArrowDownIcon } from '@heroicons/react/24/outline'
import { pick, uniq } from 'lodash-es'
import {
  RiArchive2Line,
  RiDeleteBinLine,
  RiEditLine,
  RiEqualizer2Line,
  RiLoopLeftLine,
  RiMoreFill,
  RiPauseCircleLine,
  RiPlayCircleLine,
} from '@remixicon/react'
import { useContext } from 'use-context-selector'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import { Globe01 } from '../../base/icons/src/vender/line/mapsAndTravel'
import ChunkingModeLabel from '../common/chunking-mode-label'
import FileTypeIcon from '../../base/file-uploader/file-type-icon'
import s from './style.module.css'
import RenameModal from './rename-modal'
import BatchAction from './detail/completed/common/batch-action'
import cn from '@/utils/classnames'
import Switch from '@/app/components/base/switch'
import Divider from '@/app/components/base/divider'
import Popover from '@/app/components/base/popover'
import Confirm from '@/app/components/base/confirm'
import Tooltip from '@/app/components/base/tooltip'
import Toast, { ToastContext } from '@/app/components/base/toast'
import type { ColorMap, IndicatorProps } from '@/app/components/header/indicator'
import Indicator from '@/app/components/header/indicator'
import { asyncRunSafe } from '@/utils'
import { formatNumber } from '@/utils/format'
import NotionIcon from '@/app/components/base/notion-icon'
import ProgressBar from '@/app/components/base/progress-bar'
import { ChunkingMode, DataSourceType, DocumentActionType, type DocumentDisplayStatus, type SimpleDocumentDetail } from '@/models/datasets'
import type { CommonResponse } from '@/models/common'
import useTimestamp from '@/hooks/use-timestamp'
import { useDatasetDetailContextWithSelector as useDatasetDetailContext } from '@/context/dataset-detail'
import type { Props as PaginationProps } from '@/app/components/base/pagination'
import Pagination from '@/app/components/base/pagination'
import Checkbox from '@/app/components/base/checkbox'
import { useDocumentArchive, useDocumentDelete, useDocumentDisable, useDocumentEnable, useDocumentPause, useDocumentResume, useDocumentUnArchive, useSyncDocument, useSyncWebsite } from '@/service/knowledge/use-document'
import { extensionToFileType } from '@/app/components/datasets/hit-testing/utils/extension-to-file-type'
import useBatchEditDocumentMetadata from '../metadata/hooks/use-batch-edit-document-metadata'
import EditMetadataBatchModal from '@/app/components/datasets/metadata/edit-metadata-batch/modal'
import { noop } from 'lodash-es'

export const useIndexStatus = () => {
  const { t } = useTranslation()
  return {
    queuing: { color: 'orange', text: t('datasetDocuments.list.status.queuing') }, // waiting
    indexing: { color: 'blue', text: t('datasetDocuments.list.status.indexing') }, // indexing splitting parsing cleaning
    paused: { color: 'orange', text: t('datasetDocuments.list.status.paused') }, // paused
    error: { color: 'red', text: t('datasetDocuments.list.status.error') }, // error
    available: { color: 'green', text: t('datasetDocuments.list.status.available') }, // completed，archived = false，enabled = true
    enabled: { color: 'green', text: t('datasetDocuments.list.status.enabled') }, // completed，archived = false，enabled = true
    disabled: { color: 'gray', text: t('datasetDocuments.list.status.disabled') }, // completed，archived = false，enabled = false
    archived: { color: 'gray', text: t('datasetDocuments.list.status.archived') }, // completed，archived = true
  }
}

const STATUS_TEXT_COLOR_MAP: ColorMap = {
  green: 'text-util-colors-green-green-600',
  orange: 'text-util-colors-warning-warning-600',
  red: 'text-util-colors-red-red-600',
  blue: 'text-util-colors-blue-light-blue-light-600',
  yellow: 'text-util-colors-warning-warning-600',
  gray: 'text-text-tertiary',
}

// status item for list
export const StatusItem: FC<{
  status: DocumentDisplayStatus
  reverse?: boolean
  scene?: 'list' | 'detail'
  textCls?: string
  errorMessage?: string
  detail?: {
    enabled: boolean
    archived: boolean
    id: string
  }
  datasetId?: string
  onUpdate?: (operationName?: string) => void

}> = ({ status, reverse = false, scene = 'list', textCls = '', errorMessage, datasetId = '', detail, onUpdate }) => {
  const DOC_INDEX_STATUS_MAP = useIndexStatus()
  const localStatus = status.toLowerCase() as keyof typeof DOC_INDEX_STATUS_MAP
  const { enabled = false, archived = false, id = '' } = detail || {}
  const { notify } = useContext(ToastContext)
  const { t } = useTranslation()
  const { mutateAsync: enableDocument } = useDocumentEnable()
  const { mutateAsync: disableDocument } = useDocumentDisable()
  const { mutateAsync: deleteDocument } = useDocumentDelete()

  const onOperate = async (operationName: OperationName) => {
    let opApi = deleteDocument
    switch (operationName) {
      case 'enable':
        opApi = enableDocument
        break
      case 'disable':
        opApi = disableDocument
        break
    }
    const [e] = await asyncRunSafe<CommonResponse>(opApi({ datasetId, documentId: id }) as Promise<CommonResponse>)
    if (!e) {
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      onUpdate?.()
      // onUpdate?.(operationName)
    }
    else { notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') }) }
  }

  const { run: handleSwitch } = useDebounceFn((operationName: OperationName) => {
    if (operationName === 'enable' && enabled)
      return
    if (operationName === 'disable' && !enabled)
      return
    onOperate(operationName)
  }, { wait: 500 })

  const embedding = useMemo(() => {
    return ['queuing', 'indexing', 'paused'].includes(localStatus)
  }, [localStatus])

  return <div className={
    cn('flex items-center',
      reverse ? 'flex-row-reverse' : '',
      scene === 'detail' ? s.statusItemDetail : '')
  }>
    <Indicator color={DOC_INDEX_STATUS_MAP[localStatus]?.color as IndicatorProps['color']} className={reverse ? 'ml-2' : 'mr-2'} />
    <span className={cn(`${STATUS_TEXT_COLOR_MAP[DOC_INDEX_STATUS_MAP[localStatus].color as keyof typeof STATUS_TEXT_COLOR_MAP]} text-sm`, textCls)}>
      {DOC_INDEX_STATUS_MAP[localStatus]?.text}
    </span>
    {
      errorMessage && (
        <Tooltip
          popupContent={
            <div className='max-w-[260px] break-all'>{errorMessage}</div>
          }
          triggerClassName='ml-1 w-4 h-4'
        />
      )
    }
    {
      scene === 'detail' && (
        <div className='ml-1.5 flex items-center justify-between'>
          <Tooltip
            popupContent={t('datasetDocuments.list.action.enableWarning')}
            popupClassName='text-text-secondary system-xs-medium'
            disabled={!archived}
          >
            <Switch
              defaultValue={archived ? false : enabled}
              onChange={v => !archived && handleSwitch(v ? 'enable' : 'disable')}
              disabled={embedding || archived}
              size='md'
            />
          </Tooltip>
        </div>
      )
    }
  </div>
}

type OperationName = 'delete' | 'archive' | 'enable' | 'disable' | 'sync' | 'un_archive' | 'pause' | 'resume'

// operation action for list and detail
export const OperationAction: FC<{
  embeddingAvailable: boolean
  detail: {
    name: string
    enabled: boolean
    archived: boolean
    id: string
    data_source_type: string
    doc_form: string
    display_status?: string
  }
  datasetId: string
  onUpdate: (operationName?: string) => void
  scene?: 'list' | 'detail'
  className?: string
}> = ({ embeddingAvailable, datasetId, detail, onUpdate, scene = 'list', className = '' }) => {
  const { id, enabled = false, archived = false, data_source_type, display_status } = detail || {}
  const [showModal, setShowModal] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { notify } = useContext(ToastContext)
  const { t } = useTranslation()
  const router = useRouter()
  const { mutateAsync: archiveDocument } = useDocumentArchive()
  const { mutateAsync: unArchiveDocument } = useDocumentUnArchive()
  const { mutateAsync: enableDocument } = useDocumentEnable()
  const { mutateAsync: disableDocument } = useDocumentDisable()
  const { mutateAsync: deleteDocument } = useDocumentDelete()
  const { mutateAsync: syncDocument } = useSyncDocument()
  const { mutateAsync: syncWebsite } = useSyncWebsite()
  const { mutateAsync: pauseDocument } = useDocumentPause()
  const { mutateAsync: resumeDocument } = useDocumentResume()
  const isListScene = scene === 'list'

  const onOperate = async (operationName: OperationName) => {
    let opApi
    switch (operationName) {
      case 'archive':
        opApi = archiveDocument
        break
      case 'un_archive':
        opApi = unArchiveDocument
        break
      case 'enable':
        opApi = enableDocument
        break
      case 'disable':
        opApi = disableDocument
        break
      case 'sync':
        if (data_source_type === 'notion_import')
          opApi = syncDocument
        else
          opApi = syncWebsite
        break
      case 'pause':
        opApi = pauseDocument
        break
      case 'resume':
        opApi = resumeDocument
        break
      default:
        opApi = deleteDocument
        setDeleting(true)
        break
    }
    const [e] = await asyncRunSafe<CommonResponse>(opApi({ datasetId, documentId: id }) as Promise<CommonResponse>)
    if (!e) {
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      onUpdate(operationName)
    }
    else { notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') }) }
    if (operationName === 'delete')
      setDeleting(false)
  }

  const { run: handleSwitch } = useDebounceFn((operationName: OperationName) => {
    if (operationName === 'enable' && enabled)
      return
    if (operationName === 'disable' && !enabled)
      return
    onOperate(operationName)
  }, { wait: 500 })

  const [currDocument, setCurrDocument] = useState<{
    id: string
    name: string
  } | null>(null)
  const [isShowRenameModal, {
    setTrue: setShowRenameModalTrue,
    setFalse: setShowRenameModalFalse,
  }] = useBoolean(false)
  const handleShowRenameModal = useCallback((doc: {
    id: string
    name: string
  }) => {
    setCurrDocument(doc)
    setShowRenameModalTrue()
  }, [setShowRenameModalTrue])
  const handleRenamed = useCallback(() => {
    onUpdate()
  }, [onUpdate])

  return <div className='flex items-center' onClick={e => e.stopPropagation()}>
    {isListScene && !embeddingAvailable && (
      <Switch defaultValue={false} onChange={noop} disabled={true} size='md' />
    )}
    {isListScene && embeddingAvailable && (
      <>
        {archived
          ? <Tooltip
            popupContent={t('datasetDocuments.list.action.enableWarning')}
            popupClassName='!font-semibold'
          >
            <div>
              <Switch defaultValue={false} onChange={noop} disabled={true} size='md' />
            </div>
          </Tooltip>
          : <Switch defaultValue={enabled} onChange={v => handleSwitch(v ? 'enable' : 'disable')} size='md' />
        }
        <Divider className='!ml-4 !mr-2 !h-3' type='vertical' />
      </>
    )}
    {embeddingAvailable && (
      <>
        <Tooltip
          popupContent={t('datasetDocuments.list.action.settings')}
          popupClassName='text-text-secondary system-xs-medium'
        >
          <button
            className={cn('mr-2 cursor-pointer rounded-lg',
              !isListScene
                ? 'border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg p-2 shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px] hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover'
                : 'p-0.5 hover:bg-state-base-hover')}
            onClick={() => router.push(`/datasets/${datasetId}/documents/${detail.id}/settings`)}>
            <RiEqualizer2Line className='h-4 w-4 text-components-button-secondary-text' />
          </button>
        </Tooltip>
        <Popover
          htmlContent={
            <div className='w-full py-1'>
              {!archived && (
                <>
                  <div className={s.actionItem} onClick={() => {
                    handleShowRenameModal({
                      id: detail.id,
                      name: detail.name,
                    })
                  }}>
                    <RiEditLine className='h-4 w-4 text-text-tertiary' />
                    <span className={s.actionName}>{t('datasetDocuments.list.table.rename')}</span>
                  </div>
                  {['notion_import', DataSourceType.WEB].includes(data_source_type) && (
                    <div className={s.actionItem} onClick={() => onOperate('sync')}>
                      <RiLoopLeftLine className='h-4 w-4 text-text-tertiary' />
                      <span className={s.actionName}>{t('datasetDocuments.list.action.sync')}</span>
                    </div>
                  )}
                  <Divider className='my-1' />
                </>
              )}
              {!archived && display_status?.toLowerCase() === 'indexing' && (
                <div className={s.actionItem} onClick={() => onOperate('pause')}>
                  <RiPauseCircleLine className='h-4 w-4 text-text-tertiary' />
                  <span className={s.actionName}>{t('datasetDocuments.list.action.pause')}</span>
                </div>
              )}
              {!archived && display_status?.toLowerCase() === 'paused' && (
                <div className={s.actionItem} onClick={() => onOperate('resume')}>
                  <RiPlayCircleLine className='h-4 w-4 text-text-tertiary' />
                  <span className={s.actionName}>{t('datasetDocuments.list.action.resume')}</span>
                </div>
              )}
              {!archived && <div className={s.actionItem} onClick={() => onOperate('archive')}>
                <RiArchive2Line className='h-4 w-4 text-text-tertiary' />
                <span className={s.actionName}>{t('datasetDocuments.list.action.archive')}</span>
              </div>}
              {archived && (
                <div className={s.actionItem} onClick={() => onOperate('un_archive')}>
                  <RiArchive2Line className='h-4 w-4 text-text-tertiary' />
                  <span className={s.actionName}>{t('datasetDocuments.list.action.unarchive')}</span>
                </div>
              )}
              <div className={cn(s.actionItem, s.deleteActionItem, 'group')} onClick={() => setShowModal(true)}>
                <RiDeleteBinLine className={'h-4 w-4 text-text-tertiary group-hover:text-text-destructive'} />
                <span className={cn(s.actionName, 'group-hover:text-text-destructive')}>{t('datasetDocuments.list.action.delete')}</span>
              </div>
            </div>
          }
          trigger='click'
          position='br'
          btnElement={
            <div className={cn(s.commonIcon)}>
              <RiMoreFill className='h-4 w-4 text-components-button-secondary-text' />
            </div>
          }
          btnClassName={open => cn(isListScene ? s.actionIconWrapperList : s.actionIconWrapperDetail, open ? '!hover:bg-state-base-hover !shadow-none' : '!bg-transparent')}
          popupClassName='!w-full'
          className={`!z-20 flex h-fit !w-[200px] justify-end ${className}`}
        />
      </>
    )}
    {showModal
      && <Confirm
        isShow={showModal}
        isLoading={deleting}
        isDisabled={deleting}
        title={t('datasetDocuments.list.delete.title')}
        content={t('datasetDocuments.list.delete.content')}
        confirmText={t('common.operation.sure')}
        onConfirm={() => onOperate('delete')}
        onCancel={() => setShowModal(false)}
      />
    }

    {isShowRenameModal && currDocument && (
      <RenameModal
        datasetId={datasetId}
        documentId={currDocument.id}
        name={currDocument.name}
        onClose={setShowRenameModalFalse}
        onSaved={handleRenamed}
      />
    )}
  </div>
}

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
}) => {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()
  const router = useRouter()
  const [datasetConfig] = useDatasetDetailContext(s => [s.dataset])
  const chunkingMode = datasetConfig?.doc_form
  const isGeneralMode = chunkingMode !== ChunkingMode.parentChild
  const isQAMode = chunkingMode === ChunkingMode.qa
  const [localDocs, setLocalDocs] = useState<LocalDoc[]>(documents)
  const [enableSort, setEnableSort] = useState(true)
  const {
    isShowEditModal,
    showEditModal,
    hideEditModal,
    originalList,
    handleSave,
  } = useBatchEditDocumentMetadata({
    datasetId,
    docList: documents.filter(item => selectedIds.includes(item.id)),
    onUpdate,
  })

  useEffect(() => {
    setLocalDocs(documents)
  }, [documents])

  const onClickSort = () => {
    setEnableSort(!enableSort)
    if (enableSort) {
      const sortedDocs = [...localDocs].sort((a, b) => dayjs(a.created_at).isBefore(dayjs(b.created_at)) ? -1 : 1)
      setLocalDocs(sortedDocs)
    }
    else {
      setLocalDocs(documents)
    }
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
        Toast.notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
        onUpdate()
      }
      else { Toast.notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') }) }
    }
  }

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
                <div className='flex'>
                  {t('datasetDocuments.list.table.header.fileName')}
                </div>
              </td>
              <td className='w-[130px]'>{t('datasetDocuments.list.table.header.chunkingMode')}</td>
              <td className='w-24'>{t('datasetDocuments.list.table.header.words')}</td>
              <td className='w-44'>{t('datasetDocuments.list.table.header.hitCount')}</td>
              <td className='w-44'>
                <div className='flex items-center' onClick={onClickSort}>
                  {t('datasetDocuments.list.table.header.uploadTime')}
                  <ArrowDownIcon className={cn('ml-0.5 h-3 w-3 cursor-pointer stroke-current stroke-2', enableSort ? 'text-text-tertiary' : 'text-text-disabled')} />
                </div>
              </td>
              <td className='w-40'>{t('datasetDocuments.list.table.header.status')}</td>
              <td className='w-20'>{t('datasetDocuments.list.table.header.action')}</td>
            </tr>
          </thead>
          <tbody className="text-text-secondary">
            {localDocs.map((doc, index) => {
              const isFile = doc.data_source_type === DataSourceType.FILE
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
                    <div className='shrink-0'>
                      {doc?.data_source_type === DataSourceType.NOTION && <NotionIcon className='mr-1.5 mt-[-3px] inline-flex align-middle' type='page' src={doc.data_source_info.notion_page_icon} />}
                      {doc?.data_source_type === DataSourceType.FILE && <FileTypeIcon type={extensionToFileType(doc?.data_source_info?.upload_file?.extension ?? fileType)} className='mr-1.5' />}
                      {doc?.data_source_type === DataSourceType.WEB && <Globe01 className='mr-1.5 mt-[-3px] inline-flex align-middle' />}
                    </div>
                    <span className='grow-1 truncate text-sm'>{doc.name}</span>
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
                  {
                    (['indexing', 'splitting', 'parsing', 'cleaning'].includes(doc.indexing_status) && doc?.data_source_type === DataSourceType.NOTION)
                      ? <ProgressBar percent={doc.percent || 0} />
                      : <StatusItem status={doc.display_status} />
                  }
                </td>
                <td>
                  <OperationAction
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
