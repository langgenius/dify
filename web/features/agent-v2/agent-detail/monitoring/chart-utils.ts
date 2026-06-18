import type { EChartsOption } from 'echarts'
import dayjs from 'dayjs'
import { formatNumber } from '@/utils/format'

export type AgentMonitoringChartType = 'conversations' | 'endUsers' | 'tokenUsage'

export type AgentMonitoringChartRow = {
  date: string
  total_price?: number | string
} & Record<string, number | string | undefined>

type ColorType = 'green' | 'orange' | 'blue'

const colorTypeMap: Record<ColorType, { lineColor: string, bgColor: [string, string] }> = {
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

const chartTypeColorMap: Record<AgentMonitoringChartType, ColorType> = {
  conversations: 'blue',
  endUsers: 'blue',
  tokenUsage: 'blue',
}

const commonDateFormat = 'MMM D, YYYY'
const axisDateFormat = 'MMM'

const sumValues = (rows: AgentMonitoringChartRow[], field: string) => {
  return rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0)
}

const getChartColors = (chartType: AgentMonitoringChartType) => colorTypeMap[chartTypeColorMap[chartType]]

const getMarkLineSeedData = (statisticsLength: number) => {
  const markLineLength = statisticsLength >= 2 ? statisticsLength - 2 : statisticsLength
  return ['', ...Array.from({ length: markLineLength }, () => '1'), '']
}

const getTooltipContent = (
  chartType: AgentMonitoringChartType,
  yField: string,
  params: { name: string, data?: AgentMonitoringChartRow },
) => {
  const row = params.data ?? { date: params.name }
  const value = row[yField] ?? 0

  if (chartType !== 'tokenUsage')
    return `<div style='color:#6B7280;font-size:12px'>${params.name}</div><div style='font-size:14px;color:#1F2A37'>${value}</div>`

  return `<div style='color:#6B7280;font-size:12px'>${params.name}</div>
    <div style='font-size:14px;color:#1F2A37'>${value}
      <span style='font-size:12px'>
        <span style='margin-left:4px;color:#6B7280'>(</span>
        <span style='color:#FF8A4C'>~$${row.total_price ?? 0}</span>
        <span style='color:#6B7280'>)</span>
      </span>
    </div>`
}

export const getDefaultChartData = ({
  key = 'count',
}: {
  start: string
  end: string
  key?: string
}) => {
  const values = [180, 198, 188, 286, 423, 345]

  return values.map((value, index) => ({
    date: dayjs('2024-01-01').add(index, 'month').format(commonDateFormat),
    [key]: value,
    total_price: '0.0000',
  }))
}

export const getChartValueField = (
  rows: AgentMonitoringChartRow[],
  valueKey?: string,
) => {
  if (valueKey)
    return valueKey

  return Object.keys(rows[0] ?? {}).find(name => name.includes('count')) ?? 'count'
}

/**
 * @public
 */
// TODO: Remove this marker after summary values are wired to monitoring cards.
export const getSummaryValue = ({
  chartType,
  rows,
  valueKey,
  isAvg,
  unit = '',
}: {
  chartType: AgentMonitoringChartType
  rows: AgentMonitoringChartRow[]
  valueKey: string
  isAvg?: boolean
  unit?: string
}) => {
  const value = sumValues(rows, valueKey)
  const summary = isAvg ? value / (rows.length || 1) : value

  if (chartType === 'tokenUsage') {
    const formattedUsage = summary < 1000
      ? summary
      : `${formatNumber(Math.round(summary / 1000))}k`

    return `${formattedUsage}`
  }

  return `${summary.toLocaleString()} ${unit}`.trim()
}

export const getTokenSummary = (rows: AgentMonitoringChartRow[]) => {
  const totalPrice = rows.reduce((sum, row) => sum + Number.parseFloat(String(row.total_price ?? '0')), 0)

  return totalPrice.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
  })
}

export const buildChartOptions = ({
  rows,
  chartType,
  valueKey,
  yMax,
}: {
  rows: AgentMonitoringChartRow[]
  chartType: AgentMonitoringChartType
  valueKey: string
  yMax?: number
}): EChartsOption => {
  const xData = rows.map(({ date }) => date)
  const chartColors = getChartColors(chartType)
  const markLineSeedData = getMarkLineSeedData(rows.length)

  return {
    dataset: {
      dimensions: ['date', valueKey],
      source: rows,
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
        color: '#9CA3AF',
        hideOverlap: true,
        overflow: 'break',
        formatter(value) {
          return dayjs(value).format(axisDateFormat)
        },
      },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: {
        show: true,
        lineStyle: {
          color: '#F3F4F6',
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
          color: '#E5E7EB',
        },
        interval(_index, value) {
          return !!value
        },
      },
    }],
    yAxis: {
      max: yMax ?? 'dataMax',
      type: 'value',
      axisLabel: { color: '#9CA3AF', hideOverlap: true },
      splitLine: {
        lineStyle: {
          color: '#F3F4F6',
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
            return getTooltipContent(chartType, valueKey, params as { name: string, data?: AgentMonitoringChartRow })
          },
        },
      },
    ],
  }
}
