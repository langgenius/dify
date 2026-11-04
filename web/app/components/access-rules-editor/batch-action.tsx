'use client'

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
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Separator } from '@langgenius/dify-ui/separator'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation(['common', 'permission'])
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [hasDeleteError, setHasDeleteError] = useState(false)

  const handleDelete = async () => {
    if (isDeleting) return
    setIsDeleting(true)
    setHasDeleteError(false)

    try {
      await onDelete()
      setIsDeleteConfirmOpen(false)
    } catch {
      setHasDeleteError(true)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className={cn('pointer-events-none flex w-full justify-center', className)}>
      <div
        role="group"
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
        <Separator decorative orientation="vertical" className="mx-0.5 h-3.5" />
        <Button
          variant="ghost"
          tone="destructive"
          onClick={() => {
            setHasDeleteError(false)
            setIsDeleteConfirmOpen(true)
          }}
        >
          <span className="i-ri-delete-bin-line size-4" aria-hidden />
          <span>{t(($) => $['operation.delete'], { ns: 'common' })}</span>
        </Button>
        <Separator decorative orientation="vertical" className="mx-0.5 h-3.5" />
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
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $['accessRule.batchRemoveTitle'], { ns: 'permission' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $['accessRule.batchRemoveDescription'], {
                ns: 'permission',
                count: selectedCount,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {hasDeleteError && (
            <p role="alert">{t(($) => $['api.actionFailed'], { ns: 'common' })}</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={isDeleting}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={isDeleting} onClick={handleDelete}>
              {t(($) => $['operation.sure'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
