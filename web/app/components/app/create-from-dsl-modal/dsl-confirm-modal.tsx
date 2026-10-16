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
import { useTranslation } from 'react-i18next'

type DSLConfirmModalProps = {
  versions?: {
    importedVersion: string
    systemVersion: string
  }
  onCancel: () => void
  onConfirm: () => void
  confirmDisabled?: boolean
  confirmLoading?: boolean
}

function DSLConfirmModal({
  versions = { importedVersion: '', systemVersion: '' },
  onCancel,
  onConfirm,
  confirmDisabled = false,
  confirmLoading = false,
}: DSLConfirmModalProps) {
  const { t } = useTranslation(['app'])

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !confirmLoading) onCancel()
      }}
    >
      <AlertDialogContent className="overflow-hidden border-none shadow-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(($) => $['newApp.appCreateDSLErrorTitle'], { ns: 'app' })}
          </AlertDialogTitle>
          <AlertDialogDescription render={<div />}>
            <div>{t(($) => $['newApp.appCreateDSLErrorPart1'], { ns: 'app' })}</div>
            <div>{t(($) => $['newApp.appCreateDSLErrorPart2'], { ns: 'app' })}</div>
            <br />
            <div>
              {t(($) => $['newApp.appCreateDSLErrorPart3'], { ns: 'app' })}
              <span className="system-md-medium">{versions.importedVersion}</span>
            </div>
            <div>
              {t(($) => $['newApp.appCreateDSLErrorPart4'], { ns: 'app' })}
              <span className="system-md-medium">{versions.systemVersion}</span>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancelButton disabled={confirmLoading}>
            {t(($) => $['newApp.Cancel'], { ns: 'app' })}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            onClick={onConfirm}
            disabled={confirmDisabled}
            loading={confirmLoading}
          >
            {t(($) => $['newApp.Confirm'], { ns: 'app' })}
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default DSLConfirmModal
