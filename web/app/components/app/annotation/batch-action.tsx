import type { AlertDialogActions } from '@langgenius/dify-ui/alert-dialog'
import type { FC } from 'react'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Separator } from '@langgenius/dify-ui/separator'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation(['appAnnotation', 'common'])
  const deleteConfirmActionsRef = React.useRef<AlertDialogActions>(null)
  const [isDeleting, { setTrue: setIsDeleting, setFalse: setIsNotDeleting }] = useBoolean(false)

  const handleBatchDelete = async () => {
    setIsDeleting()
    try {
      await onBatchDelete()
      deleteConfirmActionsRef.current?.close()
    } catch {
      // The owner reports the failure; the dialog stays open so the user can retry.
    } finally {
      setIsNotDeleting()
    }
  }
  return (
    <div className={cn('pointer-events-none flex w-full justify-center gap-x-2', className)}>
      <div className="pointer-events-auto flex items-center gap-x-1 rounded-[10px] border border-components-actionbar-border-accent bg-components-actionbar-bg-accent p-1 shadow-xl shadow-shadow-shadow-5">
        <div className="inline-flex items-center gap-x-2 py-1 pr-3 pl-2">
          <span className="flex size-5 items-center justify-center rounded-md bg-text-accent system-xs-medium text-text-primary-on-surface">
            {selectedIds.length}
          </span>
          <span className="system-sm-semibold text-text-accent">
            {t(($) => $[`${i18nPrefix}.selected`], { ns: 'appAnnotation' })}
          </span>
        </div>
        <Separator decorative orientation="vertical" className="mx-0.5 h-3.5" />
        <AlertDialog
          actionsRef={deleteConfirmActionsRef}
          onOpenChange={(open, details) => {
            if (!open && isDeleting && details.reason !== 'imperative-action') details.cancel()
          }}
        >
          <AlertDialogTrigger render={<Button variant="ghost" tone="destructive" />}>
            <span aria-hidden className="i-ri-delete-bin-line size-4" />
            <span>{t(($) => $['operation.delete'], { ns: 'common' })}</span>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t(($) => $['list.delete.title'], { ns: 'appAnnotation' })}
              </AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancelButton disabled={isDeleting}>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </AlertDialogCancelButton>
              <AlertDialogConfirmButton loading={isDeleting} onClick={handleBatchDelete}>
                {t(($) => $['operation.delete'], { ns: 'common' })}
              </AlertDialogConfirmButton>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Separator decorative orientation="vertical" className="mx-0.5 h-3.5" />
        <Button variant="ghost" onClick={() => onSelectedIdsChange([])}>
          <span>{t(($) => $['operation.cancel'], { ns: 'common' })}</span>
        </Button>
      </div>
    </div>
  )
}

export default React.memo(BatchAction)
