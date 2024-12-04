'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import { useBoolean, useDebounceFn } from 'ahooks'
import { ArrowDownIcon } from '@heroicons/react/24/outline'
import { pick } from 'lodash-es'
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
import s from './style.module.css'
import RenameModal from './rename-modal'
import cn from '@/utils/classnames'
import Switch from '@/app/components/base/switch'
import Divider from '@/app/components/base/divider'
import Popover from '@/app/components/base/popover'
import Confirm from '@/app/components/base/confirm'
import Tooltip from '@/app/components/base/tooltip'
import { ToastContext } from '@/app/components/base/toast'
import type { ColorMap, IndicatorProps } from '@/app/components/header/indicator'
import Indicator from '@/app/components/header/indicator'
import { asyncRunSafe } from '@/utils'
import { formatNumber } from '@/utils/format'
import { archiveDocument, deleteDocument, disableDocument, enableDocument, syncDocument, syncWebsite, unArchiveDocument } from '@/service/datasets'
import NotionIcon from '@/app/components/base/notion-icon'
import ProgressBar from '@/app/components/base/progress-bar'
import { DataSourceType, type DocumentDisplayStatus, type SimpleDocumentDetail } from '@/models/datasets'
import type { CommonResponse } from '@/models/common'
import useTimestamp from '@/hooks/use-timestamp'

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
    if (!e)
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
    else
      notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
    onUpdate?.(operationName)
  }

  const { run: handleSwitch } = useDebounceFn((operationName: OperationName) => {
    if (operationName === 'enable' && enabled)
      return
    if (operationName === 'disable' && !enabled)
      return
    onOperate(operationName)
  }, { wait: 500 })

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
      scene === 'detail' && (
        <div className='flex justify-between items-center ml-1.5'>
          <Tooltip
            popupContent={t('datasetDocuments.list.action.enableWarning')}
            popupClassName='text-text-secondary system-xs-medium'
            needsDelay
            disabled={!archived}
          >
            <Switch
              defaultValue={archived ? false : enabled}
              onChange={v => !archived && handleSwitch(v ? 'enable' : 'disable')}
              disabled={archived}
              size='md'
            />
          </Tooltip>
        </div>
      )
    }
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
    if (!e)
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
    else
      notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
    if (operationName === 'delete')
      setDeleting(false)
    onUpdate(operationName)
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
          needsDelay
        >
          <button
            className={cn('rounded-lg mr-2 cursor-pointer',
              !isListScene
                ? 'p-2 bg-components-button-secondary-bg hover:bg-components-button-secondary-bg-hover border-[0.5px] border-components-button-secondary-border hover:border-components-button-secondary-border-hover shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px]'
                : 'p-0.5 hover:bg-state-base-hover')}
            onClick={() => router.push(`/datasets/${datasetId}/documents/${detail.id}/settings`)}>
            <RiEqualizer2Line className='w-4 h-4 text-components-button-secondary-text' />
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
                    <RiEditLine className='w-4 h-4 text-text-tertiary' />
                    <span className={s.actionName}>{t('datasetDocuments.list.table.rename')}</span>
                  </div>
                  {['notion_import', DataSourceType.WEB].includes(data_source_type) && (
                    <div className={s.actionItem} onClick={() => onOperate('sync')}>
                      <RiLoopLeftLine className='w-4 h-4 text-text-tertiary' />
                      <span className={s.actionName}>{t('datasetDocuments.list.action.sync')}</span>
                    </div>
                  )}
                  <Divider className='my-1' />
                </>
              )}
              {!archived && <div className={s.actionItem} onClick={() => onOperate('archive')}>
                <RiArchive2Line className='w-4 h-4 text-text-tertiary' />
                <span className={s.actionName}>{t('datasetDocuments.list.action.archive')}</span>
              </div>}
              {archived && (
                <div className={s.actionItem} onClick={() => onOperate('un_archive')}>
                  <RiArchive2Line className='w-4 h-4 text-text-tertiary' />
                  <span className={s.actionName}>{t('datasetDocuments.list.action.unarchive')}</span>
                </div>
              )}
              <div className={cn(s.actionItem, s.deleteActionItem, 'group')} onClick={() => setShowModal(true)}>
                <RiDeleteBinLine className={'w-4 h-4 text-text-tertiary group-hover:text-text-destructive'} />
                <span className={cn(s.actionName, 'group-hover:text-text-destructive')}>{t('datasetDocuments.list.action.delete')}</span>
              </div>
            </div>
          }
          trigger='click'
          position='br'
          btnElement={
            <div className={cn(s.commonIcon)}>
              <RiMoreFill className='w-4 h-4 text-text-components-button-secondary-text' />
            </div>
          }
          btnClassName={open => cn(isListScene ? s.actionIconWrapperList : s.actionIconWrapperDetail, open ? '!bg-gray-100 !shadow-none' : '!bg-transparent')}
          popupClassName='!w-full'
          className={`flex justify-end !w-[200px] h-fit !z-20 ${className}`}
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
    <div className={cn(isEmptyStyle ? 'text-gray-400' : 'text-gray-700', s.tdValue)}>
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
  datasetId: string
  onUpdate: () => void
}

/**
 * Document list component including basic information
 */
const DocumentList: FC<IDocumentListProps> = ({ embeddingAvailable, documents = [], datasetId, onUpdate }) => {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()
  const router = useRouter()
  const [localDocs, setLocalDocs] = useState<LocalDoc[]>(documents)
  const [enableSort, setEnableSort] = useState(false)

  useEffect(() => {
    setLocalDocs(documents)
  }, [documents])

  const onClickSort = () => {
    setEnableSort(!enableSort)
    if (!enableSort) {
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

  return (
    <div className='w-full h-full overflow-x-auto'>
      <table className={`min-w-[700px] max-w-full w-full border-collapse border-0 text-sm mt-3 ${s.documentTable}`}>
        <thead className="h-8 leading-8 border-b border-gray-200 text-gray-500 font-medium text-xs uppercase">
          <tr>
            <td className='w-12'>#</td>
            <td>
              <div className='flex'>
                {t('datasetDocuments.list.table.header.fileName')}
              </div>
            </td>
            <td className='w-24'>{t('datasetDocuments.list.table.header.words')}</td>
            <td className='w-44'>{t('datasetDocuments.list.table.header.hitCount')}</td>
            <td className='w-44'>
              <div className='flex justify-between items-center'>
                {t('datasetDocuments.list.table.header.uploadTime')}
                <ArrowDownIcon className={cn('h-3 w-3 stroke-current stroke-2 cursor-pointer', enableSort ? 'text-gray-500' : 'text-gray-300')} onClick={onClickSort} />
              </div>
            </td>
            <td className='w-40'>{t('datasetDocuments.list.table.header.status')}</td>
            <td className='w-20'>{t('datasetDocuments.list.table.header.action')}</td>
          </tr>
        </thead>
        <tbody className="text-gray-700">
          {localDocs.map((doc) => {
            const isFile = doc.data_source_type === DataSourceType.FILE
            const fileType = isFile ? doc.data_source_detail_dict?.upload_file?.extension : ''
            return <tr
              key={doc.id}
              className={'border-b border-gray-200 h-8 hover:bg-gray-50 cursor-pointer'}
              onClick={() => {
                router.push(`/datasets/${datasetId}/documents/${doc.id}`)
              }}>
              <td className='text-left align-middle text-gray-500 text-xs'>{doc.position}</td>
              <td>
                <div className='group flex items-center justify-between'>
                  <span className={s.tdValue}>
                    {doc?.data_source_type === DataSourceType.NOTION && <NotionIcon className='inline-flex -mt-[3px] mr-1.5 align-middle' type='page' src={doc.data_source_info.notion_page_icon} />
                    }
                    {doc?.data_source_type === DataSourceType.FILE && <div className={cn(s[`${doc?.data_source_info?.upload_file?.extension ?? fileType}Icon`], s.commonIcon, 'mr-1.5')}></div>}
                    {doc?.data_source_type === DataSourceType.WEB && <Globe01 className='inline-flex -mt-[3px] mr-1.5 align-middle' />
                    }
                    {
                      doc.name
                    }
                  </span>
                  <div className='group-hover:flex hidden'>
                    <Tooltip
                      popupContent={t('datasetDocuments.list.table.rename')}
                    >
                      <div
                        className='p-1 rounded-md cursor-pointer hover:bg-black/5'
                        onClick={(e) => {
                          e.stopPropagation()
                          handleShowRenameModal(doc)
                        }}
                      >
                        <Edit03 className='w-4 h-4 text-gray-500' />
                      </div>
                    </Tooltip>
                  </div>
                </div>

              </td>
              <td>{renderCount(doc.word_count)}</td>
              <td>{renderCount(doc.hit_count)}</td>
              <td className='text-gray-500 text-[13px]'>
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
