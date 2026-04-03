/* eslint-disable react-refresh/only-export-components, react/component-hook-factories */
'use client'
import type { Dayjs } from 'dayjs'
import type { FC } from 'react'
import type { ChartRow } from './app-chart-utils'
import ReactECharts from 'echarts-for-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Basic from '@/app/components/app-sidebar/basic'
import Loading from '@/app/components/base/loading'
import {
  useAppAverageResponseTime,
  useAppAverageSessionInteractions,
  useAppDailyConversations,
  useAppDailyEndUsers,
  useAppDailyMessages,
  useAppSatisfactionRate,
  useAppTokenCosts,
  useAppTokensPerSecond,
  useWorkflowAverageInteractions,
  useWorkflowDailyConversations,
  useWorkflowDailyTerminals,
  useWorkflowTokenCosts,
} from '@/service/use-apps'
import {
  buildChartOptions,
  CHART_TYPE_CONFIG,
  defaultPeriod,
  getChartValueField,
  getDefaultChartData,
  getSummaryValue,
  getTokenSummary,
} from './app-chart-utils'

export type PeriodParams = {
  name: string
  query?: {
    start: string
    end: string
  }
}

export type TimeRange = {
  start: Dayjs
  end: Dayjs
}

export type PeriodParamsWithTimeRange = {
  name: string
  query?: TimeRange
}

type IBizChartProps = {
  period: PeriodParams
  id: string
}

type IChartProps = {
  className?: string
  basicInfo: { title: string, explanation: string, timePeriod: string }
  valueKey?: string
  isAvg?: boolean
  unit?: string
  yMax?: number
  chartType: keyof typeof CHART_TYPE_CONFIG
  chartData: { data: ChartRow[] }
}

const Chart: React.FC<IChartProps> = ({
  basicInfo: { title, explanation, timePeriod },
  chartType = 'conversations',
  chartData,
  valueKey,
  isAvg,
  unit = '',
  yMax,
  className,
}) => {
  const { t } = useTranslation()
  const statistics = chartData.data
  const yField = getChartValueField(statistics, valueKey)
  const options = buildChartOptions({
    statistics,
    chartType,
    yField,
    yMax,
  })
  const summaryValue = getSummaryValue({
    chartType,
    statistics,
    yField,
    isAvg,
    unit,
  })
  const tokenSummary = getTokenSummary(statistics)

  return (
    <div className={`flex w-full flex-col rounded-xl bg-components-chart-bg px-6 py-4 shadow-xs ${className ?? ''}`}>
      <div className="mb-3">
        <Basic name={title} type={timePeriod} hoverTip={explanation} />
      </div>
      <div className="mb-4 flex-1">
        <Basic
          isExtraInLine={CHART_TYPE_CONFIG[chartType].showTokens}
          name={summaryValue}
          type={!CHART_TYPE_CONFIG[chartType].showTokens
            ? ''
            : (
                <span>
                  {t('analysis.tokenUsage.consumed', { ns: 'appOverview' })}
                  {' '}
                  Tokens
                  <span className="text-sm">
                    <span className="ml-1 text-text-tertiary">(</span>
                    <span className="text-orange-400">
                      ~
                      {tokenSummary}
                    </span>
                    <span className="text-text-tertiary">)</span>
                  </span>
                </span>
              )}
          textStyle={{ main: `text-3xl! font-normal! ${summaryValue === '0' || summaryValue === '0 ms' ? 'text-text-quaternary!' : ''}` }}
        />
      </div>
      <ReactECharts option={options} style={{ height: 160 }} />
    </div>
  )
}

type ChartResponse = {
  data: ChartRow[]
}

type UseChartData = (id: string, query?: PeriodParams['query']) => {
  data?: ChartResponse
  isLoading: boolean
}

type BizChartConfig = {
  chartType: keyof typeof CHART_TYPE_CONFIG
  titleKey: string
  explanationKey: string
  useChartData: UseChartData
  valueKey?: string
  emptyValueKey?: string
  yMaxWhenEmpty: number
  isAvg?: boolean
  unitKey?: string
  className?: string
}

const createBizChartComponent = ({
  chartType,
  titleKey,
  explanationKey,
  useChartData,
  valueKey,
  emptyValueKey,
  yMaxWhenEmpty,
  isAvg,
  unitKey,
  className,
}: BizChartConfig): FC<IBizChartProps> => {
  const BizChart: FC<IBizChartProps> = ({ id, period }) => {
    const { t } = useTranslation()
    const { data: response, isLoading } = useChartData(id, period.query)

    if (isLoading || !response)
      return <Loading />

    const noDataFlag = !response.data || response.data.length === 0
    const fallbackKey = emptyValueKey ?? valueKey
    const fallbackData = {
      data: getDefaultChartData({
        ...(period.query ?? defaultPeriod),
        ...(fallbackKey ? { key: fallbackKey } : {}),
      }),
    }

    return (
      <Chart
        basicInfo={{
          title: t(titleKey, titleKey, { ns: 'appOverview' }),
          explanation: t(explanationKey, explanationKey, { ns: 'appOverview' }),
          timePeriod: period.name,
        }}
        chartData={noDataFlag ? fallbackData : response}
        chartType={chartType}
        valueKey={valueKey}
        isAvg={isAvg}
        unit={unitKey ? t(unitKey, unitKey, { ns: 'appOverview' }) : undefined}
        className={className}
        {...(noDataFlag && { yMax: yMaxWhenEmpty })}
      />
    )
  }

  return BizChart
}

export const MessagesChart = createBizChartComponent({
  chartType: 'messages',
  titleKey: 'analysis.totalMessages.title',
  explanationKey: 'analysis.totalMessages.explanation',
  useChartData: useAppDailyMessages,
  yMaxWhenEmpty: 500,
})

export const ConversationsChart = createBizChartComponent({
  chartType: 'conversations',
  titleKey: 'analysis.totalConversations.title',
  explanationKey: 'analysis.totalConversations.explanation',
  useChartData: useAppDailyConversations,
  yMaxWhenEmpty: 500,
})

export const EndUsersChart = createBizChartComponent({
  chartType: 'endUsers',
  titleKey: 'analysis.activeUsers.title',
  explanationKey: 'analysis.activeUsers.explanation',
  useChartData: useAppDailyEndUsers,
  yMaxWhenEmpty: 500,
})

export const AvgSessionInteractions = createBizChartComponent({
  chartType: 'conversations',
  titleKey: 'analysis.avgSessionInteractions.title',
  explanationKey: 'analysis.avgSessionInteractions.explanation',
  useChartData: useAppAverageSessionInteractions,
  valueKey: 'interactions',
  emptyValueKey: 'interactions',
  yMaxWhenEmpty: 500,
  isAvg: true,
})

export const AvgResponseTime = createBizChartComponent({
  chartType: 'conversations',
  titleKey: 'analysis.avgResponseTime.title',
  explanationKey: 'analysis.avgResponseTime.explanation',
  useChartData: useAppAverageResponseTime,
  valueKey: 'latency',
  emptyValueKey: 'latency',
  yMaxWhenEmpty: 500,
  isAvg: true,
  unitKey: 'analysis.ms',
})

export const TokenPerSecond = createBizChartComponent({
  chartType: 'conversations',
  titleKey: 'analysis.tps.title',
  explanationKey: 'analysis.tps.explanation',
  useChartData: useAppTokensPerSecond,
  valueKey: 'tps',
  emptyValueKey: 'tps',
  yMaxWhenEmpty: 100,
  isAvg: true,
  unitKey: 'analysis.tokenPS',
  className: 'min-w-0',
})

export const UserSatisfactionRate = createBizChartComponent({
  chartType: 'endUsers',
  titleKey: 'analysis.userSatisfactionRate.title',
  explanationKey: 'analysis.userSatisfactionRate.explanation',
  useChartData: useAppSatisfactionRate,
  valueKey: 'rate',
  emptyValueKey: 'rate',
  yMaxWhenEmpty: 1000,
  isAvg: true,
  className: 'h-full',
})

export const CostChart = createBizChartComponent({
  chartType: 'costs',
  titleKey: 'analysis.tokenUsage.title',
  explanationKey: 'analysis.tokenUsage.explanation',
  useChartData: useAppTokenCosts,
  yMaxWhenEmpty: 100,
})

export const WorkflowMessagesChart = createBizChartComponent({
  chartType: 'conversations',
  titleKey: 'analysis.totalMessages.title',
  explanationKey: 'analysis.totalMessages.explanation',
  useChartData: useWorkflowDailyConversations,
  valueKey: 'runs',
  emptyValueKey: 'runs',
  yMaxWhenEmpty: 500,
})

export const WorkflowDailyTerminalsChart = createBizChartComponent({
  chartType: 'endUsers',
  titleKey: 'analysis.activeUsers.title',
  explanationKey: 'analysis.activeUsers.explanation',
  useChartData: useWorkflowDailyTerminals,
  yMaxWhenEmpty: 500,
})

export const WorkflowCostChart = createBizChartComponent({
  chartType: 'workflowCosts',
  titleKey: 'analysis.tokenUsage.title',
  explanationKey: 'analysis.tokenUsage.explanation',
  useChartData: useWorkflowTokenCosts,
  yMaxWhenEmpty: 100,
})

export const AvgUserInteractions = createBizChartComponent({
  chartType: 'conversations',
  titleKey: 'analysis.avgUserInteractions.title',
  explanationKey: 'analysis.avgUserInteractions.explanation',
  useChartData: useWorkflowAverageInteractions,
  valueKey: 'interactions',
  emptyValueKey: 'interactions',
  yMaxWhenEmpty: 500,
  isAvg: true,
})

export default Chart
