'use client'
import type { PeriodParams } from '@/app/components/app/overview/app-chart'
import type { I18nKeysByPrefix } from '@/types/i18n'
import dayjs from 'dayjs'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TIME_PERIOD_MAPPING as LONG_TIME_PERIOD_MAPPING } from '@/app/components/app/log/filter'
import { AvgResponseTime, AvgSessionInteractions, AvgUserInteractions, ConversationsChart, CostChart, EndUsersChart, MessagesChart, TokenPerSecond, UserSatisfactionRate, WorkflowCostChart, WorkflowDailyTerminalsChart, WorkflowMessagesChart } from '@/app/components/app/overview/app-chart'
import { useStore as useAppStore } from '@/app/components/app/store'
import { IS_CLOUD_EDITION } from '@/config'
import LongTimeRangePicker from './long-time-range-picker'
import TimeRangePicker from './time-range-picker'

dayjs.extend(quarterOfYear)

const today = dayjs()

type TimePeriodName = I18nKeysByPrefix<'appLog', 'filter.period.'>

const TIME_PERIOD_MAPPING: { value: number, name: TimePeriodName }[] = [
  { value: 0, name: 'today' },
  { value: 7, name: 'last7days' },
  { value: 30, name: 'last30days' },
]

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
  const [period, setPeriod] = useState<PeriodParams>(IS_CLOUD_EDITION
    ? { name: t('filter.period.today', { ns: 'appLog' }), query: { start: today.startOf('day').format(queryDateFormat), end: today.endOf('day').format(queryDateFormat) } }
    : { name: t('filter.period.last7days', { ns: 'appLog' }), query: { start: today.subtract(7, 'day').startOf('day').format(queryDateFormat), end: today.endOf('day').format(queryDateFormat) } },
  )

  if (!appDetail)
    return null

  return (
    <div>
      <div className="mb-4">
        <div className="system-xl-semibold mb-2 text-text-primary">{t('appMenus.overview', { ns: 'common' })}</div>
        <div className="flex items-center justify-between">
          {IS_CLOUD_EDITION
            ? (
                <TimeRangePicker
                  ranges={TIME_PERIOD_MAPPING}
                  onSelect={setPeriod}
                  queryDateFormat={queryDateFormat}
                />
              )
            : (
                <LongTimeRangePicker
                  periodMapping={LONG_TIME_PERIOD_MAPPING}
                  onSelect={setPeriod}
                  queryDateFormat={queryDateFormat}
                />
              )}

          {headerRight}
        </div>
      </div>
      {!isWorkflow && (
        <div className="mb-6 grid w-full grid-cols-1 gap-6 xl:grid-cols-2">
          <ConversationsChart period={period} id={appId} />
          <EndUsersChart period={period} id={appId} />
        </div>
      )}
      {!isWorkflow && (
        <div className="mb-6 grid w-full grid-cols-1 gap-6 xl:grid-cols-2">
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
        <div className="mb-6 grid w-full grid-cols-1 gap-6 xl:grid-cols-2">
          <UserSatisfactionRate period={period} id={appId} />
          <CostChart period={period} id={appId} />
        </div>
      )}
      {!isWorkflow && isChatApp && (
        <div className="mb-6 grid w-full grid-cols-1 gap-6 xl:grid-cols-2">
          <MessagesChart period={period} id={appId} />
        </div>
      )}
      {isWorkflow && (
        <div className="mb-6 grid w-full grid-cols-1 gap-6 xl:grid-cols-2">
          <WorkflowMessagesChart period={period} id={appId} />
          <WorkflowDailyTerminalsChart period={period} id={appId} />
        </div>
      )}
      {isWorkflow && (
        <div className="mb-6 grid w-full grid-cols-1 gap-6 xl:grid-cols-2">
          <WorkflowCostChart period={period} id={appId} />
          <AvgUserInteractions period={period} id={appId} />
        </div>
      )}
    </div>
  )
}
