import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'

type Props = {
  onCancel: () => void
  onSave: () => void
  confirmDisabled?: boolean
}
const DowngradeWarningModal = ({
  onCancel,
  onSave,
  confirmDisabled = false,
}: Props) => {
  const { t } = useTranslation()

  return (
    <Modal
      isShow
      onClose={() => onCancel()}
      className='w-[480px]'
    >
      <div className='flex flex-col items-start gap-2 self-stretch pb-4'>
        <div className='title-2xl-semi-bold text-text-primary'>Plugin Downgrade</div>
        <div className='system-md-regular flex grow flex-col text-text-secondary'>
        Auto-update is currently enabled for this plugin. Downgrading the version may cause your changes to be overwritten during the next automatic update.
        </div>
      </div>
      <div className='flex items-start justify-end gap-2 self-stretch pt-6'>
        <Button variant='secondary' onClick={() => onCancel()}>{t('app.newApp.Cancel')}</Button>
        <Button variant='primary' destructive onClick={onSave} disabled={confirmDisabled}>{t('app.newApp.Confirm')}</Button>
      </div>
    </Modal>
  )
}

export default DowngradeWarningModal
