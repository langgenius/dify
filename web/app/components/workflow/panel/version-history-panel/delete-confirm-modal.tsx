import type { FC } from 'react'
import type { VersionHistory } from '@/types/workflow'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation()

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open)
          onClose()
      }}
    >
      <AlertDialogContent className="overflow-hidden! border-none text-left align-middle shadow-xl">
        <div className="flex flex-col gap-y-2 p-6 pb-4">
          <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
            {`${t('operation.delete', { ns: 'common' })} ${versionInfo.marked_name || t('versionHistory.defaultName', { ns: 'workflow' })}`}
          </AlertDialogTitle>
          <AlertDialogDescription className="system-md-regular text-text-secondary">
            {t('versionHistory.deletionTip', { ns: 'workflow' })}
          </AlertDialogDescription>
        </div>
        <AlertDialogActions>
          <AlertDialogCancelButton
            nativeButton={false}
            variant="secondary"
            closeProps={{ nativeButton: false }}
          >
            {t('operation.cancel', { ns: 'common' })}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton nativeButton={false} onClick={onDelete.bind(null, versionInfo.id)}>
            {t('operation.delete', { ns: 'common' })}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default DeleteConfirmModal
