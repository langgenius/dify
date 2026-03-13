'use client'
import type { Dayjs } from 'dayjs'
import type { EChartsOption } from 'echarts'
import type { FC } from 'react'
import type { AppDailyConversationsResponse, AppDailyEndUsersResponse, AppDailyMessagesResponse, AppTokenCostsResponse } from '@/models/app'
import dayjs from 'dayjs'
import Decimal from 'decimal.js'
import ReactECharts from 'echarts-for-react'
import { get } from 'es-toolkit/compat'
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
import { formatNumber } from '@/utils/format'

const valueFormatter = (v: string | number) => v

const COLOR_TYPE_MAP = {
  green: {
    lineColor: 'rgba(6, 148, 162, 1)',
    bgColor: ['rgba(6, 148, 162, 0.2)', 'rgba(67, 174, 185, 0.08)'],
  },
  orange: {
    lineColor: 'rgba(255, 138, 76, 1)',
    bgColor: ['rgba(254, 145, 87, 0.2)', 'rgba(255, 138, 76, 0.1)'],
  },
  blue: {
    lineColor: 'rgba(28, 100, 242, 1)',
    bgColor: ['rgba(28, 100, 242, 0.3)', 'rgba(28, 100, 242, 0.1)'],
  },
}

const COMMON_COLOR_MAP = {
  label: '#9CA3AF',
  splitLineLight: '#F3F4F6',
  splitLineDark: '#E5E7EB',
}

type IColorType = 'green' | 'orange' | 'blue'
type IChartType = 'messages' | 'conversations' | 'endUsers' | 'costs' | 'workflowCosts'
type IChartConfigType = { colorType: IColorType, showTokens?: boolean }

const commonDateFormat = 'MMM D, YYYY'

const CHART_TYPE_CONFIG: Record<string, IChartConfigType> = {
  messages: {
    colorType: 'green',
  },
  conversations: {
    colorType: 'green',
  },
  endUsers: {
    colorType: 'orange',
  },
  costs: {
    colorType: 'blue',
    showTokens: true,
  },
  workflowCosts: {
    colorType: 'blue',
  },
}

const sum = (arr: Decimal.Value[]): number => {
  return Decimal.sum(...arr).toNumber()
}

const defaultPeriod = {
  start: dayjs().subtract(7, 'day').format(commonDateFormat),
  end: dayjs().format(commonDateFormat),
}

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

export type IBizChartProps = {
  period: PeriodParams
  id: string
}

export type IChartProps = {
  className?: string
  basicInfo: { title: string, explanation: string, timePeriod: string }
  valueKey?: string
  isAvg?: boolean
  unit?: string
  yMax?: number
  chartType: IChartType
  chartData: AppDailyMessagesResponse | AppDailyConversationsResponse | AppDailyEndUsersResponse | AppTokenCostsResponse | { data: Array<{ date: string, count: number }> }
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
  const statisticsLen = statistics.length
  const markLineLength = statisticsLen >= 2 ? statisticsLen - 2 : statisticsLen
  const extraDataForMarkLine = Array.from({ length: markLineLength }, () => '1')
  extraDataForMarkLine.push('')
  extraDataForMarkLine.unshift('')

  const xData = statistics.map(({ date }) => date)
  const yField = valueKey || Object.keys(statistics[0]).find(name => name.includes('count')) || ''
  const yData = statistics.map((item) => {
    // @ts-expect-error field is valid
    return item[yField] || 0
  })

  const options: EChartsOption = {
    dataset: {
      dimensions: ['date', yField],
      source: statistics,
    },
    grid: { top: 8, right: 36, bottom: 10, left: 25, containLabel: true },
    tooltip: {
      trigger: 'item',
      position: 'top',
      borderWidth: 0,
    },
    xAxis: [{
      type: 'category',
      boundaryGap: false,
      axisLabel: {
        color: COMMON_COLOR_MAP.label,
        hideOverlap: true,
        overflow: 'break',
        formatter(value) {
          return dayjs(value).format(commonDateFormat)
        },
      },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: {
        show: true,
        lineStyle: {
          color: COMMON_COLOR_MAP.splitLineLight,
          width: 1,
          type: [10, 10],
        },
        interval(index) {
          return index === 0 || index === xData.length - 1
        },
      },
    }, {
      position: 'bottom',
      boundaryGap: false,
      data: extraDataForMarkLine,
      axisLabel: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: {
        show: true,
        lineStyle: {
          color: COMMON_COLOR_MAP.splitLineDark,
        },
        interval(_index, value) {
          return !!value
        },
      },
    }],
    yAxis: {
      max: yMax ?? 'dataMax',
      type: 'value',
      axisLabel: { color: COMMON_COLOR_MAP.label, hideOverlap: true },
      splitLine: {
        lineStyle: {
          color: COMMON_COLOR_MAP.splitLineLight,
        },
      },
    },
    series: [
      {
        type: 'line',
        showSymbol: true,
        // symbol: 'circle',
        // triggerLineEvent: true,
        symbolSize: 4,
        lineStyle: {
          color: COLOR_TYPE_MAP[CHART_TYPE_CONFIG[chartType].colorType].lineColor,
          width: 2,
        },
        itemStyle: {
          color: COLOR_TYPE_MAP[CHART_TYPE_CONFIG[chartType].colorType].lineColor,
        },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [{
              offset: 0,
              color: COLOR_TYPE_MAP[CHART_TYPE_CONFIG[chartType].colorType].bgColor[0],
            }, {
              offset: 1,
              color: COLOR_TYPE_MAP[CHART_TYPE_CONFIG[chartType].colorType].bgColor[1],
            }],
            global: false,
          },
        },
        tooltip: {
          padding: [8, 12, 8, 12],
          formatter(params) {
            return `<div style='color:#6B7280;font-size:12px'>${params.name}</div>
                          <div style='font-size:14px;color:#1F2A37'>${valueFormatter((params.data as any)[yField])}
                              ${!CHART_TYPE_CONFIG[chartType].showTokens
                                ? ''
                                : `<span style='font-size:12px'>
                                  <span style='margin-left:4px;color:#6B7280'>(</span>
                                  <span style='color:#FF8A4C'>~$${get(params.data, 'total_price', 0)}</span>
                                  <span style='color:#6B7280'>)</span>
                              </span>`}
                          </div>`
          },
        },
      },
    ],
  }
  const sumData = isAvg ? (sum(yData) / yData.length) : sum(yData)

  return (
    <div className={`flex w-full flex-col rounded-xl bg-components-chart-bg px-6 py-4 shadow-xs ${className ?? ''}`}>
      <div className="mb-3">
        <Basic name={title} type={timePeriod} hoverTip={explanation} />
      </div>
      <div className="mb-4 flex-1">
        <Basic
          isExtraInLine={CHART_TYPE_CONFIG[chartType].showTokens}
          name={chartType !== 'costs' ? (`${sumData.toLocaleString()} ${unit}`) : `${sumData < 1000 ? sumData : (`${formatNumber(Math.round(sumData / 1000))}k`)}`}
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
                      {sum(statistics.map(item => Number.parseFloat(String(get(item, 'total_price', '0'))))).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4 })}
                    </span>
                    <span className="text-text-tertiary">)</span>
                  </span>
                </span>
              )}
          textStyle={{ main: `!text-3xl !font-normal ${sumData === 0 ? '!text-text-quaternary' : ''}` }}
        />
      </div>
      <ReactECharts option={options} style={{ height: 160 }} />
    </div>
  )
}

const getDefaultChartData = ({ start, end, key = 'count' }: { start: string, end: string, key?: string }) => {
  const diffDays = dayjs(end).diff(dayjs(start), 'day')
  return Array.from({ length: diffDays || 1 }, () => ({ date: '', [key]: 0 })).map((item, index) => {
    item.date = dayjs(start).add(index, 'day').format(commonDateFormat)
    return item
  })
}

export const MessagesChart: FC<IBizChartProps> = ({ id, period }) => {
  const { t } = useTranslation()
  const { data: response, isLoading } = useAppDailyMessages(id, period.query)
  if (isLoading || !response)
    return <Loading />
  const noDataFlag = !response.data || response.data.length === 0
  return (
    <Chart
      basicInfo={{ title: t('analysis.totalMessages.title', { ns: 'appOverview' }), explanation: t('analysis.totalMessages.explanation', { ns: 'appOverview' }), timePeriod: period.name }}
      chartData={!noDataFlag ? response : { data: getDefaultChartData(period.query ?? defaultPeriod) } as any}
      chartType="messages"
      {...(noDataFlag && { yMax: 500 })}
    />
  )
}

export const ConversationsChart: FC<IBizChartProps> = ({ id, period }) => {
  const { t } = useTranslation()
  const { data: response, isLoading } = useAppDailyConversations(id, period.query)
  if (isLoading || !response)
    return <Loading />
  const noDataFlag = !response.data || response.data.length === 0
  return (
    <Chart
      basicInfo={{ title: t('analysis.totalConversations.title', { ns: 'appOverview' }), explanation: t('analysis.totalConversations.explanation', { ns: 'appOverview' }), timePeriod: period.name }}
      chartData={!noDataFlag ? response : { data: getDefaultChartData(period.query ?? defaultPeriod) } as any}
      chartType="conversations"
      {...(noDataFlag && { yMax: 500 })}
    />
  )
}

export const EndUsersChart: FC<IBizChartProps> = ({ id, period }) => {
  const { t } = useTranslation()

  const { data: response, isLoading } = useAppDailyEndUsers(id, period.query)
  if (isLoading || !response)
    return <Loading />
  const noDataFlag = !response.data || response.data.length === 0
  return (
    <Chart
      basicInfo={{ title: t('analysis.activeUsers.title', { ns: 'appOverview' }), explanation: t('analysis.activeUsers.explanation', { ns: 'appOverview' }), timePeriod: period.name }}
      chartData={!noDataFlag ? response : { data: getDefaultChartData(period.query ?? defaultPeriod) } as any}
      chartType="endUsers"
      {...(noDataFlag && { yMax: 500 })}
    />
  )
}

export const AvgSessionInteractions: FC<IBizChartProps> = ({ id, period }) => {
  const { t } = useTranslation()
  const { data: response, isLoading } = useAppAverageSessionInteractions(id, period.query)
  if (isLoading || !response)
    return <Loading />
  const noDataFlag = !response.data || response.data.length === 0
  return (
    <Chart
      basicInfo={{ title: t('analysis.avgSessionInteractions.title', { ns: 'appOverview' }), explanation: t('analysis.avgSessionInteractions.explanation', { ns: 'appOverview' }), timePeriod: period.name }}
      chartData={!noDataFlag ? response : { data: getDefaultChartData({ ...(period.query ?? defaultPeriod), key: 'interactions' }) } as any}
      chartType="conversations"
      valueKey="interactions"
      isAvg
      {...(noDataFlag && { yMax: 500 })}
    />
  )
}

export const AvgResponseTime: FC<IBizChartProps> = ({ id, period }) => {
  const { t } = useTranslation()
  const { data: response, isLoading } = useAppAverageResponseTime(id, period.query)
  if (isLoading || !response)
    return <Loading />
  const noDataFlag = !response.data || response.data.length === 0
  return (
    <Chart
      basicInfo={{ title: t('analysis.avgResponseTime.title', { ns: 'appOverview' }), explanation: t('analysis.avgResponseTime.explanation', { ns: 'appOverview' }), timePeriod: period.name }}
      chartData={!noDataFlag ? response : { data: getDefaultChartData({ ...(period.query ?? defaultPeriod), key: 'latency' }) } as any}
      valueKey="latency"
      chartType="conversations"
      isAvg
      unit={t('analysis.ms', { ns: 'appOverview' }) as string}
      {...(noDataFlag && { yMax: 500 })}
    />
  )
}

export const TokenPerSecond: FC<IBizChartProps> = ({ id, period }) => {
  const { t } = useTranslation()
  const { data: response, isLoading } = useAppTokensPerSecond(id, period.query)
  if (isLoading || !response)
    return <Loading />
  const noDataFlag = !response.data || response.data.length === 0
  return (
    <Chart
      basicInfo={{ title: t('analysis.tps.title', { ns: 'appOverview' }), explanation: t('analysis.tps.explanation', { ns: 'appOverview' }), timePeriod: period.name }}
      chartData={!noDataFlag ? response : { data: getDefaultChartData({ ...(period.query ?? defaultPeriod), key: 'tps' }) } as any}
      valueKey="tps"
      chartType="conversations"
      isAvg
      unit={t('analysis.tokenPS', { ns: 'appOverview' }) as string}
      {...(noDataFlag && { yMax: 100 })}
      className="min-w-0"
    />
  )
}

export const UserSatisfactionRate: FC<IBizChartProps> = ({ id, period }) => {
  const { t } = useTranslation()
  const { data: response, isLoading } = useAppSatisfactionRate(id, period.query)
  if (isLoading || !response)
    return <Loading />
  const noDataFlag = !response.data || response.data.length === 0
  return (
    <Chart
      basicInfo={{ title: t('analysis.userSatisfactionRate.title', { ns: 'appOverview' }), explanation: t('analysis.userSatisfactionRate.explanation', { ns: 'appOverview' }), timePeriod: period.name }}
      chartData={!noDataFlag ? response : { data: getDefaultChartData({ ...(period.query ?? defaultPeriod), key: 'rate' }) } as any}
      valueKey="rate"
      chartType="endUsers"
      isAvg
      {...(noDataFlag && { yMax: 1000 })}
      className="h-full"
    />
  )
}

export const CostChart: FC<IBizChartProps> = ({ id, period }) => {
  const { t } = useTranslation()

  const { data: response, isLoading } = useAppTokenCosts(id, period.query)
  if (isLoading || !response)
    return <Loading />
  const noDataFlag = !response.data || response.data.length === 0
  return (
    <Chart
      basicInfo={{ title: t('analysis.tokenUsage.title', { ns: 'appOverview' }), explanation: t('analysis.tokenUsage.explanation', { ns: 'appOverview' }), timePeriod: period.name }}
      chartData={!noDataFlag ? response : { data: getDefaultChartData(period.query ?? defaultPeriod) } as any}
      chartType="costs"
      {...(noDataFlag && { yMax: 100 })}
    />
  )
}

export const WorkflowMessagesChart: FC<IBizChartProps> = ({ id, period }) => {
  const { t } = useTranslation()
  const { data: response, isLoading } = useWorkflowDailyConversations(id, period.query)
  if (isLoading || !response)
    return <Loading />
  const noDataFlag = !response.data || response.data.length === 0
  return (
    <Chart
      basicInfo={{ title: t('analysis.totalMessages.title', { ns: 'appOverview' }), explanation: t('analysis.totalMessages.explanation', { ns: 'appOverview' }), timePeriod: period.name }}
      chartData={!noDataFlag ? response : { data: getDefaultChartData({ ...(period.query ?? defaultPeriod), key: 'runs' }) } as any}
      chartType="conversations"
      valueKey="runs"
      {...(noDataFlag && { yMax: 500 })}
    />
  )
}

export const WorkflowDailyTerminalsChart: FC<IBizChartProps> = ({ id, period }) => {
  const { t } = useTranslation()

  const { data: response, isLoading } = useWorkflowDailyTerminals(id, period.query)
  if (isLoading || !response)
    return <Loading />
  const noDataFlag = !response.data || response.data.length === 0
  return (
    <Chart
      basicInfo={{ title: t('analysis.activeUsers.title', { ns: 'appOverview' }), explanation: t('analysis.activeUsers.explanation', { ns: 'appOverview' }), timePeriod: period.name }}
      chartData={!noDataFlag ? response : { data: getDefaultChartData(period.query ?? defaultPeriod) } as any}
      chartType="endUsers"
      {...(noDataFlag && { yMax: 500 })}
    />
  )
}

export const WorkflowCostChart: FC<IBizChartProps> = ({ id, period }) => {
  const { t } = useTranslation()

  const { data: response, isLoading } = useWorkflowTokenCosts(id, period.query)
  if (isLoading || !response)
    return <Loading />
  const noDataFlag = !response.data || response.data.length === 0
  return (
    <Chart
      basicInfo={{ title: t('analysis.tokenUsage.title', { ns: 'appOverview' }), explanation: t('analysis.tokenUsage.explanation', { ns: 'appOverview' }), timePeriod: period.name }}
      chartData={!noDataFlag ? response : { data: getDefaultChartData(period.query ?? defaultPeriod) } as any}
      chartType="workflowCosts"
      {...(noDataFlag && { yMax: 100 })}
    />
  )
}

export const AvgUserInteractions: FC<IBizChartProps> = ({ id, period }) => {
  const { t } = useTranslation()
  const { data: response, isLoading } = useWorkflowAverageInteractions(id, period.query)
  if (isLoading || !response)
    return <Loading />
  const noDataFlag = !response.data || response.data.length === 0
  return (
    <Chart
      basicInfo={{ title: t('analysis.avgUserInteractions.title', { ns: 'appOverview' }), explanation: t('analysis.avgUserInteractions.explanation', { ns: 'appOverview' }), timePeriod: period.name }}
      chartData={!noDataFlag ? response : { data: getDefaultChartData({ ...(period.query ?? defaultPeriod), key: 'interactions' }) } as any}
      chartType="conversations"
      valueKey="interactions"
      isAvg
      {...(noDataFlag && { yMax: 500 })}
    />
  )
}

export default Chart
