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
} from '@remixicon/react'
import { useContext } from 'use-context-selector'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import { Edit03 } from '../../base/icons/src/vender/solid/general'
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
import { useDocumentArchive, useDocumentDelete, useDocumentDisable, useDocumentEnable, useDocumentUnArchive, useSyncDocument, useSyncWebsite } from '@/service/knowledge/use-document'
import { extensionToFileType } from '@/app/components/datasets/hit-testing/utils/extension-to-file-type'

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
      onUpdate?.(operationName)
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
            needsDelay
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

type OperationName = 'delete' | 'archive' | 'enable' | 'disable' | 'sync' | 'un_archive'

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
  }
  datasetId: string
  onUpdate: (operationName?: string) => void
  scene?: 'list' | 'detail'
  className?: string
}> = ({ embeddingAvailable, datasetId, detail, onUpdate, scene = 'list', className = '' }) => {
  const { id, enabled = false, archived = false, data_source_type } = detail || {}
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
  const isListScene = scene === 'list'

  const onOperate = async (operationName: OperationName) => {
    let opApi = deleteDocument
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
      <Switch defaultValue={false} onChange={() => { }} disabled={true} size='md' />
    )}
    {isListScene && embeddingAvailable && (
      <>
        {archived
          ? <Tooltip
            popupContent={t('datasetDocuments.list.action.enableWarning')}
            popupClassName='!font-semibold'
            needsDelay
          >
            <div>
              <Switch defaultValue={false} onChange={() => { }} disabled={true} size='md' />
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
                ? 'bg-components-button-secondary-bg hover:bg-components-button-secondary-bg-hover border-components-button-secondary-border hover:border-components-button-secondary-border-hover shadow-xs shadow-shadow-shadow-3 border-[0.5px] p-2 backdrop-blur-[5px]'
                : 'hover:bg-state-base-hover p-0.5')}
            onClick={() => router.push(`/datasets/${datasetId}/documents/${detail.id}/settings`)}>
            <RiEqualizer2Line className='text-components-button-secondary-text h-4 w-4' />
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
                    <RiEditLine className='text-text-tertiary h-4 w-4' />
                    <span className={s.actionName}>{t('datasetDocuments.list.table.rename')}</span>
                  </div>
                  {['notion_import', DataSourceType.WEB].includes(data_source_type) && (
                    <div className={s.actionItem} onClick={() => onOperate('sync')}>
                      <RiLoopLeftLine className='text-text-tertiary h-4 w-4' />
                      <span className={s.actionName}>{t('datasetDocuments.list.action.sync')}</span>
                    </div>
                  )}
                  <Divider className='my-1' />
                </>
              )}
              {!archived && <div className={s.actionItem} onClick={() => onOperate('archive')}>
                <RiArchive2Line className='text-text-tertiary h-4 w-4' />
                <span className={s.actionName}>{t('datasetDocuments.list.action.archive')}</span>
              </div>}
              {archived && (
                <div className={s.actionItem} onClick={() => onOperate('un_archive')}>
                  <RiArchive2Line className='text-text-tertiary h-4 w-4' />
                  <span className={s.actionName}>{t('datasetDocuments.list.action.unarchive')}</span>
                </div>
              )}
              <div className={cn(s.actionItem, s.deleteActionItem, 'group')} onClick={() => setShowModal(true)}>
                <RiDeleteBinLine className={'text-text-tertiary group-hover:text-text-destructive h-4 w-4'} />
                <span className={cn(s.actionName, 'group-hover:text-text-destructive')}>{t('datasetDocuments.list.action.delete')}</span>
              </div>
            </div>
          }
          trigger='click'
          position='br'
          btnElement={
            <div className={cn(s.commonIcon)}>
              <RiMoreFill className='text-text-components-button-secondary-text h-4 w-4' />
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
      let opApi = deleteDocument
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
    <div className='relative h-full w-full overflow-x-auto'>
      <table className={`mt-3 w-full min-w-[700px] max-w-full border-collapse border-0 text-sm ${s.documentTable}`}>
        <thead className="border-divider-subtle text-text-tertiary h-8 border-b text-xs font-medium uppercase leading-8">
          <tr>
            <td className='w-12'>
              <div className='flex items-center' onClick={e => e.stopPropagation()}>
                <Checkbox
                  className='mr-2 shrink-0'
                  checked={isAllSelected}
                  mixed={!isAllSelected && isSomeSelected}
                  onCheck={onSelectedAll}
                />
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
              className={'border-divider-subtle hover:bg-background-default-hover h-8 cursor-pointer border-b'}
              onClick={() => {
                router.push(`/datasets/${datasetId}/documents/${doc.id}`)
              }}>
              <td className='text-text-tertiary text-left align-middle text-xs'>
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
                  {/* {doc.position} */}
                  {index + 1}
                </div>
              </td>
              <td>
                <div className={'group mr-6 flex max-w-[460px] items-center hover:mr-0'}>
                  <div className='shrink-0'>
                    {doc?.data_source_type === DataSourceType.NOTION && <NotionIcon className='-mt-[3px] mr-1.5 inline-flex align-middle' type='page' src={doc.data_source_info.notion_page_icon} />}
                    {doc?.data_source_type === DataSourceType.FILE && <FileTypeIcon type={extensionToFileType(doc?.data_source_info?.upload_file?.extension ?? fileType)} className='mr-1.5' />}
                    {doc?.data_source_type === DataSourceType.WEB && <Globe01 className='-mt-[3px] mr-1.5 inline-flex align-middle' />}
                  </div>
                  <span className='grow-1 truncate text-sm'>{doc.name}</span>
                  <div className='hidden shrink-0 group-hover:ml-auto group-hover:flex'>
                    <Tooltip
                      popupContent={t('datasetDocuments.list.table.rename')}
                    >
                      <div
                        className='hover:bg-state-base-hover cursor-pointer rounded-md p-1'
                        onClick={(e) => {
                          e.stopPropagation()
                          handleShowRenameModal(doc)
                        }}
                      >
                        <Edit03 className='text-text-tertiary h-4 w-4' />
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
              <td className='text-text-secondary text-[13px]'>
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
                  detail={pick(doc, ['name', 'enabled', 'archived', 'id', 'data_source_type', 'doc_form'])}
                  onUpdate={onUpdate}
                />
              </td>
            </tr>
          })}
        </tbody>
      </table>
      {(selectedIds.length > 0) && (
        <BatchAction
          className='absolute bottom-16 left-0 z-20'
          selectedIds={selectedIds}
          onArchive={handleAction(DocumentActionType.archive)}
          onBatchEnable={handleAction(DocumentActionType.enable)}
          onBatchDisable={handleAction(DocumentActionType.disable)}
          onBatchDelete={handleAction(DocumentActionType.delete)}
          onCancel={() => {
            onSelectedIdChange([])
          }}
        />
      )}
      {/* Show Pagination only if the total is more than the limit */}
      {pagination.total && pagination.total > (pagination.limit || 10) && (
        <Pagination
          {...pagination}
          className='absolute bottom-0 left-0 w-full px-0 pb-0'
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
    </div>
  )
}

export default DocumentList
