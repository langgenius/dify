import type { FC } from 'react'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'

const i18nPrefix = 'batchAction'

type IBatchActionProps = {
  className?: string
  selectedIds: string[]
  onBatchDelete: () => Promise<void>
  onSelectedIdsChange: (selectedIds: string[]) => void
}

const BatchAction: FC<IBatchActionProps> = ({
  className,
  selectedIds,
  onBatchDelete,
  onSelectedIdsChange,
}) => {
  const { t } = useTranslation()
  const [isShowDeleteConfirm, {
    setTrue: showDeleteConfirm,
    setFalse: hideDeleteConfirm,
  }] = useBoolean(false)
  const [isDeleting, {
    setTrue: setIsDeleting,
    setFalse: setIsNotDeleting,
  }] = useBoolean(false)

  const handleBatchDelete = async () => {
    setIsDeleting()
    await onBatchDelete()
    hideDeleteConfirm()
    setIsNotDeleting()
  }
  return (
    <div className={cn('pointer-events-none flex w-full justify-center gap-x-2', className)}>
      <div className="pointer-events-auto flex items-center gap-x-1 rounded-[10px] border border-components-actionbar-border-accent bg-components-actionbar-bg-accent p-1 shadow-xl shadow-shadow-shadow-5">
        <div className="inline-flex items-center gap-x-2 py-1 pr-3 pl-2">
          <span className="flex size-5 items-center justify-center rounded-md bg-text-accent system-xs-medium text-text-primary-on-surface">
            {selectedIds.length}
          </span>
          <span className="system-sm-semibold text-text-accent">{t($ => $[`${i18nPrefix}.selected`], { ns: 'appAnnotation' })}</span>
        </div>
        <Divider type="vertical" className="mx-0.5 h-3.5 bg-divider-regular" />
        <Button
          variant="ghost"
          tone="destructive"
          className="gap-x-0.5 px-3"
          onClick={showDeleteConfirm}
        >
          <span aria-hidden className="i-ri-delete-bin-line size-4" />
          <span className="px-0.5">
            {t($ => $['operation.delete'], { ns: 'common' })}
          </span>
        </Button>

        <Divider type="vertical" className="mx-0.5 h-3.5 bg-divider-regular" />
        <Button
          variant="ghost"
          className="px-3"
          onClick={() => onSelectedIdsChange([])}
        >
          <span className="px-0.5">{t($ => $['operation.cancel'], { ns: 'common' })}</span>
        </Button>
      </div>
      <AlertDialog open={isShowDeleteConfirm} onOpenChange={open => !open && hideDeleteConfirm()}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t($ => $['list.delete.title'], { ns: 'appAnnotation' })}
            </AlertDialogTitle>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {t($ => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={isDeleting} disabled={isDeleting} onClick={handleBatchDelete}>
              {t($ => $['operation.delete'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default React.memo(BatchAction)
