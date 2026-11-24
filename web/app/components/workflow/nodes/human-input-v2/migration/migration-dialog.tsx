import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { memo, useCallback, useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useHumanInputMigration } from './context'

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
  const { t } = useTranslation(['workflow', 'common'])
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (pending) return
      onOpenChange(nextOpen)
    },
    [onOpenChange, pending],
  )

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(($) => $['nodes.humanInputMigration.dialog.title'], {
              ns: 'workflow',
              count: nodeCount,
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(($) => $['nodes.humanInputMigration.dialog.description'], { ns: 'workflow' })}{' '}
            <span className="font-medium text-text-primary">
              {t(($) => $['nodes.humanInputMigration.dialog.review'], { ns: 'workflow' })}
            </span>
            <span className="mt-2 block">
              {t(($) => $['nodes.humanInputMigration.dialog.draftNotice'], { ns: 'workflow' })}
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogBody>
          {error && (
            <div
              role="alert"
              className="mt-3 rounded-lg bg-state-destructive-hover px-3 py-2 system-xs-regular text-text-destructive"
            >
              {error}
            </div>
          )}
        </AlertDialogBody>
        <AlertDialogFooter>
          <AlertDialogCancelButton disabled={pending} focusableWhenDisabled>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            tone="default"
            loading={pending}
            disabled={pending}
            onClick={onConfirm}
          >
            {t(($) => $['nodes.humanInputMigration.action.migrate'], { ns: 'workflow' })}
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default memo(HumanInputMigrationDialog)

export function HumanInputMigrationConfirmation({ ownerId }: { ownerId: string }) {
  const migration = useHumanInputMigration()
  const releaseDialogOwner = migration?.releaseDialogOwner
  useLayoutEffect(() => () => releaseDialogOwner?.(ownerId), [ownerId, releaseDialogOwner])
  if (!migration) return null
  const { ownerId: activeOwner, ...props } = migration.dialog
  return (
    <HumanInputMigrationDialog
      {...props}
      pending={migration.pending}
      open={ownerId === activeOwner}
    />
  )
}
