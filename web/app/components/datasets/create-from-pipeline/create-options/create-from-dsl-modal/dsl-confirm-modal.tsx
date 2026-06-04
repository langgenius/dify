import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
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
}
const DSLConfirmModal = ({
  versions = { importedVersion: '', systemVersion: '' },
  onCancel,
  onConfirm,
  confirmDisabled = false,
}: DSLConfirmModalProps) => {
  const { t } = useTranslation()

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open)
          onCancel()
      }}
    >
      <AlertDialogContent className="w-[480px] max-w-none! overflow-hidden! border-none p-6 text-left align-middle shadow-xl">
        <div className="flex flex-col items-start gap-2 self-stretch pb-4">
          <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">{t('newApp.appCreateDSLErrorTitle', { ns: 'app' })}</AlertDialogTitle>
          <AlertDialogDescription render={<div />} className="flex grow flex-col system-md-regular text-text-secondary">
            <div>{t('newApp.appCreateDSLErrorPart1', { ns: 'app' })}</div>
            <div>{t('newApp.appCreateDSLErrorPart2', { ns: 'app' })}</div>
            <br />
            <div>
              {t('newApp.appCreateDSLErrorPart3', { ns: 'app' })}
              <span className="system-md-medium">{versions.importedVersion}</span>
            </div>
            <div>
              {t('newApp.appCreateDSLErrorPart4', { ns: 'app' })}
              <span className="system-md-medium">{versions.systemVersion}</span>
            </div>
          </AlertDialogDescription>
        </div>
        <AlertDialogActions className="items-start p-0 pt-6">
          <AlertDialogCancelButton variant="secondary">{t('newApp.Cancel', { ns: 'app' })}</AlertDialogCancelButton>
          <AlertDialogConfirmButton onClick={onConfirm} disabled={confirmDisabled}>{t('newApp.Confirm', { ns: 'app' })}</AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default DSLConfirmModal
