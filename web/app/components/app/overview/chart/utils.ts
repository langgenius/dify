import type { EChartsOption } from 'echarts'
import dayjs from 'dayjs'
import Decimal from 'decimal.js'
import { formatNumber } from '@/utils/format'

export type ChartStatisticRecord = {
  date: string
} & Record<string, string | number | undefined>

export type ChartDataResponse = {
  data: ChartStatisticRecord[]
}

type ColorType = 'green' | 'orange' | 'blue'
export type ChartType = 'messages' | 'conversations' | 'endUsers' | 'costs' | 'workflowCosts'

type ChartConfig = {
  colorType: ColorType
  showTokens?: boolean
}

export const commonDateFormat = 'MMM D, YYYY'

export const defaultPeriod = {
  start: dayjs().subtract(7, 'day').format(commonDateFormat),
  end: dayjs().format(commonDateFormat),
}

const COLOR_TYPE_MAP: Record<ColorType, { lineColor: string, bgColor: [string, string] }> = {
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

export const CHART_TYPE_CONFIG: Record<ChartType, ChartConfig> = {
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

export const sum = (values: Decimal.Value[]): number => Decimal.sum(...values).toNumber()

export const getDefaultChartData = ({ start, end, key = 'count' }: { start: string, end: string, key?: string }): ChartStatisticRecord[] => {
  const diffDays = dayjs(end).diff(dayjs(start), 'day')

  return Array.from({ length: diffDays || 1 }, (_, index) => ({
    date: dayjs(start).add(index, 'day').format(commonDateFormat),
    [key]: 0,
  }))
}

export const isChartDataEmpty = (chartData?: ChartDataResponse) => !chartData?.data?.length

export const getChartValueKey = (statistics: ChartStatisticRecord[], valueKey?: string) => {
  if (valueKey)
    return valueKey

  return Object.keys(statistics[0] ?? {}).find(name => name.includes('count')) ?? 'count'
}

export const getStatisticNumber = (statistic: ChartStatisticRecord, key: string) => {
  const value = statistic[key]

  if (typeof value === 'number')
    return value

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }

  return 0
}

export const getChartValues = (statistics: ChartStatisticRecord[], valueKey: string) => {
  return statistics.map(statistic => getStatisticNumber(statistic, valueKey))
}

export const getChartSummaryValue = (statistics: ChartStatisticRecord[], valueKey: string, isAvg?: boolean) => {
  const values = getChartValues(statistics, valueKey)
  if (!values.length)
    return 0

  const total = sum(values)
  return isAvg ? total / values.length : total
}

export const getTotalPriceValue = (statistics: ChartStatisticRecord[]) => {
  return sum(statistics.map(statistic => getStatisticNumber(statistic, 'total_price')))
}

export const formatChartSummaryValue = ({
  chartType,
  summaryValue,
  unit = '',
}: {
  chartType: ChartType
  summaryValue: number
  unit?: string
}) => {
  if (chartType === 'costs')
    return summaryValue < 1000 ? `${summaryValue}` : `${formatNumber(Math.round(summaryValue / 1000))}k`

  return `${summaryValue.toLocaleString()}${unit ? ` ${unit}` : ''}`
}

export const buildChartOptions = ({
  chartType,
  statistics,
  valueKey,
  yMax,
}: {
  chartType: ChartType
  statistics: ChartStatisticRecord[]
  valueKey: string
  yMax?: number
}): EChartsOption => {
  const colorConfig = COLOR_TYPE_MAP[CHART_TYPE_CONFIG[chartType].colorType]
  const statisticsLength = statistics.length
  const markLineLength = statisticsLength >= 2 ? statisticsLength - 2 : statisticsLength
  const markLineLabels = Array.from({ length: markLineLength }, () => '1')
  markLineLabels.push('')
  markLineLabels.unshift('')

  return {
    dataset: {
      dimensions: ['date', valueKey],
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
          return index === 0 || index === statistics.length - 1
        },
      },
    }, {
      position: 'bottom',
      boundaryGap: false,
      data: markLineLabels,
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
        symbolSize: 4,
        lineStyle: {
          color: colorConfig.lineColor,
          width: 2,
        },
        itemStyle: {
          color: colorConfig.lineColor,
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
              color: colorConfig.bgColor[0],
            }, {
              offset: 1,
              color: colorConfig.bgColor[1],
            }],
            global: false,
          },
        },
        tooltip: {
          padding: [8, 12, 8, 12],
          formatter(params) {
            const data = typeof params.data === 'object' && params.data && !Array.isArray(params.data)
              ? params.data as ChartStatisticRecord
              : undefined
            const value = data ? getStatisticNumber(data, valueKey) : 0
            const totalPrice = data ? getStatisticNumber(data, 'total_price') : 0

            return `<div style='color:#6B7280;font-size:12px'>${params.name}</div>
                          <div style='font-size:14px;color:#1F2A37'>${value}
                              ${!CHART_TYPE_CONFIG[chartType].showTokens
                                ? ''
                                : `<span style='font-size:12px'>
                                  <span style='margin-left:4px;color:#6B7280'>(</span>
                                  <span style='color:#FF8A4C'>~$${totalPrice}</span>
                                  <span style='color:#6B7280'>)</span>
                              </span>`}
                          </div>`
          },
        },
      },
    ],
  }
}
