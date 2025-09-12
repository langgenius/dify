'use client'
import React, { useState } from 'react'
import dayjs from 'dayjs'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import { useTranslation } from 'react-i18next'
import type { PeriodParams } from '@/app/components/app/overview/app-chart'
import { AvgResponseTime, AvgSessionInteractions, AvgUserInteractions, ConversationsChart, CostChart, EndUsersChart, MessagesChart, TokenPerSecond, UserSatisfactionRate, WorkflowCostChart, WorkflowDailyTerminalsChart, WorkflowMessagesChart } from '@/app/components/app/overview/app-chart'
import type { Item } from '@/app/components/base/select'
import { SimpleSelect } from '@/app/components/base/select'
import { TIME_PERIOD_MAPPING } from '@/app/components/app/log/filter'
import { useStore as useAppStore } from '@/app/components/app/store'

dayjs.extend(quarterOfYear)

const today = dayjs()

const queryDateFormat = 'YYYY-MM-DD HH:mm'

export type IChartViewProps = {
  appId: string
  headerRight: React.ReactNode
}

export default function ChartView({ appId, headerRight }: IChartViewProps) {
  const { t } = useTranslation()
  const appDetail = useAppStore(state => state.appDetail)
  const isChatApp = appDetail?.mode !== 'completion' && appDetail?.mode !== 'workflow'
  const isWorkflow = appDetail?.mode === 'workflow'
  const [period, setPeriod] = useState<PeriodParams>({ name: t('appLog.filter.period.last7days'), query: { start: today.subtract(7, 'day').startOf('day').format(queryDateFormat), end: today.endOf('day').format(queryDateFormat) } })

  const onSelect = (item: Item) => {
    if (item.value === -1) {
      setPeriod({ name: item.name, query: undefined })
    }
    else if (item.value === 0) {
      const startOfToday = today.startOf('day').format(queryDateFormat)
      const endOfToday = today.endOf('day').format(queryDateFormat)
      setPeriod({ name: item.name, query: { start: startOfToday, end: endOfToday } })
    }
    else {
      setPeriod({ name: item.name, query: { start: today.subtract(item.value as number, 'day').startOf('day').format(queryDateFormat), end: today.endOf('day').format(queryDateFormat) } })
    }
  }

  if (!appDetail)
    return null

  return (
    <div>
      <div className='mb-4'>
        <div className='system-xl-semibold mb-2 text-text-primary'>{t('common.appMenus.overview')}</div>
        <div className='flex items-center justify-between'>
          <div className='flex flex-row items-center'>
            <SimpleSelect
              items={Object.entries(TIME_PERIOD_MAPPING).map(([k, v]) => ({ value: k, name: t(`appLog.filter.period.${v.name}`) }))}
              className='mt-0 !w-40'
              notClearable={true}
              onSelect={(item) => {
                const id = item.value
                const value = TIME_PERIOD_MAPPING[id]?.value ?? '-1'
                const name = item.name || t('appLog.filter.period.allTime')
                onSelect({ value, name })
              }}
              defaultValue={'2'}
            />
          </div>
          {headerRight}
        </div>
      </div>
      {!isWorkflow && (
        <div className='mb-6 grid w-full grid-cols-1 gap-6 xl:grid-cols-2'>
          <ConversationsChart period={period} id={appId} />
          <EndUsersChart period={period} id={appId} />
        </div>
      )}
      {!isWorkflow && (
        <div className='mb-6 grid w-full grid-cols-1 gap-6 xl:grid-cols-2'>
          {isChatApp
            ? (
              <AvgSessionInteractions period={period} id={appId} />
            )
            : (
              <AvgResponseTime period={period} id={appId} />
            )}
          <TokenPerSecond period={period} id={appId} />
        </div>
      )}
      {!isWorkflow && (
        <div className='mb-6 grid w-full grid-cols-1 gap-6 xl:grid-cols-2'>
          <UserSatisfactionRate period={period} id={appId} />
          <CostChart period={period} id={appId} />
        </div>
      )}
      {!isWorkflow && isChatApp && (
        <div className='mb-6 grid w-full grid-cols-1 gap-6 xl:grid-cols-2'>
          <MessagesChart period={period} id={appId} />
        </div>
      )}
      {isWorkflow && (
        <div className='mb-6 grid w-full grid-cols-1 gap-6 xl:grid-cols-2'>
          <WorkflowMessagesChart period={period} id={appId} />
          <WorkflowDailyTerminalsChart period={period} id={appId} />
        </div>
      )}
      {isWorkflow && (
        <div className='mb-6 grid w-full grid-cols-1 gap-6 xl:grid-cols-2'>
          <WorkflowCostChart period={period} id={appId} />
          <AvgUserInteractions period={period} id={appId} />
        </div>
      )}
    </div>
  )
}
