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
  const { t } = useTranslation(['common', 'workflow', 'workflowHistory'])

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {`${t(($) => $['common.restore'], { ns: 'workflow' })} ${getWorkflowVersionName(
              versionInfo,
              t(($) => $['versionHistory.defaultName'], { ns: 'workflowHistory' }),
            )}`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(($) => $['versionHistory.restorationTip'], { ns: 'workflowHistory' })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancelButton>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton tone="default" onClick={onRestore.bind(null, versionInfo)}>
            {t(($) => $['common.restore'], { ns: 'workflow' })}
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default RestoreConfirmModal
