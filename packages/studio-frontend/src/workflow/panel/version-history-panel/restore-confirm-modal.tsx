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

type RestoreConfirmModalProps = {
  isOpen: boolean
  versionInfo: VersionHistory
  onClose: () => void
  onRestore: (item: VersionHistory) => void
}

const RestoreConfirmModal: FC<RestoreConfirmModalProps> = ({
  isOpen,
  versionInfo,
  onClose,
  onRestore,
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
            {`${t('common.restore', { ns: 'workflow' })} ${versionInfo.marked_name || t('versionHistory.defaultName', { ns: 'workflow' })}`}
          </AlertDialogTitle>
          <AlertDialogDescription className="system-md-regular text-text-secondary">
            {t('versionHistory.restorationTip', { ns: 'workflow' })}
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
          <AlertDialogConfirmButton nativeButton={false} tone="default" onClick={onRestore.bind(null, versionInfo)}>
            {t('common.restore', { ns: 'workflow' })}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default RestoreConfirmModal
