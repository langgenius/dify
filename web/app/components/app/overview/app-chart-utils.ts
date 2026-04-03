import type { EChartsOption } from 'echarts'
import dayjs from 'dayjs'
import Decimal from 'decimal.js'
import { get } from 'es-toolkit/compat'
import { formatNumber } from '@/utils/format'

type ColorType = 'green' | 'orange' | 'blue'

type ChartType = 'messages' | 'conversations' | 'endUsers' | 'costs' | 'workflowCosts'

export type ChartRow = {
  date: string
  total_price?: number | string
} & Record<string, number | string | undefined>

type ChartConfig = {
  colorType: ColorType
  showTokens?: boolean
}

type TooltipParams = {
  name: string
  data?: ChartRow
}

const valueFormatter = (value: string | number) => value

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

const commonDateFormat = 'MMM D, YYYY'

export const defaultPeriod = {
  start: dayjs().subtract(7, 'day').format(commonDateFormat),
  end: dayjs().format(commonDateFormat),
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

const sumValues = (values: Decimal.Value[]): number => Decimal.sum(...values).toNumber()

const getRowValue = (row: ChartRow, field: string): Decimal.Value => row[field] ?? 0

const getChartColors = (chartType: ChartType) => COLOR_TYPE_MAP[CHART_TYPE_CONFIG[chartType].colorType]

const getMarkLineSeedData = (statisticsLength: number) => {
  const markLineLength = statisticsLength >= 2 ? statisticsLength - 2 : statisticsLength
  return ['', ...Array.from({ length: markLineLength }, () => '1'), '']
}

const getTooltipContent = (chartType: ChartType, yField: string, params: TooltipParams) => {
  const row = params.data ?? { date: params.name }
  const value = valueFormatter(row[yField] ?? 0)
  if (!CHART_TYPE_CONFIG[chartType].showTokens)
    return `<div style='color:#6B7280;font-size:12px'>${params.name}</div><div style='font-size:14px;color:#1F2A37'>${value}</div>`

  return `<div style='color:#6B7280;font-size:12px'>${params.name}</div>
    <div style='font-size:14px;color:#1F2A37'>${value}
      <span style='font-size:12px'>
        <span style='margin-left:4px;color:#6B7280'>(</span>
        <span style='color:#FF8A4C'>~$${get(row, 'total_price', 0)}</span>
        <span style='color:#6B7280'>)</span>
      </span>
    </div>`
}

export const getChartValueField = (statistics: ChartRow[], valueKey?: string) => {
  if (valueKey)
    return valueKey

  return Object.keys(statistics[0] ?? {}).find(name => name.includes('count')) ?? 'count'
}

export const getSummaryValue = ({
  chartType,
  statistics,
  yField,
  isAvg,
  unit = '',
}: {
  chartType: ChartType
  statistics: ChartRow[]
  yField: string
  isAvg?: boolean
  unit?: string
}) => {
  const values = statistics.map(item => getRowValue(item, yField))
  const divisor = values.length || 1
  const sumData = isAvg ? (sumValues(values) / divisor) : sumValues(values)

  if (chartType === 'costs') {
    const formattedCost = sumData < 1000
      ? sumData
      : `${formatNumber(Math.round(sumData / 1000))}k`

    return `${formattedCost}`
  }

  return `${sumData.toLocaleString()} ${unit}`.trim()
}

export const getTokenSummary = (statistics: ChartRow[]) => {
  const totalPrice = sumValues(statistics.map(item => Number.parseFloat(String(get(item, 'total_price', '0')))))
  return totalPrice.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
  })
}

export const buildChartOptions = ({
  statistics,
  chartType,
  yField,
  yMax,
}: {
  statistics: ChartRow[]
  chartType: ChartType
  yField: string
  yMax?: number
}): EChartsOption => {
  const xData = statistics.map(({ date }) => date)
  const chartColors = getChartColors(chartType)
  const markLineSeedData = getMarkLineSeedData(statistics.length)

  return {
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
      data: markLineSeedData,
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
          color: chartColors.lineColor,
          width: 2,
        },
        itemStyle: {
          color: chartColors.lineColor,
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
              color: chartColors.bgColor[0],
            }, {
              offset: 1,
              color: chartColors.bgColor[1],
            }],
            global: false,
          },
        },
        tooltip: {
          padding: [8, 12, 8, 12],
          formatter(params) {
            return getTooltipContent(chartType, yField, params as unknown as TooltipParams)
          },
        },
      },
    ],
  }
}

export const getDefaultChartData = ({ start, end, key = 'count' }: { start: string, end: string, key?: string }) => {
  const diffDays = dayjs(end).diff(dayjs(start), 'day')
  return Array.from({ length: diffDays || 1 }, () => ({ date: '', [key]: 0 })).map((item, index) => {
    item.date = dayjs(start).add(index, 'day').format(commonDateFormat)
    return item
  })
}
