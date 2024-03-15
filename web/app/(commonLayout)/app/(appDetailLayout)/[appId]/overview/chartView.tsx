'use client'
import React, { useState } from 'react'
import dayjs from 'dayjs'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import { fetchAppDetail } from '@/service/apps'
import type { PeriodParams } from '@/app/components/app/overview/appChart'
import { AvgResponseTime, AvgSessionInteractions, ConversationsChart, CostChart, EndUsersChart, TokenPerSecond, UserSatisfactionRate } from '@/app/components/app/overview/appChart'
import type { Item } from '@/app/components/base/select'
import { SimpleSelect } from '@/app/components/base/select'
import { TIME_PERIOD_LIST } from '@/app/components/app/log/filter'

dayjs.extend(quarterOfYear)

const today = dayjs()

const queryDateFormat = 'YYYY-MM-DD HH:mm'

export type IChartViewProps = {
  appId: string
}

export default function ChartView({ appId }: IChartViewProps) {
  const detailParams = { url: '/apps', id: appId }
  const { data: response } = useSWR(detailParams, fetchAppDetail)
  const isChatApp = response?.mode === 'chat'
  const { t } = useTranslation()
  const [period, setPeriod] = useState<PeriodParams>({ name: t('appLog.filter.period.last7days'), query: { start: today.subtract(7, 'day').format(queryDateFormat), end: today.format(queryDateFormat) } })

  const onSelect = (item: Item) => {
    if (item.value === 'all') {
      setPeriod({ name: item.name, query: undefined })
    }
    else if (item.value === 0) {
      const startOfToday = today.startOf('day').format(queryDateFormat)
      const endOfToday = today.endOf('day').format(queryDateFormat)
      setPeriod({ name: item.name, query: { start: startOfToday, end: endOfToday } })
    }
    else {
      setPeriod({ name: item.name, query: { start: today.subtract(item.value as number, 'day').format(queryDateFormat), end: today.format(queryDateFormat) } })
    }
  }

  if (!response)
    return null

  return (
    <div>
      <div className='flex flex-row items-center mt-8 mb-4 text-gray-900 text-base'>
        <span className='mr-3'>{t('appOverview.analysis.title')}</span>
        <SimpleSelect
          items={TIME_PERIOD_LIST.map(item => ({ value: item.value, name: t(`appLog.filter.period.${item.name}`) }))}
          className='mt-0 !w-40'
          onSelect={onSelect}
          defaultValue={7}
        />
      </div>
      <div className='grid gap-6 grid-cols-1 xl:grid-cols-2 w-full mb-6'>
        <ConversationsChart period={period} id={appId} />
        <EndUsersChart period={period} id={appId} />
      </div>
      <div className='grid gap-6 grid-cols-1 xl:grid-cols-2 w-full mb-6'>
        {isChatApp
          ? (
            <AvgSessionInteractions period={period} id={appId} />
          )
          : (
            <AvgResponseTime period={period} id={appId} />
          )}
        <TokenPerSecond period={period} id={appId} />
      </div>
      <div className='grid gap-6 grid-cols-1 xl:grid-cols-2 w-full mb-6'>
        <UserSatisfactionRate period={period} id={appId} />
        <CostChart period={period} id={appId} />
      </div>
    </div>
  )
}
