import { useTranslation } from '#i18n'
import Form from '@/app/components/datasets/settings/form'

const Settings = () => {
  const { t } = useTranslation('datasetSettings')

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-y-0.5 px-6 pb-2 pt-3">
        <div className="text-text-primary system-xl-semibold">{t('title')}</div>
        <div className="text-text-tertiary system-sm-regular">{t('desc')}</div>
      </div>
      <Form />
    </div>
  )
}

export default Settings
