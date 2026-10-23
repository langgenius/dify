import type { OperationName } from '../types'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Separator } from '@langgenius/dify-ui/separator'
import { Switch } from '@langgenius/dify-ui/switch'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useBoolean, useDebounceFn } from 'ahooks'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { DataSourceType, DocumentActionType } from '@/models/datasets'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { asyncRunSafe } from '@/utils'
import { downloadUrl } from '@/utils/download'
import s from '../style.module.css'
import RenameModal from './rename-modal'

type OperationsProps = {
  embeddingAvailable: boolean
  detail: {
    id: string
    name?: string | null
    enabled?: boolean | null
    archived?: boolean | null
    data_source_type?: string | null
    doc_form?: string | null
    display_status?: string | null
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
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })
  const isNonCloudEdition = deploymentEdition === 'COMMUNITY' || deploymentEdition === 'ENTERPRISE'
  const { id, name, data_source_type, display_status } = detail
  const enabled = detail.enabled ?? false
  const archived = detail.archived ?? false
  const [showModal, setShowModal] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { t } = useTranslation(['common', 'datasetDocuments'])
  const router = useRouter()
  const documents = consoleQuery.datasets.byDatasetId.documents
  const { mutateAsync: changeDocumentStatus } = useMutation(
    documents.status.byAction.batch.patch.mutationOptions(),
  )
  const { mutateAsync: deleteDocuments } = useMutation(documents.delete.mutationOptions())
  const { mutateAsync: downloadDocument, isPending: isDownloading } = useMutation(
    documents.byDocumentId.download.get.mutationOptions(),
  )
  const { mutateAsync: syncNotionDocument } = useMutation(
    documents.byDocumentId.notion.sync.get.mutationOptions(),
  )
  const { mutateAsync: syncWebsiteDocument } = useMutation(
    documents.byDocumentId.websiteSync.get.mutationOptions(),
  )
  const { mutateAsync: generateSummary } = useMutation(
    documents.generateSummary.post.mutationOptions(),
  )
  const { mutateAsync: pauseDocument } = useMutation(
    documents.byDocumentId.processing.pause.patch.mutationOptions(),
  )
  const { mutateAsync: resumeDocument } = useMutation(
    documents.byDocumentId.processing.resume.patch.mutationOptions(),
  )
  const isListScene = scene === 'list'
  const canShowRenameAction = canEdit && !archived
  const canShowSummaryAction = canEdit && !archived && isNonCloudEdition
  const canShowSettingsAction = canViewSettings
  const canShowDownloadAction = canDownload && data_source_type === DataSourceType.FILE
  const canShowSyncAction =
    canEdit &&
    !archived &&
    (data_source_type === DataSourceType.NOTION || data_source_type === DataSourceType.WEB)
  const canShowPauseAction = canEdit && !archived && display_status?.toLowerCase() === 'indexing'
  const canShowResumeAction = canEdit && !archived && display_status?.toLowerCase() === 'paused'
  const canShowArchiveAction = canEdit && !archived
  const canShowUnarchiveAction = canEdit && archived
  const canShowDeleteAction = canDelete
  const canShowPrimarySection =
    canShowRenameAction ||
    canShowSummaryAction ||
    canShowSettingsAction ||
    canShowDownloadAction ||
    canShowSyncAction
  const canShowStatusSection =
    canShowPauseAction || canShowResumeAction || canShowArchiveAction || canShowUnarchiveAction
  const hasOperationsMenu =
    embeddingAvailable && (canShowPrimarySection || canShowStatusSection || canShowDeleteAction)
  const canOperate = useCallback(
    (operationName: OperationName) => {
      if (operationName === DocumentActionType.delete) return canDelete

      return canEdit
    },
    [canDelete, canEdit],
  )
  const onOperate = useCallback(
    async (operationName: OperationName) => {
      if (!canOperate(operationName)) return

      const documentParams = { dataset_id: datasetId, document_id: id }
      const runOperation = (): Promise<unknown> => {
        switch (operationName) {
          case 'archive':
          case 'un_archive':
          case 'enable':
          case 'disable':
            return changeDocumentStatus({
              params: { dataset_id: datasetId, action: operationName },
              query: { document_id: [id] },
            })
          case 'sync':
            return data_source_type === 'notion_import'
              ? syncNotionDocument({ params: documentParams })
              : syncWebsiteDocument({ params: documentParams })
          case 'summary':
            return generateSummary({
              params: { dataset_id: datasetId },
              body: { document_list: [id] },
            })
          case 'pause':
            return pauseDocument({ params: documentParams })
          case 'resume':
            return resumeDocument({ params: documentParams })
          default:
            setDeleting(true)
            return deleteDocuments({
              params: { dataset_id: datasetId },
              query: { document_id: [id] },
            })
        }
      }
      const [e] = await asyncRunSafe(runOperation())
      if (!e) {
        // The switch already shows the result of enable and disable.
        if (operationName !== 'enable' && operationName !== 'disable')
          toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
        // If it is a delete operation, need to update the selectedIds state
        if (selectedIds && onSelectedIdChange && operationName === DocumentActionType.delete)
          onSelectedIdChange(selectedIds.filter((selectedId) => selectedId !== id))
        onUpdate(operationName)
      } else {
        toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
      }
      if (operationName === DocumentActionType.delete) setDeleting(false)
    },
    [
      canOperate,
      changeDocumentStatus,
      data_source_type,
      datasetId,
      deleteDocuments,
      generateSummary,
      id,
      onSelectedIdChange,
      onUpdate,
      pauseDocument,
      resumeDocument,
      selectedIds,
      syncNotionDocument,
      syncWebsiteDocument,
      t,
    ],
  )
  const { run: handleSwitch } = useDebounceFn(
    (operationName: OperationName) => {
      if (!canEdit) return
      if (operationName === DocumentActionType.enable && enabled) return
      if (operationName === DocumentActionType.disable && !enabled) return
      onOperate(operationName)
    },
    { wait: 500 },
  )
  const [currDocument, setCurrDocument] = useState<{
    id: string
    name: string
  } | null>(null)
  const [
    isShowRenameModal,
    { setTrue: setShowRenameModalTrue, setFalse: setShowRenameModalFalse },
  ] = useBoolean(false)
  const handleShowRenameModal = useCallback(
    (doc: { id: string; name: string }) => {
      if (!canEdit) return

      setCurrDocument(doc)
      setShowRenameModalTrue()
    },
    [canEdit, setShowRenameModalTrue],
  )
  const handleRenamed = useCallback(() => {
    onUpdate()
  }, [onUpdate])
  const stopPropagation = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation()
  }, [])
  const handleDownload = useCallback(async () => {
    if (!canDownload) return
    // Avoid repeated clicks while the signed URL request is in-flight.
    if (isDownloading) return
    // Request a signed URL first (it points to `/files/<id>/file-preview?...&as_attachment=true`).
    const [e, res] = await asyncRunSafe(
      downloadDocument({ params: { dataset_id: datasetId, document_id: id } }),
    )
    if (e || !res?.url) {
      toast.error(t(($) => $['actionMsg.downloadUnsuccessfully'], { ns: 'common' }))
      return
    }
    // Trigger download without navigating away (helps avoid duplicate downloads in some browsers).
    downloadUrl({ url: res.url, fileName: name ?? undefined })
  }, [canDownload, datasetId, downloadDocument, id, isDownloading, name, t])
  const handleShowRename = useCallback(() => {
    handleShowRenameModal({
      id: detail.id,
      name: detail.name ?? '',
    })
  }, [detail.id, detail.name, handleShowRenameModal])
  const handleMenuOperation = useCallback(
    (operationName: OperationName) => {
      void onOperate(operationName)
    },
    [onOperate],
  )
  const handleDeleteClick = useCallback(() => {
    if (!canDelete) return

    setShowModal(true)
  }, [canDelete])
  const handleDownloadClick = useCallback(
    (evt: React.MouseEvent<HTMLElement>) => {
      evt.preventDefault()
      evt.stopPropagation()
      evt.nativeEvent.stopImmediatePropagation?.()
      if (!canDownload) return

      void handleDownload()
    },
    [canDownload, handleDownload],
  )
  const menuActionClassName = 'h-9 w-[calc(100%-8px)] gap-2 px-3 py-2 text-left'
  const menuDeleteActionClassName = cn(menuActionClassName, 'group')
  const handleSettingsClick = useCallback(
    (evt: React.MouseEvent<HTMLElement>) => {
      evt.preventDefault()
      evt.stopPropagation()
      evt.nativeEvent.stopImmediatePropagation?.()
      if (!canViewSettings) return

      router.push(`/datasets/${datasetId}/documents/${detail.id}/settings`)
    },
    [canViewSettings, datasetId, detail.id, router],
  )
  const settingsMenuItem = (
    <DropdownMenuItem className={menuActionClassName} onClick={handleSettingsClick}>
      <span aria-hidden className="i-ri-equalizer-2-line size-4 text-text-tertiary" />
      <span className="text-sm text-text-secondary">
        {t(($) => $['list.action.settings'], { ns: 'datasetDocuments' })}
      </span>
    </DropdownMenuItem>
  )
  const enabledLabel = `${t(($) => $['list.status.enabled'], { ns: 'datasetDocuments' })}: ${name}`
  const renderListSwitch = () => {
    if (!canEdit)
      return (
        <Switch
          aria-label={enabledLabel}
          checked={archived ? false : enabled}
          onCheckedChange={noop}
          disabled={true}
          size="md"
        />
      )

    if (archived) {
      return (
        <Popover>
          <PopoverTrigger
            nativeButton={false}
            openOnHover
            render={
              <div>
                <Switch
                  aria-label={enabledLabel}
                  checked={false}
                  onCheckedChange={noop}
                  disabled={true}
                  size="md"
                />
              </div>
            }
          />
          <PopoverContent className="px-3 py-2 system-xs-regular font-semibold text-text-tertiary">
            {t(($) => $['list.action.enableWarning'], { ns: 'datasetDocuments' })}
          </PopoverContent>
        </Popover>
      )
    }

    return (
      <Switch
        aria-label={enabledLabel}
        checked={enabled}
        onCheckedChange={(v) => handleSwitch(v ? 'enable' : 'disable')}
        size="md"
      />
    )
  }

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Only stops child control events from reaching row navigation.
    <div className="flex items-center" onClick={stopPropagation} onKeyDown={stopPropagation}>
      {isListScene && !embeddingAvailable && (
        <Switch
          aria-label={enabledLabel}
          checked={false}
          onCheckedChange={noop}
          disabled={true}
          size="md"
        />
      )}
      {isListScene && embeddingAvailable && (
        <>
          {renderListSwitch()}
          {hasOperationsMenu && (
            <Separator decorative className="mr-2 ml-4 h-3" orientation="vertical" />
          )}
        </>
      )}
      {hasOperationsMenu && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t(($) => $['operation.more'], { ns: 'common' })}
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
                <span
                  aria-hidden
                  className="i-ri-more-fill size-4 text-components-button-secondary-text"
                />
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent className={cn('w-50', className)}>
              {canShowPrimarySection && (
                <>
                  {canShowRenameAction && (
                    <DropdownMenuItem className={menuActionClassName} onClick={handleShowRename}>
                      <span aria-hidden className="i-ri-edit-line size-4 text-text-tertiary" />
                      <span className="text-sm text-text-secondary">
                        {t(($) => $['list.table.rename'], { ns: 'datasetDocuments' })}
                      </span>
                    </DropdownMenuItem>
                  )}
                  {canShowSummaryAction && (
                    <DropdownMenuItem
                      className={menuActionClassName}
                      onClick={() => handleMenuOperation('summary')}
                    >
                      <span
                        aria-hidden
                        className="i-custom-vender-knowledge-search-lines-sparkle size-4 text-text-tertiary"
                      />
                      <span className="text-sm text-text-secondary">
                        {t(($) => $['list.action.summary'], { ns: 'datasetDocuments' })}
                      </span>
                    </DropdownMenuItem>
                  )}
                  {canShowSettingsAction && settingsMenuItem}
                  {canShowDownloadAction && (
                    <DropdownMenuItem className={menuActionClassName} onClick={handleDownloadClick}>
                      <span
                        aria-hidden
                        className="i-ri-download-2-line size-4 text-text-tertiary"
                      />
                      <span className="text-sm text-text-secondary">
                        {t(($) => $['list.action.download'], { ns: 'datasetDocuments' })}
                      </span>
                    </DropdownMenuItem>
                  )}
                  {canShowSyncAction && (
                    <DropdownMenuItem
                      className={menuActionClassName}
                      onClick={() => handleMenuOperation('sync')}
                    >
                      <span aria-hidden className="i-ri-loop-left-line size-4 text-text-tertiary" />
                      <span className="text-sm text-text-secondary">
                        {t(($) => $['list.action.sync'], { ns: 'datasetDocuments' })}
                      </span>
                    </DropdownMenuItem>
                  )}
                  {(canShowStatusSection || canShowDeleteAction) && (
                    <DropdownMenuSeparator className="h-[0.5px] w-full shrink-0 bg-divider-regular" />
                  )}
                </>
              )}
              {canShowPauseAction && (
                <DropdownMenuItem
                  className={menuActionClassName}
                  onClick={() => handleMenuOperation('pause')}
                >
                  <span aria-hidden className="i-ri-pause-circle-line size-4 text-text-tertiary" />
                  <span className="text-sm text-text-secondary">
                    {t(($) => $['list.action.pause'], { ns: 'datasetDocuments' })}
                  </span>
                </DropdownMenuItem>
              )}
              {canShowResumeAction && (
                <DropdownMenuItem
                  className={menuActionClassName}
                  onClick={() => handleMenuOperation('resume')}
                >
                  <span aria-hidden className="i-ri-play-circle-line size-4 text-text-tertiary" />
                  <span className="text-sm text-text-secondary">
                    {t(($) => $['list.action.resume'], { ns: 'datasetDocuments' })}
                  </span>
                </DropdownMenuItem>
              )}
              {canShowArchiveAction && (
                <DropdownMenuItem
                  className={menuActionClassName}
                  onClick={() => handleMenuOperation('archive')}
                >
                  <span aria-hidden className="i-ri-archive-2-line size-4 text-text-tertiary" />
                  <span className="text-sm text-text-secondary">
                    {t(($) => $['list.action.archive'], { ns: 'datasetDocuments' })}
                  </span>
                </DropdownMenuItem>
              )}
              {canShowUnarchiveAction && (
                <DropdownMenuItem
                  className={menuActionClassName}
                  onClick={() => handleMenuOperation('un_archive')}
                >
                  <span aria-hidden className="i-ri-archive-2-line size-4 text-text-tertiary" />
                  <span className="text-sm text-text-secondary">
                    {t(($) => $['list.action.unarchive'], { ns: 'datasetDocuments' })}
                  </span>
                </DropdownMenuItem>
              )}
              {canShowDeleteAction && (
                <DropdownMenuItem
                  variant="destructive"
                  className={menuDeleteActionClassName}
                  onClick={handleDeleteClick}
                >
                  <span
                    aria-hidden
                    className="i-ri-delete-bin-line size-4 text-text-tertiary group-data-highlighted:text-text-destructive"
                  />
                  <span className="text-sm text-text-secondary group-data-highlighted:text-text-destructive">
                    {t(($) => $['list.action.delete'], { ns: 'datasetDocuments' })}
                  </span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      <AlertDialog open={showModal} onOpenChange={(open) => !open && setShowModal(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $['list.delete.title'], { ns: 'datasetDocuments' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $['list.delete.content'], { ns: 'datasetDocuments' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={deleting} onClick={() => onOperate('delete')}>
              {t(($) => $['operation.sure'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
