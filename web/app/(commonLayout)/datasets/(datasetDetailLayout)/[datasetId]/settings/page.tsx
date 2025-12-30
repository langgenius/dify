/* eslint-disable dify-i18n/require-ns-option */
import * as React from 'react'
import Form from '@/app/components/datasets/settings/form'
import { getLocaleOnServer, getTranslation } from '@/i18n-config/server'

const Settings = async () => {
  const locale = await getLocaleOnServer()
  const { t } = await getTranslation(locale, 'dataset-settings')

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-y-0.5 px-6 pb-2 pt-3">
        <div className="system-xl-semibold text-text-primary">{t('title')}</div>
        <div className="system-sm-regular text-text-tertiary">{t('desc')}</div>
      </div>
      <Form />
    </div>
  )
}

export default Settings
