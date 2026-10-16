import type { FC } from 'react'
import type { VersionHistory } from '@/types/workflow'
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
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { getWorkflowVersionName } from '@/app/components/workflow/utils/version'

type DeleteConfirmModalProps = {
  isOpen: boolean
  versionInfo: VersionHistory
  onClose: () => void
  onDelete: (id: string) => void
}

const DeleteConfirmModal: FC<DeleteConfirmModalProps> = ({
  isOpen,
  versionInfo,
  onClose,
  onDelete,
}) => {
  const { t } = useTranslation(['common', 'workflowHistory'])

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <AlertDialogContent className="overflow-hidden border-none shadow-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {`${t(($) => $['operation.delete'], { ns: 'common' })} ${getWorkflowVersionName(
              versionInfo,
              t(($) => $['versionHistory.defaultName'], { ns: 'workflowHistory' }),
            )}`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(($) => $['versionHistory.deletionTip'], { ns: 'workflowHistory' })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancelButton>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton onClick={onDelete.bind(null, versionInfo.id)}>
            {t(($) => $['operation.delete'], { ns: 'common' })}
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default DeleteConfirmModal
