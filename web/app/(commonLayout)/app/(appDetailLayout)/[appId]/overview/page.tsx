import React from 'react'
import WelcomeBanner, { EditKeyPopover } from './welcome-banner'
import ChartView from './chartView'
import CardView from './cardView'
import { getLocaleOnServer } from '@/i18n/server'
import { useTranslation } from '@/i18n/i18next-serverside-config'

export type IDevelopProps = {
  params: { appId: string }
}

const Overview = async ({
  params: { appId },
}: IDevelopProps) => {
  const locale = getLocaleOnServer()
  const { t } = await useTranslation(locale, 'app-overview')
  return (
    <div className="h-full px-16 py-6 overflow-scroll">
      <WelcomeBanner />
      <div className='flex flex-row items-center justify-between mb-4 text-xl text-gray-900'>
        {t('overview.title')}
        <EditKeyPopover />
      </div>
      <CardView appId={appId} />
      <ChartView appId={appId} />
    </div>
  )
}

export default Overview
