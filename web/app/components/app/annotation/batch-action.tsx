import type { FC } from 'react'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { cn } from '@langgenius/dify-ui/cn'
import { RiDeleteBinLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'

const i18nPrefix = 'batchAction'

type IBatchActionProps = {
  className?: string
  selectedIds: string[]
  onBatchDelete: () => Promise<void>
  onCancel: () => void
}

const BatchAction: FC<IBatchActionProps> = ({
  className,
  selectedIds,
  onBatchDelete,
  onCancel,
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
    <div className={cn('pointer-events-none flex w-full justify-center', className)}>
      <div className="pointer-events-auto flex items-center gap-x-1 rounded-[10px] border border-components-actionbar-border-accent bg-components-actionbar-bg-accent p-1 shadow-xl shadow-shadow-shadow-5 backdrop-blur-[5px]">
        <div className="inline-flex items-center gap-x-2 py-1 pr-3 pl-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-text-accent px-1 py-0.5 text-xs font-medium text-text-primary-on-surface">
            {selectedIds.length}
          </span>
          <span className="text-[13px] leading-[16px] font-semibold text-text-accent">{t(`${i18nPrefix}.selected`, { ns: 'appAnnotation' })}</span>
        </div>
        <Divider type="vertical" className="mx-0.5 h-3.5 bg-divider-regular" />
        <button
          type="button"
          className="flex cursor-pointer items-center gap-x-0.5 border-none bg-transparent px-3 py-2 text-left text-components-button-destructive-ghost-text focus-visible:ring-1 focus-visible:ring-state-destructive-border focus-visible:outline-hidden"
          onClick={showDeleteConfirm}
        >
          <RiDeleteBinLine className="h-4 w-4" aria-hidden="true" />
          <span className="px-0.5 text-[13px] leading-[16px] font-medium">
            {t('operation.delete', { ns: 'common' })}
          </span>
        </button>

        <Divider type="vertical" className="mx-0.5 h-3.5 bg-divider-regular" />
        <button
          type="button"
          className="border-none bg-transparent px-3.5 py-2 text-left text-[13px] leading-[16px] font-medium text-components-button-ghost-text focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
          onClick={onCancel}
        >
          {t('operation.cancel', { ns: 'common' })}
        </button>
      </div>
      <AlertDialog open={isShowDeleteConfirm} onOpenChange={open => !open && hideDeleteConfirm()}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t('list.delete.title', { ns: 'appAnnotation' })}
            </AlertDialogTitle>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {t('operation.cancel', { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={isDeleting} disabled={isDeleting} onClick={handleBatchDelete}>
              {t('operation.delete', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default React.memo(BatchAction)
