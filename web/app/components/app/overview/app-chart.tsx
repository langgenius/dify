/* eslint-disable react-refresh/only-export-components, react/component-hook-factories */
'use client'
import type { Dayjs } from 'dayjs'
import type { SelectorParam } from 'i18next'
import type { FC } from 'react'
import type { ChartRow } from './app-chart-utils'
import ReactECharts from 'echarts-for-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
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
  hasNonZeroChartData,
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

const ECHARTS_RENDER_OPTIONS = { renderer: 'svg' as const }

const Chart: React.FC<IChartProps> = ({
  basicInfo: { title, explanation },
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
  const showTokenSummary = CHART_TYPE_CONFIG[chartType].showTokens && hasNonZeroChartData(statistics, 'total_price')
  const isZeroSummary = !hasNonZeroChartData(statistics, yField)

  return (
    <div className={`flex h-[316px] w-full min-w-0 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg xl:min-w-[480px] ${className ?? ''}`}>
      <div className="flex h-11 shrink-0 items-center px-6 pt-6 pb-1">
        <div className="flex min-w-0 items-center">
          <div className="min-w-0 truncate system-sm-semibold-uppercase text-text-secondary">
            {title}
          </div>
          {explanation && (
            <Infotip aria-label={explanation} className="ml-1" popupClassName="w-[240px]">
              {explanation}
            </Infotip>
          )}
        </div>
      </div>
      <div className="flex h-8 shrink-0 items-baseline gap-1 px-6 py-1">
        <div className={`shrink-0 title-3xl-semi-bold ${isZeroSummary ? 'text-text-quaternary' : 'text-text-primary'}`}>
          {summaryValue}
        </div>
        {showTokenSummary && (
          <div className="min-w-0 truncate system-sm-medium text-text-tertiary">
            {t($ => $['analysis.tokenUsage.consumed'], { ns: 'appOverview' })}
            {' '}
            Tokens
            {' '}
            <span>(</span>
            <span className="text-orange-400">
              ~
              {tokenSummary}
            </span>
            <span>)</span>
          </div>
        )}
      </div>
      <div className="h-[240px] shrink-0 px-6 pb-4">
        <ReactECharts option={options} opts={ECHARTS_RENDER_OPTIONS} style={{ height: '100%', width: '100%' }} />
      </div>
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

const CHART_TRANSLATION_SELECTOR_MAP = {
  'analysis.activeUsers.explanation': $ => $['analysis.activeUsers.explanation'],
  'analysis.activeUsers.title': $ => $['analysis.activeUsers.title'],
  'analysis.avgResponseTime.explanation': $ => $['analysis.avgResponseTime.explanation'],
  'analysis.avgResponseTime.title': $ => $['analysis.avgResponseTime.title'],
  'analysis.avgSessionInteractions.explanation': $ => $['analysis.avgSessionInteractions.explanation'],
  'analysis.avgSessionInteractions.title': $ => $['analysis.avgSessionInteractions.title'],
  'analysis.avgUserInteractions.explanation': $ => $['analysis.avgUserInteractions.explanation'],
  'analysis.avgUserInteractions.title': $ => $['analysis.avgUserInteractions.title'],
  'analysis.ms': $ => $['analysis.ms'],
  'analysis.tokenPS': $ => $['analysis.tokenPS'],
  'analysis.tokenUsage.explanation': $ => $['analysis.tokenUsage.explanation'],
  'analysis.tokenUsage.title': $ => $['analysis.tokenUsage.title'],
  'analysis.totalConversations.explanation': $ => $['analysis.totalConversations.explanation'],
  'analysis.totalConversations.title': $ => $['analysis.totalConversations.title'],
  'analysis.totalMessages.explanation': $ => $['analysis.totalMessages.explanation'],
  'analysis.totalMessages.title': $ => $['analysis.totalMessages.title'],
  'analysis.tps.explanation': $ => $['analysis.tps.explanation'],
  'analysis.tps.title': $ => $['analysis.tps.title'],
  'analysis.userSatisfactionRate.explanation': $ => $['analysis.userSatisfactionRate.explanation'],
  'analysis.userSatisfactionRate.title': $ => $['analysis.userSatisfactionRate.title'],
} satisfies Record<string, SelectorParam<'appOverview'>>

type ChartTranslationKey = keyof typeof CHART_TRANSLATION_SELECTOR_MAP

type BizChartConfig = {
  chartType: keyof typeof CHART_TYPE_CONFIG
  titleKey: ChartTranslationKey
  explanationKey: ChartTranslationKey
  useChartData: UseChartData
  valueKey?: string
  emptyValueKey?: string
  yMaxWhenEmpty: number
  isAvg?: boolean
  unitKey?: ChartTranslationKey
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
    const titleSelector: SelectorParam<'appOverview'> = CHART_TRANSLATION_SELECTOR_MAP[titleKey]
    const explanationSelector: SelectorParam<'appOverview'> = CHART_TRANSLATION_SELECTOR_MAP[explanationKey]
    const unitSelector: SelectorParam<'appOverview'> | undefined = unitKey
      ? CHART_TRANSLATION_SELECTOR_MAP[unitKey]
      : undefined
    const fallbackData = {
      data: getDefaultChartData({
        ...(period.query ?? defaultPeriod),
        ...(fallbackKey ? { key: fallbackKey } : {}),
      }),
    }

    return (
      <Chart
        basicInfo={{
          title: t(titleSelector, { ns: 'appOverview', defaultValue: titleKey }),
          explanation: t(explanationSelector, { ns: 'appOverview', defaultValue: explanationKey }),
          timePeriod: period.name,
        }}
        chartData={noDataFlag ? fallbackData : response}
        chartType={chartType}
        valueKey={valueKey}
        isAvg={isAvg}
        unit={unitKey && unitSelector ? t(unitSelector, { ns: 'appOverview', defaultValue: unitKey }) : undefined}
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
  valueKey: 'message_count',
  emptyValueKey: 'message_count',
  yMaxWhenEmpty: 500,
})

export const ConversationsChart = createBizChartComponent({
  chartType: 'conversations',
  titleKey: 'analysis.totalConversations.title',
  explanationKey: 'analysis.totalConversations.explanation',
  useChartData: useAppDailyConversations,
  valueKey: 'conversation_count',
  emptyValueKey: 'conversation_count',
  yMaxWhenEmpty: 500,
})

export const EndUsersChart = createBizChartComponent({
  chartType: 'endUsers',
  titleKey: 'analysis.activeUsers.title',
  explanationKey: 'analysis.activeUsers.explanation',
  useChartData: useAppDailyEndUsers,
  valueKey: 'terminal_count',
  emptyValueKey: 'terminal_count',
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
  valueKey: 'token_count',
  emptyValueKey: 'token_count',
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
  valueKey: 'terminal_count',
  emptyValueKey: 'terminal_count',
  yMaxWhenEmpty: 500,
})

export const WorkflowCostChart = createBizChartComponent({
  chartType: 'workflowCosts',
  titleKey: 'analysis.tokenUsage.title',
  explanationKey: 'analysis.tokenUsage.explanation',
  useChartData: useWorkflowTokenCosts,
  valueKey: 'token_count',
  emptyValueKey: 'token_count',
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
