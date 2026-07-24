import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'

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
    <Modal
      isShow
      onClose={() => onCancel()}
      className="w-[480px]"
    >
      <div className="flex flex-col items-start gap-2 self-stretch pb-4">
        <div className="title-2xl-semi-bold text-text-primary">{t('newApp.appCreateDSLErrorTitle', { ns: 'app' })}</div>
        <div className="system-md-regular flex grow flex-col text-text-secondary">
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
        </div>
      </div>
      <div className="flex items-start justify-end gap-2 self-stretch pt-6">
        <Button variant="secondary" onClick={() => onCancel()}>{t('newApp.Cancel', { ns: 'app' })}</Button>
        <Button variant="primary" destructive onClick={onConfirm} disabled={confirmDisabled}>{t('newApp.Confirm', { ns: 'app' })}</Button>
      </div>
    </Modal>
  )
}

export default DSLConfirmModal
