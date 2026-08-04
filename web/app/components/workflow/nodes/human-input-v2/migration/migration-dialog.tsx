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
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

export type HumanInputMigrationDialogProps = {
  open: boolean
  pending: boolean
  nodeCount: number
  error?: string
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

const HumanInputMigrationDialog = ({
  open,
  pending,
  nodeCount,
  error,
  onOpenChange,
  onConfirm,
}: HumanInputMigrationDialogProps) => {
  const { t } = useTranslation()
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (pending) return
      onOpenChange(nextOpen)
    },
    [onOpenChange, pending],
  )

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="w-[480px] max-w-[calc(100vw-2rem)]">
        <div className="px-6 pt-6">
          <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['nodes.humanInputMigration.dialog.title'], {
              ns: 'workflow',
              count: nodeCount,
            })}
          </AlertDialogTitle>
          <AlertDialogDescription className="mt-3 system-sm-regular text-text-secondary">
            <span>
              {t(($) => $['nodes.humanInputMigration.dialog.description'], { ns: 'workflow' })}{' '}
            </span>
            <span className="system-sm-medium">
              {t(($) => $['nodes.humanInputMigration.dialog.review'], { ns: 'workflow' })}
            </span>
            <span className="mt-3 block">
              {t(($) => $['nodes.humanInputMigration.dialog.draftNotice'], { ns: 'workflow' })}
            </span>
          </AlertDialogDescription>
          {error && (
            <div
              role="alert"
              className="bg-background-default-destructive mt-3 rounded-lg px-3 py-2 system-xs-regular text-text-destructive"
            >
              {error}
            </div>
          )}
        </div>
        <AlertDialogActions>
          {pending ? (
            <Button disabled>{t(($) => $['operation.cancel'], { ns: 'common' })}</Button>
          ) : (
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
          )}
          <AlertDialogConfirmButton
            tone="default"
            loading={pending}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending
              ? t(($) => $['nodes.humanInputMigration.action.migrating'], { ns: 'workflow' })
              : t(($) => $['nodes.humanInputMigration.action.migrate'], { ns: 'workflow' })}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default memo(HumanInputMigrationDialog)
