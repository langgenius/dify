import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'

const i18nPrefix = 'plugin.autoUpdate.pluginDowngradeWarning'

type Props = {
  onCancel: () => void
  onJustDowngrade: () => void
  onExcludeAndDowngrade: () => void
}
const DowngradeWarningModal = ({
  onCancel,
  onJustDowngrade,
  onExcludeAndDowngrade,
}: Props) => {
  const { t } = useTranslation()

  return (
    <>
      <div className='flex flex-col items-start gap-2 self-stretch'>
        <div className='title-2xl-semi-bold text-text-primary'>{t(`${i18nPrefix}.title`)}</div>
        <div className='system-md-regular text-text-secondary'>
          {t(`${i18nPrefix}.description`)}
        </div>
      </div>
      <div className='mt-9 flex items-start justify-end space-x-2 self-stretch'>
        <Button variant='secondary' onClick={() => onCancel()}>{t('app.newApp.Cancel')}</Button>
        <Button variant='secondary' destructive onClick={onJustDowngrade}>{t(`${i18nPrefix}.downgrade`)}</Button>
        <Button variant='primary' onClick={onExcludeAndDowngrade}>{t(`${i18nPrefix}.exclude`)}</Button>
      </div>
    </>
  )
}

export default DowngradeWarningModal
