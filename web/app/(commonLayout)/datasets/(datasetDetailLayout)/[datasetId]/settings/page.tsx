import React from 'react'
import { getLocaleOnServer, useTranslation as translate } from '@/i18n-config/server'
import Form from '@/app/components/datasets/settings/form'

const Settings = async () => {
  const locale = await getLocaleOnServer()
  const { t } = await translate(locale, 'dataset-settings')

  return (
    <div className='h-full overflow-y-auto'>
      <div className='px-6 py-3'>
        <div className='system-xl-semibold mb-1 text-text-primary'>{t('title')}</div>
        <div className='system-sm-regular text-text-tertiary'>{t('desc')}</div>
      </div>
      <Form />
    </div>
  )
}

export default Settings
