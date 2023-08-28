import React from 'react'
import ChartView from './chartView'
import CardView from './cardView'
import { getLocaleOnServer } from '@/i18n/server'
import { useTranslation as translate } from '@/i18n/i18next-serverside-config'
import ApikeyInfoPanel from '@/app/components/app/overview/apikey-info-panel'

export type IDevelopProps = {
  params: { appId: string }
}

const Overview = async ({
  params: { appId },
}: IDevelopProps) => {
  const locale = getLocaleOnServer()
  /*
    rename useTranslation to avoid lint error
    please check: https://github.com/i18next/next-13-app-dir-i18next-example/issues/24
  */
  const { t } = await translate(locale, 'app-overview')
  return (
    <div className="h-full px-16 py-6 overflow-scroll">
      <ApikeyInfoPanel />
      <div className='flex flex-row items-center justify-between mb-4 text-xl text-gray-900'>
        {t('overview.title')}
      </div>
      <CardView appId={appId} />
      <ChartView appId={appId} />
    </div>
  )
}

export default Overview
