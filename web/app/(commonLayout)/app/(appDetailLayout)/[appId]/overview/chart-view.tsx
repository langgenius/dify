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
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useDocLink } from '@/context/i18n'
import { getAppACLCapabilities } from '@/utils/permission'
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

type IChartViewProps = {
  appId: string
  headerRight: React.ReactNode
}

export default function ChartView({ appId, headerRight }: IChartViewProps) {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const appDetail = useAppStore(state => state.appDetail)
  const currentUserId = useAppContextWithSelector(state => state.userProfile?.id)
  const workspacePermissionKeys = useAppContextWithSelector(state => state.workspacePermissionKeys)
  const canMonitor = React.useMemo(() => getAppACLCapabilities(appDetail?.permission_keys, {
    currentUserId,
    resourceMaintainer: appDetail?.maintainer,
    workspacePermissionKeys,
  }).canMonitor, [appDetail?.maintainer, appDetail?.permission_keys, currentUserId, workspacePermissionKeys])
  const isChatApp = appDetail?.mode !== 'completion' && appDetail?.mode !== 'workflow'
  const isWorkflow = appDetail?.mode === 'workflow'
  const [period, setPeriod] = useState<PeriodParams>(IS_CLOUD_EDITION
    ? { name: t('filter.period.today', { ns: 'appLog' }), query: { start: today.startOf('day').format(queryDateFormat), end: today.endOf('day').format(queryDateFormat) } }
    : { name: t('filter.period.last7days', { ns: 'appLog' }), query: { start: today.subtract(7, 'day').startOf('day').format(queryDateFormat), end: today.endOf('day').format(queryDateFormat) } },
  )

  if (!appDetail || !canMonitor)
    return null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="h-[106px] shrink-0">
        <div className="px-6 pt-3">
          <div className="flex h-6 items-center">
            <h1 className="title-2xl-semi-bold text-text-primary">{t('appMenus.overview', { ns: 'common' })}</h1>
          </div>
          <div className="mt-0.5 flex h-4 min-w-0 items-start gap-0.5 system-xs-regular text-text-tertiary">
            <p className="min-w-0 truncate">{t('monitoring.description', { ns: 'appLog' })}</p>
            <a
              href={docLink('/use-dify/monitor/analysis')}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center text-text-accent hover:underline"
            >
              <span>{t('operation.learnMore', { ns: 'common' })}</span>
              <span className="i-ri-external-link-line size-3" aria-hidden="true" />
            </a>
          </div>
        </div>
        <div className="mt-1 flex h-10 items-center justify-between pr-10 pl-6">
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
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-6">
        <div className="grid w-full grid-cols-1 gap-3 xl:grid-cols-2">
          {!isWorkflow && (
            <>
              <ConversationsChart period={period} id={appId} />
              <EndUsersChart period={period} id={appId} />
              {isChatApp
                ? (
                    <AvgSessionInteractions period={period} id={appId} />
                  )
                : (
                    <AvgResponseTime period={period} id={appId} />
                  )}
              <TokenPerSecond period={period} id={appId} />
              <UserSatisfactionRate period={period} id={appId} />
              <CostChart period={period} id={appId} />
              {isChatApp && <MessagesChart period={period} id={appId} />}
            </>
          )}
          {isWorkflow && (
            <>
              <WorkflowMessagesChart period={period} id={appId} />
              <WorkflowDailyTerminalsChart period={period} id={appId} />
              <WorkflowCostChart period={period} id={appId} />
              <AvgUserInteractions period={period} id={appId} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
