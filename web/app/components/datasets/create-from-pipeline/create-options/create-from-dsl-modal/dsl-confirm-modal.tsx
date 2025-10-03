import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'

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
      className='w-[480px]'
    >
      <div className='flex flex-col items-start gap-2 self-stretch pb-4'>
        <div className='title-2xl-semi-bold text-text-primary'>{t('app.newApp.appCreateDSLErrorTitle')}</div>
        <div className='system-md-regular flex grow flex-col text-text-secondary'>
          <div>{t('app.newApp.appCreateDSLErrorPart1')}</div>
          <div>{t('app.newApp.appCreateDSLErrorPart2')}</div>
          <br />
          <div>{t('app.newApp.appCreateDSLErrorPart3')}<span className='system-md-medium'>{versions.importedVersion}</span></div>
          <div>{t('app.newApp.appCreateDSLErrorPart4')}<span className='system-md-medium'>{versions.systemVersion}</span></div>
        </div>
      </div>
      <div className='flex items-start justify-end gap-2 self-stretch pt-6'>
        <Button variant='secondary' onClick={() => onCancel()}>{t('app.newApp.Cancel')}</Button>
        <Button variant='primary' destructive onClick={onConfirm} disabled={confirmDisabled}>{t('app.newApp.Confirm')}</Button>
      </div>
    </Modal>
  )
}

export default DSLConfirmModal
