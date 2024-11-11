/* eslint-disable no-mixed-operators */
'use client'
import type { FC, SVGProps } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import { useBoolean, useDebounceFn } from 'ahooks'
import { ArrowDownIcon, TrashIcon } from '@heroicons/react/24/outline'
import { pick } from 'lodash-es'
import {
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
import type { IndicatorProps } from '@/app/components/header/indicator'
import Indicator from '@/app/components/header/indicator'
import { asyncRunSafe } from '@/utils'
import { formatNumber } from '@/utils/format'
import { archiveDocument, deleteDocument, disableDocument, enableDocument, syncDocument, syncWebsite, unArchiveDocument } from '@/service/datasets'
import NotionIcon from '@/app/components/base/notion-icon'
import ProgressBar from '@/app/components/base/progress-bar'
import { DataSourceType, type DocumentDisplayStatus, type SimpleDocumentDetail } from '@/models/datasets'
import type { CommonResponse } from '@/models/common'
import useTimestamp from '@/hooks/use-timestamp'

export const SettingsIcon = ({ className }: SVGProps<SVGElement>) => {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className ?? ''}>
    <path d="M2 5.33325L10 5.33325M10 5.33325C10 6.43782 10.8954 7.33325 12 7.33325C13.1046 7.33325 14 6.43782 14 5.33325C14 4.22868 13.1046 3.33325 12 3.33325C10.8954 3.33325 10 4.22868 10 5.33325ZM6 10.6666L14 10.6666M6 10.6666C6 11.7712 5.10457 12.6666 4 12.6666C2.89543 12.6666 2 11.7712 2 10.6666C2 9.56202 2.89543 8.66659 4 8.66659C5.10457 8.66659 6 9.56202 6 10.6666Z" stroke="#667085" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

export const SyncIcon = () => {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5.69773 13.1783C7.29715 13.8879 9.20212 13.8494 10.8334 12.9075C13.5438 11.3427 14.4724 7.87704 12.9076 5.16672L12.7409 4.87804M3.09233 10.8335C1.52752 8.12314 2.45615 4.65746 5.16647 3.09265C6.7978 2.15081 8.70277 2.11227 10.3022 2.82185M1.66226 10.8892L3.48363 11.3773L3.97166 9.5559M12.0284 6.44393L12.5164 4.62256L14.3378 5.1106" stroke="#667085" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
}

export const FilePlusIcon = ({ className }: SVGProps<SVGElement>) => {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className ?? ''}>
    <path d="M13.3332 6.99992V4.53325C13.3332 3.41315 13.3332 2.85309 13.1152 2.42527C12.9234 2.04895 12.6175 1.74299 12.2412 1.55124C11.8133 1.33325 11.2533 1.33325 10.1332 1.33325H5.8665C4.7464 1.33325 4.18635 1.33325 3.75852 1.55124C3.3822 1.74299 3.07624 2.04895 2.88449 2.42527C2.6665 2.85309 2.6665 3.41315 2.6665 4.53325V11.4666C2.6665 12.5867 2.6665 13.1467 2.88449 13.5746C3.07624 13.9509 3.3822 14.2569 3.75852 14.4486C4.18635 14.6666 4.7464 14.6666 5.8665 14.6666H7.99984M9.33317 7.33325H5.33317M6.6665 9.99992H5.33317M10.6665 4.66659H5.33317M11.9998 13.9999V9.99992M9.99984 11.9999H13.9998" stroke="#667085" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

export const ArchiveIcon = ({ className }: SVGProps<SVGElement>) => {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className ?? ''}>
    <path d="M2.66683 5.33106C2.55749 5.32824 2.47809 5.32191 2.40671 5.30771C1.87779 5.2025 1.46432 4.78904 1.35912 4.26012C1.3335 4.13132 1.3335 3.97644 1.3335 3.66667C1.3335 3.3569 1.3335 3.20201 1.35912 3.07321C1.46432 2.54429 1.87779 2.13083 2.40671 2.02562C2.53551 2 2.69039 2 3.00016 2H13.0002C13.3099 2 13.4648 2 13.5936 2.02562C14.1225 2.13083 14.536 2.54429 14.6412 3.07321C14.6668 3.20201 14.6668 3.3569 14.6668 3.66667C14.6668 3.97644 14.6668 4.13132 14.6412 4.26012C14.536 4.78904 14.1225 5.2025 13.5936 5.30771C13.5222 5.32191 13.4428 5.32824 13.3335 5.33106M6.66683 8.66667H9.3335M2.66683 5.33333H13.3335V10.8C13.3335 11.9201 13.3335 12.4802 13.1155 12.908C12.9238 13.2843 12.6178 13.5903 12.2415 13.782C11.8137 14 11.2536 14 10.1335 14H5.86683C4.74672 14 4.18667 14 3.75885 13.782C3.38252 13.5903 3.07656 13.2843 2.88482 12.908C2.66683 12.4802 2.66683 11.9201 2.66683 10.8V5.33333Z" stroke="#667085" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

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

// status item for list
export const StatusItem: FC<{
  status: DocumentDisplayStatus
  reverse?: boolean
  scene?: 'list' | 'detail'
  textCls?: string
  errorMessage?: string
}> = ({ status, reverse = false, scene = 'list', textCls = '', errorMessage }) => {
  const DOC_INDEX_STATUS_MAP = useIndexStatus()
  const localStatus = status.toLowerCase() as keyof typeof DOC_INDEX_STATUS_MAP
  return <div className={
    cn('flex items-center',
      reverse ? 'flex-row-reverse' : '',
      scene === 'detail' ? s.statusItemDetail : '')
  }>
    <Indicator color={DOC_INDEX_STATUS_MAP[localStatus]?.color as IndicatorProps['color']} className={reverse ? 'ml-2' : 'mr-2'} />
    <span className={cn('text-gray-700 text-sm', textCls)}>{DOC_INDEX_STATUS_MAP[localStatus]?.text}</span>
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
      <Popover
        htmlContent={
          <div className='w-full py-1'>
            {!isListScene && <>
              <div className='flex justify-between items-center mx-4 pt-2'>
                <span className={cn(s.actionName, 'font-medium')}>
                  {!archived && enabled ? t('datasetDocuments.list.index.enable') : t('datasetDocuments.list.index.disable')}
                </span>
                <Tooltip
                  popupContent={t('datasetDocuments.list.action.enableWarning')}
                  popupClassName='!font-semibold'
                  needsDelay
                  disabled={!archived}
                >
                  <div>
                    <Switch
                      defaultValue={archived ? false : enabled}
                      onChange={v => !archived && handleSwitch(v ? 'enable' : 'disable')}
                      disabled={archived}
                      size='md'
                    />
                  </div>
                </Tooltip>
              </div>
              <div className='mx-4 pb-1 pt-0.5 text-xs text-gray-500'>
                {!archived && enabled ? t('datasetDocuments.list.index.enableTip') : t('datasetDocuments.list.index.disableTip')}
              </div>
              <Divider />
            </>}
            {!archived && (
              <>
                <div className={s.actionItem} onClick={() => {
                  handleShowRenameModal({
                    id: detail.id,
                    name: detail.name,
                  })
                }}>
                  <Edit03 className='w-4 h-4 text-gray-500' />
                  <span className={s.actionName}>{t('datasetDocuments.list.table.rename')}</span>
                </div>
                <div className={s.actionItem} onClick={() => router.push(`/datasets/${datasetId}/documents/${detail.id}/settings`)}>
                  <SettingsIcon />
                  <span className={s.actionName}>{t('datasetDocuments.list.action.settings')}</span>
                </div>
                {['notion_import', DataSourceType.WEB].includes(data_source_type) && (
                  <div className={s.actionItem} onClick={() => onOperate('sync')}>
                    <SyncIcon />
                    <span className={s.actionName}>{t('datasetDocuments.list.action.sync')}</span>
                  </div>
                )}
                <Divider className='my-1' />
              </>
            )}
            {!archived && <div className={s.actionItem} onClick={() => onOperate('archive')}>
              <ArchiveIcon />
              <span className={s.actionName}>{t('datasetDocuments.list.action.archive')}</span>
            </div>}
            {archived && (
              <div className={s.actionItem} onClick={() => onOperate('un_archive')}>
                <ArchiveIcon />
                <span className={s.actionName}>{t('datasetDocuments.list.action.unarchive')}</span>
              </div>
            )}
            <div className={cn(s.actionItem, s.deleteActionItem, 'group')} onClick={() => setShowModal(true)}>
              <TrashIcon className={'w-4 h-4 stroke-current text-gray-500 stroke-2 group-hover:text-red-500'} />
              <span className={cn(s.actionName, 'group-hover:text-red-500')}>{t('datasetDocuments.list.action.delete')}</span>
            </div>
          </div>
        }
        trigger='click'
        position='br'
        btnElement={
          <div className={cn(s.commonIcon)}>
            <RiMoreFill className='w-4 h-4 text-gray-700' />
          </div>
        }
        btnClassName={open => cn(isListScene ? s.actionIconWrapperList : s.actionIconWrapperDetail, open ? '!bg-gray-100 !shadow-none' : '!bg-transparent')}
        className={`flex justify-end !w-[200px] h-fit !z-20 ${className}`}
      />
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
