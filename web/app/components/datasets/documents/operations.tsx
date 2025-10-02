import React, { useCallback, useState } from 'react'
import { useContext } from 'use-context-selector'
import { ToastContext } from '../../base/toast'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import {
  useDocumentArchive,
  useDocumentDelete,
  useDocumentDisable,
  useDocumentEnable,
  useDocumentPause,
  useDocumentResume,
  useDocumentUnArchive,
  useSyncDocument,
  useSyncWebsite,
} from '@/service/knowledge/use-document'
import type { OperationName } from './types'
import { asyncRunSafe } from '@/utils'
import type { CommonResponse } from '@/models/common'
import { useBoolean, useDebounceFn } from 'ahooks'
import Switch from '../../base/switch'
import { noop } from 'lodash-es'
import Tooltip from '../../base/tooltip'
import Divider from '../../base/divider'
import cn from '@/utils/classnames'
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
import CustomPopover from '../../base/popover'
import s from './style.module.css'
import { DataSourceType, DocumentActionType } from '@/models/datasets'
import Confirm from '../../base/confirm'
import RenameModal from './rename-modal'

type OperationsProps = {
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
  selectedIds?: string[]
  onSelectedIdChange?: (ids: string[]) => void
  datasetId: string
  onUpdate: (operationName?: string) => void
  scene?: 'list' | 'detail'
  className?: string
}

const Operations = ({
  embeddingAvailable,
  datasetId,
  detail,
  selectedIds,
  onSelectedIdChange,
  onUpdate,
  scene = 'list',
  className = '',
}: OperationsProps) => {
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
      // If it is a delete operation, need to update the selectedIds state
      if (selectedIds && onSelectedIdChange && operationName === DocumentActionType.delete)
        onSelectedIdChange(selectedIds.filter(selectedId => selectedId !== id))
      onUpdate(operationName)
    }
    else { notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') }) }
    if (operationName === DocumentActionType.delete)
      setDeleting(false)
  }

  const { run: handleSwitch } = useDebounceFn((operationName: OperationName) => {
    if (operationName === DocumentActionType.enable && enabled)
      return
    if (operationName === DocumentActionType.disable && !enabled)
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
          needsDelay={false}
        >
          <button type="button"
            className={cn('mr-2 cursor-pointer rounded-lg',
              !isListScene
                ? 'border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg p-2 shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px] hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover'
                : 'p-0.5 hover:bg-state-base-hover')}
            onClick={() => router.push(`/datasets/${datasetId}/documents/${detail.id}/settings`)}>
            <RiEqualizer2Line className='h-4 w-4 text-components-button-secondary-text' />
          </button>
        </Tooltip>
        <CustomPopover
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

export default React.memo(Operations)
