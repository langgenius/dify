import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { RiArchive2Line, RiCheckboxCircleLine, RiCloseCircleLine, RiDeleteBinLine, RiDownload2Line, RiDraftLine, RiRefreshLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { SearchLinesSparkle } from '@/app/components/base/icons/src/vender/knowledge'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'
import { Button } from '@/app/components/base/ui/button'
import { IS_CE_EDITION } from '@/config'

const i18nPrefix = 'batchAction'
type IBatchActionProps = {
  className?: string
  selectedIds: string[]
  onBatchEnable: () => void
  onBatchDisable: () => void
  onBatchDownload?: () => void
  onBatchDelete: () => Promise<void>
  onBatchSummary?: () => void
  onArchive?: () => void
  onEditMetadata?: () => void
  onBatchReIndex?: () => void
  onCancel: () => void
}

const BatchAction: FC<IBatchActionProps> = ({
  className,
  selectedIds,
  onBatchEnable,
  onBatchDisable,
  onBatchSummary,
  onBatchDownload,
  onArchive,
  onBatchDelete,
  onEditMetadata,
  onBatchReIndex,
  onCancel,
}) => {
  const { t } = useTranslation()
  const [isShowDeleteConfirm, {
    setTrue: showDeleteConfirm,
    setFalse: hideDeleteConfirm,
  }] = useBoolean(false)
  const [isDeleting, {
    setTrue: setIsDeleting,
  }] = useBoolean(false)

  const handleBatchDelete = async () => {
    setIsDeleting()
    await onBatchDelete()
    hideDeleteConfirm()
  }
  return (
    <div className={cn('pointer-events-none flex w-full justify-center gap-x-2', className)}>
      <div className="pointer-events-auto flex items-center gap-x-1 rounded-[10px] border border-components-actionbar-border-accent bg-components-actionbar-bg-accent p-1 shadow-xl shadow-shadow-shadow-5">
        <div className="inline-flex items-center gap-x-2 py-1 pr-3 pl-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-text-accent system-xs-medium text-text-primary-on-surface">
            {selectedIds.length}
          </span>
          <span className="system-sm-semibold text-text-accent">{t(`${i18nPrefix}.selected`, { ns: 'dataset' })}</span>
        </div>
        <Divider type="vertical" className="mx-0.5 h-3.5 bg-divider-regular" />
        <Button
          variant="ghost"
          className="gap-x-0.5 px-3"
          onClick={onBatchEnable}
        >
          <RiCheckboxCircleLine className="size-4" />
          <span className="px-0.5">{t(`${i18nPrefix}.enable`, { ns: 'dataset' })}</span>
        </Button>
        <Button
          variant="ghost"
          className="gap-x-0.5 px-3"
          onClick={onBatchDisable}
        >
          <RiCloseCircleLine className="size-4" />
          <span className="px-0.5">{t(`${i18nPrefix}.disable`, { ns: 'dataset' })}</span>
        </Button>
        {onEditMetadata && (
          <Button
            variant="ghost"
            className="gap-x-0.5 px-3"
            onClick={onEditMetadata}
          >
            <RiDraftLine className="size-4" />
            <span className="px-0.5">{t('metadata.metadata', { ns: 'dataset' })}</span>
          </Button>
        )}
        {onBatchSummary && IS_CE_EDITION && (
          <Button
            variant="ghost"
            className="gap-x-0.5 px-3"
            onClick={onBatchSummary}
          >
            <SearchLinesSparkle className="size-4" />
            <span className="px-0.5">{t('list.action.summary', { ns: 'datasetDocuments' })}</span>
          </Button>
        )}
        {onArchive && (
          <Button
            variant="ghost"
            className="gap-x-0.5 px-3"
            onClick={onArchive}
          >
            <RiArchive2Line className="size-4" />
            <span className="px-0.5">{t(`${i18nPrefix}.archive`, { ns: 'dataset' })}</span>
          </Button>
        )}
        {onBatchReIndex && (
          <Button
            variant="ghost"
            className="gap-x-0.5 px-3"
            onClick={onBatchReIndex}
          >
            <RiRefreshLine className="size-4" />
            <span className="px-0.5">{t(`${i18nPrefix}.reIndex`, { ns: 'dataset' })}</span>
          </Button>
        )}
        {onBatchDownload && (
          <Button
            variant="ghost"
            className="gap-x-0.5 px-3"
            onClick={onBatchDownload}
          >
            <RiDownload2Line className="size-4" />
            <span className="px-0.5">{t(`${i18nPrefix}.download`, { ns: 'dataset' })}</span>
          </Button>
        )}
        <Button
          variant="ghost"
          tone="destructive"
          className="gap-x-0.5 px-3"
          onClick={showDeleteConfirm}
        >
          <RiDeleteBinLine className="size-4" />
          <span className="px-0.5">{t(`${i18nPrefix}.delete`, { ns: 'dataset' })}</span>
        </Button>

        <Divider type="vertical" className="mx-0.5 h-3.5 bg-divider-regular" />
        <Button
          variant="ghost"
          className="px-3"
          onClick={onCancel}
        >
          <span className="px-0.5">{t(`${i18nPrefix}.cancel`, { ns: 'dataset' })}</span>
        </Button>
      </div>
      <AlertDialog open={isShowDeleteConfirm} onOpenChange={open => !open && hideDeleteConfirm()}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t('list.delete.title', { ns: 'datasetDocuments' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t('list.delete.content', { ns: 'datasetDocuments' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>{t('operation.cancel', { ns: 'common' })}</AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={isDeleting} disabled={isDeleting} onClick={handleBatchDelete}>
              {t('operation.sure', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default React.memo(BatchAction)
