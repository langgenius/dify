import type { MouseEventHandler } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'

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
  const { t } = useTranslation()

  return (
    <Modal
      isShow={isShow}
      onClose={onClose}
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
            <span className="system-md-medium">{versions?.importedVersion}</span>
          </div>
          <div>
            {t('newApp.appCreateDSLErrorPart4', { ns: 'app' })}
            <span className="system-md-medium">{versions?.systemVersion}</span>
          </div>
        </div>
      </div>
      <div className="flex items-start justify-end gap-2 self-stretch pt-6">
        <Button variant="secondary" onClick={onClose}>{t('newApp.Cancel', { ns: 'app' })}</Button>
        <Button variant="primary" destructive onClick={onConfirm}>{t('newApp.Confirm', { ns: 'app' })}</Button>
      </div>
    </Modal>
  )
}

export default VersionMismatchModal
