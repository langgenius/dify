import type { MouseEventHandler } from 'react'
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

type VersionMismatchModalProps = {
  isShow: boolean
  versions?: {
    importedVersion: string
    systemVersion: string
  }
  onClose: () => void
  onConfirm: MouseEventHandler
}

const VersionMismatchModal = ({
  isShow,
  versions,
  onClose,
  onConfirm,
}: VersionMismatchModalProps) => {
  const { t } = useTranslation(['app'])

  return (
    <AlertDialog
      open={isShow}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <AlertDialogContent className="max-w-none overflow-hidden border-none shadow-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(($) => $['newApp.appCreateDSLErrorTitle'], { ns: 'app' })}
          </AlertDialogTitle>
          <AlertDialogDescription render={<div />} className="flex flex-col">
            <div>{t(($) => $['newApp.appCreateDSLErrorPart1'], { ns: 'app' })}</div>
            <div>{t(($) => $['newApp.appCreateDSLErrorPart2'], { ns: 'app' })}</div>
            <br />
            <div>
              {t(($) => $['newApp.appCreateDSLErrorPart3'], { ns: 'app' })}
              <span className="system-md-medium">{versions?.importedVersion}</span>
            </div>
            <div>
              {t(($) => $['newApp.appCreateDSLErrorPart4'], { ns: 'app' })}
              <span className="system-md-medium">{versions?.systemVersion}</span>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancelButton variant="secondary">
            {t(($) => $['newApp.Cancel'], { ns: 'app' })}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton onClick={onConfirm}>
            {t(($) => $['newApp.Confirm'], { ns: 'app' })}
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default VersionMismatchModal
