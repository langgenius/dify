import type { OperationName } from '../types'
import type { CommonResponse } from '@/models/common'
import type { DocumentDownloadResponse } from '@/service/datasets'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Switch } from '@langgenius/dify-ui/switch'
import { toast } from '@langgenius/dify-ui/toast'
import { useBoolean, useDebounceFn } from 'ahooks'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { IS_CE_EDITION } from '@/config'
import { DataSourceType, DocumentActionType } from '@/models/datasets'
import { useRouter } from '@/next/navigation'
import { useDocumentArchive, useDocumentDelete, useDocumentDisable, useDocumentDownload, useDocumentEnable, useDocumentPause, useDocumentResume, useDocumentSummary, useDocumentUnArchive, useSyncDocument, useSyncWebsite } from '@/service/knowledge/use-document'
import { asyncRunSafe } from '@/utils'
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
  canEdit: boolean
  canDownload: boolean
  canDelete: boolean
  canViewSettings: boolean
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
  canEdit,
  canDownload,
  canDelete,
  canViewSettings,
}: OperationsProps) => {
  const { id, name, enabled = false, archived = false, data_source_type, display_status } = detail || {}
  const [showModal, setShowModal] = useState(false)
  const [isOperationsMenuOpen, setIsOperationsMenuOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
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
  const canShowRenameAction = canEdit && !archived
  const canShowSummaryAction = canEdit && !archived && IS_CE_EDITION
  const canShowSettingsAction = canViewSettings
  const canShowDownloadAction = canDownload && data_source_type === DataSourceType.FILE
  const canShowSyncAction = canEdit && !archived && ['notion_import', DataSourceType.WEB].includes(data_source_type)
  const canShowPauseAction = canEdit && !archived && display_status?.toLowerCase() === 'indexing'
  const canShowResumeAction = canEdit && !archived && display_status?.toLowerCase() === 'paused'
  const canShowArchiveAction = canEdit && !archived
  const canShowUnarchiveAction = canEdit && archived
  const canShowDeleteAction = canDelete
  const canShowPrimarySection = canShowRenameAction || canShowSummaryAction || canShowSettingsAction || canShowDownloadAction || canShowSyncAction
  const canShowStatusSection = canShowPauseAction || canShowResumeAction || canShowArchiveAction || canShowUnarchiveAction
  const hasOperationsMenu = embeddingAvailable && (canShowPrimarySection || canShowStatusSection || canShowDeleteAction)
  const canOperate = useCallback((operationName: OperationName) => {
    if (operationName === DocumentActionType.delete)
      return canDelete

    return canEdit
  }, [canDelete, canEdit])
  const onOperate = useCallback(async (operationName: OperationName) => {
    if (!canOperate(operationName))
      return

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
      toast.success(t($ => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
      // If it is a delete operation, need to update the selectedIds state
      if (selectedIds && onSelectedIdChange && operationName === DocumentActionType.delete)
        onSelectedIdChange(selectedIds.filter(selectedId => selectedId !== id))
      onUpdate(operationName)
    }
    else {
      toast.error(t($ => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
    }
    if (operationName === DocumentActionType.delete)
      setDeleting(false)
  }, [
    archiveDocument,
    canOperate,
    data_source_type,
    datasetId,
    deleteDocument,
    disableDocument,
    enableDocument,
    generateSummary,
    id,
    onSelectedIdChange,
    onUpdate,
    pauseDocument,
    resumeDocument,
    selectedIds,
    syncDocument,
    syncWebsite,
    t,
    unArchiveDocument,
  ])
  const { run: handleSwitch } = useDebounceFn((operationName: OperationName) => {
    if (!canEdit)
      return
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
  const [isShowRenameModal, { setTrue: setShowRenameModalTrue, setFalse: setShowRenameModalFalse }] = useBoolean(false)
  const handleShowRenameModal = useCallback((doc: {
    id: string
    name: string
  }) => {
    if (!canEdit)
      return

    setCurrDocument(doc)
    setShowRenameModalTrue()
  }, [canEdit, setShowRenameModalTrue])
  const handleRenamed = useCallback(() => {
    onUpdate()
  }, [onUpdate])
  const closeOperationsMenu = useCallback(() => {
    setIsOperationsMenuOpen(false)
  }, [])
  const stopPropagation = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation()
  }, [])
  const handleDownload = useCallback(async () => {
    if (!canDownload)
      return
    // Avoid repeated clicks while the signed URL request is in-flight.
    if (isDownloading)
      return
    // Request a signed URL first (it points to `/files/<id>/file-preview?...&as_attachment=true`).
    const [e, res] = await asyncRunSafe<DocumentDownloadResponse>(downloadDocument({ datasetId, documentId: id }) as Promise<DocumentDownloadResponse>)
    if (e || !res?.url) {
      toast.error(t($ => $['actionMsg.downloadUnsuccessfully'], { ns: 'common' }))
      return
    }
    // Trigger download without navigating away (helps avoid duplicate downloads in some browsers).
    downloadUrl({ url: res.url, fileName: name })
  }, [canDownload, datasetId, downloadDocument, id, isDownloading, name, t])
  const handleShowRename = useCallback(() => {
    closeOperationsMenu()
    handleShowRenameModal({
      id: detail.id,
      name: detail.name,
    })
  }, [closeOperationsMenu, detail.id, detail.name, handleShowRenameModal])
  const handleMenuOperation = useCallback((operationName: OperationName) => {
    closeOperationsMenu()
    void onOperate(operationName)
  }, [closeOperationsMenu, onOperate])
  const handleDeleteClick = useCallback(() => {
    if (!canDelete)
      return

    closeOperationsMenu()
    setShowModal(true)
  }, [canDelete, closeOperationsMenu])
  const handleDownloadClick = useCallback((evt: React.MouseEvent<HTMLElement>) => {
    evt.preventDefault()
    evt.stopPropagation()
    evt.nativeEvent.stopImmediatePropagation?.()
    if (!canDownload)
      return

    closeOperationsMenu()
    void handleDownload()
  }, [canDownload, closeOperationsMenu, handleDownload])
  const menuActionClassName = cn(s.actionItem, 'border-none bg-transparent')
  const menuDeleteActionClassName = cn(menuActionClassName, s.deleteActionItem, 'group')
  const handleSettingsClick = useCallback((evt: React.MouseEvent<HTMLElement>) => {
    evt.preventDefault()
    evt.stopPropagation()
    evt.nativeEvent.stopImmediatePropagation?.()
    if (!canViewSettings)
      return

    closeOperationsMenu()
    router.push(`/datasets/${datasetId}/documents/${detail.id}/settings`)
  }, [canViewSettings, closeOperationsMenu, datasetId, detail.id, router])
  const settingsMenuItem = (
    <button type="button" className={cn(menuActionClassName, 'text-left')} onClick={handleSettingsClick}>
      <span aria-hidden className="i-ri-equalizer-2-line size-4 text-text-tertiary" />
      <span className={s.actionName}>{t($ => $['list.action.settings'], { ns: 'datasetDocuments' })}</span>
    </button>
  )
  const renderListSwitch = () => {
    if (!canEdit)
      return <Switch checked={archived ? false : enabled} onCheckedChange={noop} disabled={true} size="md" />

    if (archived) {
      return (
        <Popover>
          <PopoverTrigger nativeButton={false} openOnHover render={<div><Switch checked={false} onCheckedChange={noop} disabled={true} size="md" /></div>} />
          <PopoverContent popupClassName="px-3 py-2 font-semibold system-xs-regular text-text-tertiary">
            {t($ => $['list.action.enableWarning'], { ns: 'datasetDocuments' })}
          </PopoverContent>
        </Popover>
      )
    }

    return <Switch checked={enabled} onCheckedChange={v => handleSwitch(v ? 'enable' : 'disable')} size="md" />
  }

  return (
    <div className="flex items-center" role="presentation" onClick={stopPropagation} onKeyDown={stopPropagation}>
      {isListScene && !embeddingAvailable && (<Switch checked={false} onCheckedChange={noop} disabled={true} size="md" />)}
      {isListScene && embeddingAvailable && (
        <>
          {renderListSwitch()}
          {hasOperationsMenu && <Divider className="mr-2! ml-4! h-3!" type="vertical" />}
        </>
      )}
      {hasOperationsMenu && (
        <>
          <DropdownMenu open={isOperationsMenuOpen} onOpenChange={setIsOperationsMenuOpen}>
            <DropdownMenuTrigger
              aria-label={t($ => $['operation.more'], { ns: 'common' })}
              className={cn(
                isListScene ? s.actionIconWrapperList : s.actionIconWrapperDetail,
                'inline-flex items-center justify-center',
                !isListScene && 'h-8! w-8! rounded-lg backdrop-blur-[5px]',
                isListScene && 'bg-transparent!',
                'data-popup-open:shadow-none! data-popup-open:hover:bg-state-base-hover!',
              )}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
              }}
            >
              <div className={cn(s.commonIcon)}>
                <span aria-hidden className="i-ri-more-fill size-4 text-components-button-secondary-text" />
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              placement="bottom-end"
              sideOffset={4}
              popupClassName={cn('w-[200px] py-0', className)}
            >
              <div className="w-full py-1">
                {canShowPrimarySection && (
                  <>
                    {canShowRenameAction && (
                      <button type="button" className={cn(menuActionClassName, 'text-left')} onClick={handleShowRename}>
                        <span aria-hidden className="i-ri-edit-line size-4 text-text-tertiary" />
                        <span className={s.actionName}>{t($ => $['list.table.rename'], { ns: 'datasetDocuments' })}</span>
                      </button>
                    )}
                    {canShowSummaryAction && (
                      <button type="button" className={cn(menuActionClassName, 'text-left')} onClick={() => handleMenuOperation('summary')}>
                        <span aria-hidden className="i-custom-vender-knowledge-search-lines-sparkle size-4 text-text-tertiary" />
                        <span className={s.actionName}>{t($ => $['list.action.summary'], { ns: 'datasetDocuments' })}</span>
                      </button>
                    )}
                    {canShowSettingsAction && settingsMenuItem}
                    {canShowDownloadAction && (
                      <button type="button" className={cn(menuActionClassName, 'text-left')} onClick={handleDownloadClick}>
                        <span aria-hidden className="i-ri-download-2-line size-4 text-text-tertiary" />
                        <span className={s.actionName}>{t($ => $['list.action.download'], { ns: 'datasetDocuments' })}</span>
                      </button>
                    )}
                    {canShowSyncAction && (
                      <button type="button" className={cn(menuActionClassName, 'text-left')} onClick={() => handleMenuOperation('sync')}>
                        <span aria-hidden className="i-ri-loop-left-line size-4 text-text-tertiary" />
                        <span className={s.actionName}>{t($ => $['list.action.sync'], { ns: 'datasetDocuments' })}</span>
                      </button>
                    )}
                    {(canShowStatusSection || canShowDeleteAction) && <Divider className="my-1" />}
                  </>
                )}
                {canShowPauseAction && (
                  <button type="button" className={cn(menuActionClassName, 'text-left')} onClick={() => handleMenuOperation('pause')}>
                    <span aria-hidden className="i-ri-pause-circle-line size-4 text-text-tertiary" />
                    <span className={s.actionName}>{t($ => $['list.action.pause'], { ns: 'datasetDocuments' })}</span>
                  </button>
                )}
                {canShowResumeAction && (
                  <button type="button" className={cn(menuActionClassName, 'text-left')} onClick={() => handleMenuOperation('resume')}>
                    <span aria-hidden className="i-ri-play-circle-line size-4 text-text-tertiary" />
                    <span className={s.actionName}>{t($ => $['list.action.resume'], { ns: 'datasetDocuments' })}</span>
                  </button>
                )}
                {canShowArchiveAction && (
                  <button type="button" className={cn(menuActionClassName, 'text-left')} onClick={() => handleMenuOperation('archive')}>
                    <span aria-hidden className="i-ri-archive-2-line size-4 text-text-tertiary" />
                    <span className={s.actionName}>{t($ => $['list.action.archive'], { ns: 'datasetDocuments' })}</span>
                  </button>
                )}
                {canShowUnarchiveAction && (
                  <button type="button" className={cn(menuActionClassName, 'text-left')} onClick={() => handleMenuOperation('un_archive')}>
                    <span aria-hidden className="i-ri-archive-2-line size-4 text-text-tertiary" />
                    <span className={s.actionName}>{t($ => $['list.action.unarchive'], { ns: 'datasetDocuments' })}</span>
                  </button>
                )}
                {canShowDeleteAction && (
                  <button type="button" className={cn(menuDeleteActionClassName, 'text-left')} onClick={handleDeleteClick}>
                    <span aria-hidden className="i-ri-delete-bin-line size-4 text-text-tertiary group-hover:text-text-destructive" />
                    <span className={cn(s.actionName, 'group-hover:text-text-destructive')}>{t($ => $['list.action.delete'], { ns: 'datasetDocuments' })}</span>
                  </button>
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      <AlertDialog open={showModal} onOpenChange={open => !open && setShowModal(false)}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t($ => $['list.delete.title'], { ns: 'datasetDocuments' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t($ => $['list.delete.content'], { ns: 'datasetDocuments' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>{t($ => $['operation.cancel'], { ns: 'common' })}</AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={deleting} disabled={deleting} onClick={() => onOperate('delete')}>
              {t($ => $['operation.sure'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>

      {isShowRenameModal && currDocument && (<RenameModal datasetId={datasetId} documentId={currDocument.id} name={currDocument.name} onClose={setShowRenameModalFalse} onSaved={handleRenamed} />)}
    </div>
  )
}
export default React.memo(Operations)
