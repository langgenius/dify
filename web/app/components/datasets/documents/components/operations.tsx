import type { OperationName } from '../types'
import type { CommonResponse } from '@/models/common'
import type { DocumentDownloadResponse } from '@/service/datasets'
import {
  RiArchive2Line,
  RiDeleteBinLine,
  RiDownload2Line,
  RiEditLine,
  RiEqualizer2Line,
  RiLoopLeftLine,
  RiMoreFill,
  RiPauseCircleLine,
  RiPlayCircleLine,
} from '@remixicon/react'
import { useBoolean, useDebounceFn } from 'ahooks'
import { noop } from 'es-toolkit/function'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import Confirm from '@/app/components/base/confirm'
import Divider from '@/app/components/base/divider'
import { SearchLinesSparkle } from '@/app/components/base/icons/src/vender/knowledge'
import CustomPopover from '@/app/components/base/popover'
import Switch from '@/app/components/base/switch'
import { ToastContext } from '@/app/components/base/toast'
import Tooltip from '@/app/components/base/tooltip'
import { DataSourceType, DocumentActionType } from '@/models/datasets'
import {
  useDocumentArchive,
  useDocumentDelete,
  useDocumentDisable,
  useDocumentDownload,
  useDocumentEnable,
  useDocumentPause,
  useDocumentResume,
  useDocumentSummary,
  useDocumentUnArchive,
  useSyncDocument,
  useSyncWebsite,
} from '@/service/knowledge/use-document'
import { asyncRunSafe } from '@/utils'
import { cn } from '@/utils/classnames'
import { downloadUrl } from '@/utils/download'
import s from '../style.module.css'
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
  const { id, name, enabled = false, archived = false, data_source_type, display_status } = detail || {}
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
  const { mutateAsync: downloadDocument, isPending: isDownloading } = useDocumentDownload()
  const { mutateAsync: syncDocument } = useSyncDocument()
  const { mutateAsync: syncWebsite } = useSyncWebsite()
  const { mutateAsync: generateSummary } = useDocumentSummary()
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
      case 'summary':
        opApi = generateSummary
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
      notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
      // If it is a delete operation, need to update the selectedIds state
      if (selectedIds && onSelectedIdChange && operationName === DocumentActionType.delete)
        onSelectedIdChange(selectedIds.filter(selectedId => selectedId !== id))
      onUpdate(operationName)
    }
    else { notify({ type: 'error', message: t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }) }) }
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

  const handleDownload = useCallback(async () => {
    // Avoid repeated clicks while the signed URL request is in-flight.
    if (isDownloading)
      return

    // Request a signed URL first (it points to `/files/<id>/file-preview?...&as_attachment=true`).
    const [e, res] = await asyncRunSafe<DocumentDownloadResponse>(
      downloadDocument({ datasetId, documentId: id }) as Promise<DocumentDownloadResponse>,
    )
    if (e || !res?.url) {
      notify({ type: 'error', message: t('actionMsg.downloadUnsuccessfully', { ns: 'common' }) })
      return
    }

    // Trigger download without navigating away (helps avoid duplicate downloads in some browsers).
    downloadUrl({ url: res.url, fileName: name })
  }, [datasetId, downloadDocument, id, isDownloading, name, notify, t])

  return (
    <div className="flex items-center" onClick={e => e.stopPropagation()}>
      {isListScene && !embeddingAvailable && (
        <Switch defaultValue={false} onChange={noop} disabled={true} size="md" />
      )}
      {isListScene && embeddingAvailable && (
        <>
          {archived
            ? (
                <Tooltip
                  popupContent={t('list.action.enableWarning', { ns: 'datasetDocuments' })}
                  popupClassName="!font-semibold"
                >
                  <div>
                    <Switch defaultValue={false} onChange={noop} disabled={true} size="md" />
                  </div>
                </Tooltip>
              )
            : <Switch defaultValue={enabled} onChange={v => handleSwitch(v ? 'enable' : 'disable')} size="md" />}
          <Divider className="!ml-4 !mr-2 !h-3" type="vertical" />
        </>
      )}
      {embeddingAvailable && (
        <>
          <Tooltip
            popupContent={t('list.action.settings', { ns: 'datasetDocuments' })}
            popupClassName="text-text-secondary system-xs-medium"
            needsDelay={false}
          >
            <button
              type="button"
              className={cn('mr-2 cursor-pointer rounded-lg', !isListScene
                ? 'border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg p-2 shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px] hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover'
                : 'p-0.5 hover:bg-state-base-hover')}
              onClick={() => router.push(`/datasets/${datasetId}/documents/${detail.id}/settings`)}
            >
              <RiEqualizer2Line className="h-4 w-4 text-components-button-secondary-text" />
            </button>
          </Tooltip>
          <CustomPopover
            htmlContent={(
              <div className="w-full py-1">
                {!archived && (
                  <>
                    <div
                      className={s.actionItem}
                      onClick={() => {
                        handleShowRenameModal({
                          id: detail.id,
                          name: detail.name,
                        })
                      }}
                    >
                      <RiEditLine className="h-4 w-4 text-text-tertiary" />
                      <span className={s.actionName}>{t('list.table.rename', { ns: 'datasetDocuments' })}</span>
                    </div>
                    {data_source_type === DataSourceType.FILE && (
                      <div
                        className={s.actionItem}
                        onClick={(evt) => {
                          evt.preventDefault()
                          evt.stopPropagation()
                          evt.nativeEvent.stopImmediatePropagation?.()
                          handleDownload()
                        }}
                      >
                        <RiDownload2Line className="h-4 w-4 text-text-tertiary" />
                        <span className={s.actionName}>{t('list.action.download', { ns: 'datasetDocuments' })}</span>
                      </div>
                    )}
                    {['notion_import', DataSourceType.WEB].includes(data_source_type) && (
                      <div className={s.actionItem} onClick={() => onOperate('sync')}>
                        <RiLoopLeftLine className="h-4 w-4 text-text-tertiary" />
                        <span className={s.actionName}>{t('list.action.sync', { ns: 'datasetDocuments' })}</span>
                      </div>
                    )}
                    <div className={s.actionItem} onClick={() => onOperate('summary')}>
                      <SearchLinesSparkle className="h-4 w-4 text-text-tertiary" />
                      <span className={s.actionName}>{t('list.action.summary', { ns: 'datasetDocuments' })}</span>
                    </div>
                    <Divider className="my-1" />
                  </>
                )}
                {archived && data_source_type === DataSourceType.FILE && (
                  <>
                    <div
                      className={s.actionItem}
                      onClick={(evt) => {
                        evt.preventDefault()
                        evt.stopPropagation()
                        evt.nativeEvent.stopImmediatePropagation?.()
                        handleDownload()
                      }}
                    >
                      <RiDownload2Line className="h-4 w-4 text-text-tertiary" />
                      <span className={s.actionName}>{t('list.action.download', { ns: 'datasetDocuments' })}</span>
                    </div>
                    <Divider className="my-1" />
                  </>
                )}
                {!archived && display_status?.toLowerCase() === 'indexing' && (
                  <div className={s.actionItem} onClick={() => onOperate('pause')}>
                    <RiPauseCircleLine className="h-4 w-4 text-text-tertiary" />
                    <span className={s.actionName}>{t('list.action.pause', { ns: 'datasetDocuments' })}</span>
                  </div>
                )}
                {!archived && display_status?.toLowerCase() === 'paused' && (
                  <div className={s.actionItem} onClick={() => onOperate('resume')}>
                    <RiPlayCircleLine className="h-4 w-4 text-text-tertiary" />
                    <span className={s.actionName}>{t('list.action.resume', { ns: 'datasetDocuments' })}</span>
                  </div>
                )}
                {!archived && (
                  <div className={s.actionItem} onClick={() => onOperate('archive')}>
                    <RiArchive2Line className="h-4 w-4 text-text-tertiary" />
                    <span className={s.actionName}>{t('list.action.archive', { ns: 'datasetDocuments' })}</span>
                  </div>
                )}
                {archived && (
                  <div className={s.actionItem} onClick={() => onOperate('un_archive')}>
                    <RiArchive2Line className="h-4 w-4 text-text-tertiary" />
                    <span className={s.actionName}>{t('list.action.unarchive', { ns: 'datasetDocuments' })}</span>
                  </div>
                )}
                <div className={cn(s.actionItem, s.deleteActionItem, 'group')} onClick={() => setShowModal(true)}>
                  <RiDeleteBinLine className="h-4 w-4 text-text-tertiary group-hover:text-text-destructive" />
                  <span className={cn(s.actionName, 'group-hover:text-text-destructive')}>{t('list.action.delete', { ns: 'datasetDocuments' })}</span>
                </div>
              </div>
            )}
            trigger="click"
            position="br"
            btnElement={(
              <div className={cn(s.commonIcon)}>
                <RiMoreFill className="h-4 w-4 text-components-button-secondary-text" />
              </div>
            )}
            btnClassName={open => cn(isListScene ? s.actionIconWrapperList : s.actionIconWrapperDetail, open ? '!hover:bg-state-base-hover !shadow-none' : '!bg-transparent')}
            popupClassName="!w-full"
            className={`!z-20 flex h-fit !w-[200px] justify-end ${className}`}
          />
        </>
      )}
      {showModal
        && (
          <Confirm
            isShow={showModal}
            isLoading={deleting}
            isDisabled={deleting}
            title={t('list.delete.title', { ns: 'datasetDocuments' })}
            content={t('list.delete.content', { ns: 'datasetDocuments' })}
            confirmText={t('operation.sure', { ns: 'common' })}
            onConfirm={() => onOperate('delete')}
            onCancel={() => setShowModal(false)}
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

export default React.memo(Operations)
