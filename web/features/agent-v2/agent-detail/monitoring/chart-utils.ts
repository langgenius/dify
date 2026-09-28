import type { EChartsOption } from 'echarts'
import dayjs from 'dayjs'

export type AgentMonitoringChartType = 'conversations' | 'endUsers' | 'tokenUsage'

export type AgentMonitoringChartRow = {
  date: string
  total_price?: number | string
} & Record<string, number | string | undefined>

type ColorType = 'green' | 'orange' | 'blue'

type AgentMonitoringChartConfig = {
  colorType: ColorType
}

const colorTypeMap: Record<ColorType, { lineColor: string; bgColor: [string, string] }> = {
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

const chartTypeConfig: Record<AgentMonitoringChartType, AgentMonitoringChartConfig> = {
  conversations: {
    colorType: 'green',
  },
  endUsers: {
    colorType: 'orange',
  },
  tokenUsage: {
    colorType: 'blue',
  },
}

const commonColorMap = {
  label: '#9CA3AF',
  splitLineLight: '#F3F4F6',
  splitLineDark: '#E5E7EB',
}

const axisDateFormat = 'MMM'

const getChartColors = (chartType: AgentMonitoringChartType) =>
  colorTypeMap[chartTypeConfig[chartType].colorType]

const getMarkLineSeedData = (statisticsLength: number) => {
  const markLineLength = statisticsLength >= 2 ? statisticsLength - 2 : statisticsLength

  return ['', ...Array.from({ length: markLineLength }, () => '1'), '']
}

const getTooltipContent = (
  chartType: AgentMonitoringChartType,
  yField: string,
  params: { name: string; data?: AgentMonitoringChartRow },
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

export const getChartValueField = (rows: AgentMonitoringChartRow[], valueKey?: string) => {
  if (valueKey) return valueKey

  return Object.keys(rows[0] ?? {}).find((name) => name.includes('count')) ?? 'count'
}

export const getTokenSummary = (rows: AgentMonitoringChartRow[]) => {
  const totalPrice = rows.reduce(
    (sum, row) => sum + Number.parseFloat(String(row.total_price ?? '0')),
    0,
  )

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
    xAxis: [
      {
        type: 'category',
        boundaryGap: false,
        axisLabel: {
          color: commonColorMap.label,
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
            color: commonColorMap.splitLineLight,
            width: 1,
            type: [10, 10],
          },
          interval(index) {
            return index === 0 || index === xData.length - 1
          },
        },
      },
      {
        position: 'bottom',
        boundaryGap: false,
        data: markLineSeedData,
        axisLabel: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: {
          show: true,
          lineStyle: {
            color: commonColorMap.splitLineDark,
          },
          interval(_index, value) {
            return !!value
          },
        },
      },
    ],
    yAxis: {
      max: yMax ?? 'dataMax',
      type: 'value',
      axisLabel: { color: commonColorMap.label, hideOverlap: true },
      splitLine: {
        lineStyle: {
          color: commonColorMap.splitLineLight,
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
            colorStops: [
              {
                offset: 0,
                color: chartColors.bgColor[0],
              },
              {
                offset: 1,
                color: chartColors.bgColor[1],
              },
            ],
            global: false,
          },
        },
        tooltip: {
          padding: [8, 12, 8, 12],
          formatter(params) {
            return getTooltipContent(
              chartType,
              valueKey,
              params as { name: string; data?: AgentMonitoringChartRow },
            )
          },
        },
      },
    ],
  }
}
