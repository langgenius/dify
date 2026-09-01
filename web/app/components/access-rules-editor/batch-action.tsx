'use client'

import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'

type AccessRulesBatchActionProps = {
  className?: string
  selectedCount: number
  onDelete: () => Promise<void>
  onCancel: () => void
}

export default function AccessRulesBatchAction({
  className,
  selectedCount,
  onDelete,
  onCancel,
}: AccessRulesBatchActionProps) {
  const { t } = useTranslation()
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    setIsDeleting(true)

    try {
      await onDelete()
      setIsDeleteConfirmOpen(false)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className={cn('pointer-events-none flex w-full justify-center', className)}>
      <div
        role="toolbar"
        aria-label={t(($) => $['operation.selectCount'], {
          ns: 'common',
          count: selectedCount,
        })}
        className="pointer-events-auto flex items-center gap-1 rounded-[10px] border border-components-actionbar-border-accent bg-components-actionbar-bg-accent p-1 shadow-xl shadow-shadow-shadow-5"
      >
        <div className="inline-flex items-center gap-2 py-1 pr-3 pl-2">
          <span className="flex size-5 items-center justify-center rounded-md bg-text-accent system-xs-medium text-text-primary-on-surface">
            {selectedCount}
          </span>
          <span className="system-sm-semibold text-text-accent">
            {t(($) => $['accessRule.selected'], { ns: 'permission' })}
          </span>
        </div>
        <Divider type="vertical" className="mx-0.5 h-3.5 bg-divider-regular" />
        <Button variant="ghost" tone="destructive" onClick={() => setIsDeleteConfirmOpen(true)}>
          <span className="i-ri-delete-bin-line size-4" aria-hidden />
          <span>{t(($) => $['operation.delete'], { ns: 'common' })}</span>
        </Button>
        <Divider type="vertical" className="mx-0.5 h-3.5 bg-divider-regular" />
        <Button variant="ghost" onClick={onCancel}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </Button>
      </div>
      <AlertDialog
        open={isDeleteConfirmOpen}
        onOpenChange={(open) => {
          if (!isDeleting) setIsDeleteConfirmOpen(open)
        }}
      >
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t(($) => $['accessRule.batchRemoveTitle'], { ns: 'permission' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t(($) => $['accessRule.batchRemoveDescription'], {
                ns: 'permission',
                count: selectedCount,
              })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton disabled={isDeleting}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={isDeleting} onClick={handleDelete}>
              {t(($) => $['operation.sure'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
