'use client'

import type { ReactNode } from 'react'
import type { ChartDataResponse, ChartType } from './utils'
import type { AppDailyConversationsResponse, AppDailyEndUsersResponse, AppDailyMessagesResponse, AppStatisticsResponse, AppTokenCostsResponse, WorkflowDailyConversationsResponse } from '@/models/app'
import ReactECharts from 'echarts-for-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Basic from '@/app/components/app-sidebar/basic'
import {
  buildChartOptions,
  CHART_TYPE_CONFIG,
  formatChartSummaryValue,
  getChartSummaryValue,
  getChartValueKey,
  getTotalPriceValue,
} from './utils'

type ChartResponse
  = | AppDailyMessagesResponse
    | AppDailyConversationsResponse
    | AppDailyEndUsersResponse
    | AppTokenCostsResponse
    | AppStatisticsResponse
    | WorkflowDailyConversationsResponse
    | ChartDataResponse

export type IChartProps = {
  className?: string
  basicInfo: {
    title: string
    explanation: string
    timePeriod: string
  }
  valueKey?: string
  isAvg?: boolean
  unit?: string
  yMax?: number
  chartType: ChartType
  chartData: ChartResponse
}

const buildTokenSummary = (label: string, tokenPriceSummary: string): ReactNode => (
  <span>
    {label}
    {' '}
    Tokens
    <span className="text-sm">
      <span className="ml-1 text-text-tertiary">(</span>
      <span className="text-orange-400">
        ~
        {tokenPriceSummary}
      </span>
      <span className="text-text-tertiary">)</span>
    </span>
  </span>
)

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
  const resolvedValueKey = getChartValueKey(statistics, valueKey)
  const summaryValue = getChartSummaryValue(statistics, resolvedValueKey, isAvg)
  const showTokens = CHART_TYPE_CONFIG[chartType].showTokens
  const tokenPriceSummary = getTotalPriceValue(statistics).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
  })

  return (
    <div className={`flex w-full flex-col rounded-xl bg-components-chart-bg px-6 py-4 shadow-xs ${className ?? ''}`}>
      <div className="mb-3">
        <Basic name={title} type={timePeriod} hoverTip={explanation} />
      </div>
      <div className="mb-4 flex-1">
        <Basic
          isExtraInLine={showTokens}
          name={formatChartSummaryValue({ chartType, summaryValue, unit })}
          type={showTokens ? buildTokenSummary(t('analysis.tokenUsage.consumed', { ns: 'appOverview' }), tokenPriceSummary) : ''}
          textStyle={{ main: `!text-3xl !font-normal ${summaryValue === 0 ? '!text-text-quaternary' : ''}` }}
        />
      </div>
      <ReactECharts option={buildChartOptions({ chartType, statistics, valueKey: resolvedValueKey, yMax })} style={{ height: 160 }} />
    </div>
  )
}

export default Chart
