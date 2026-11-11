import type { EChartsOption } from 'echarts'
import type { MonitoringMetric, MonitoringRow } from './preview'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import dayjs from 'dayjs'
import ReactECharts from 'echarts-for-react/esm/core'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { echarts } from '@/app/components/base/line-chart/echarts'
import { useResolvedTheme } from '@/features/theme/hooks'
import { formatToLocalTime } from '@/utils/format'

const hintKeys = {
  calls: 'external.monitoring.callsHint',
  reportedTokens: 'external.monitoring.reportedTokensHint',
  averageCallDuration: 'external.monitoring.averageCallDurationHint',
  tokenReportingCoverage: 'external.monitoring.tokenReportingCoverageHint',
} as const

const minimumMax: Record<MonitoringMetric, number> = {
  calls: 8,
  reportedTokens: 4000,
  averageCallDuration: 20,
  tokenReportingCoverage: 100,
}

export function MonitoringChart({
  metric,
  summary,
  detail,
  rows,
  empty,
}: {
  metric: MonitoringMetric
  summary: string
  detail?: string
  rows: MonitoringRow[]
  empty: boolean
}) {
  const { t } = useTranslation(['agentRoster', 'agentV2'])
  const locale = useLocale()
  const theme = useResolvedTheme()
  const titleId = useId()
  const title = t(($) => $[`external.monitoring.${metric}`])
  const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  const formatValue = (value: number) => {
    const formatted = numberFormat.format(value)
    if (metric === 'tokenReportingCoverage') return `${formatted}%`
    if (metric === 'averageCallDuration') return `${formatted} s`
    return formatted
  }
  // ECharts needs resolved color values for its renderer and gradient calculation.
  const dark = theme === 'dark'
  const color = dark ? '#3072ff' : '#0033ff'
  const yMax = Math.max(minimumMax[metric], ...rows.map((row) => row[metric]))
  const options: EChartsOption = {
    animation: false,
    grid: { top: 28, right: 12, bottom: 24, left: 0, containLabel: true },
    tooltip: {
      trigger: 'axis',
      confine: true,
      valueFormatter: (value) => formatValue(Number(value)),
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: rows.map((row) => formatToLocalTime(dayjs(row.date), locale, 'MMM D')),
      axisLabel: {
        color: dark ? 'rgba(200,206,218,0.4)' : 'rgba(16,24,40,0.3)',
        fontSize: 12,
        hideOverlap: true,
        alignMinLabel: 'left',
        alignMaxLabel: 'right',
      },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: yMax,
      interval: yMax / 4,
      axisLabel: {
        color: dark ? 'rgba(200,206,218,0.4)' : 'rgba(16,24,40,0.3)',
        fontSize: 12,
        formatter: (value: number) => formatValue(value),
      },
      splitLine: {
        lineStyle: {
          type: 'dashed',
          color: dark ? 'rgba(200,206,218,0.08)' : 'rgba(16,24,40,0.04)',
        },
      },
    },
    series: [
      {
        name: title,
        type: 'line',
        data: rows.map((row) => row[metric]),
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color, width: 2 },
        itemStyle: { color, borderColor: dark ? '#18181b' : '#fff', borderWidth: 1.5 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: dark ? 'rgba(8,90,252,0.2)' : 'rgba(0,51,255,0.14)' },
              { offset: 1, color: dark ? 'rgba(8,90,252,0.04)' : 'rgba(0,51,255,0.04)' },
            ],
          },
        },
      },
    ],
  }

  return (
    <article
      aria-labelledby={titleId}
      className="min-w-0 overflow-hidden rounded-xl bg-components-chart-bg shadow-xs"
    >
      <div className="flex items-center gap-1 px-6 pt-6 pb-1">
        <h2 id={titleId} className="system-sm-semibold-uppercase text-text-secondary">
          {title}
        </h2>
        <Infotip>
          <InfotipTrigger aria-labelledby={titleId} />
          <InfotipContent aria-labelledby={titleId}>{t(($) => $[hintKeys[metric]])}</InfotipContent>
        </Infotip>
      </div>
      <div className="flex flex-wrap items-baseline gap-1.5 px-6 py-1">
        <span className="text-xl leading-6 font-semibold text-text-primary">{summary}</span>
        {detail && <span className="system-sm-medium text-text-tertiary">{detail}</span>}
      </div>
      <div className="h-60 px-6 pb-4">
        {empty ? (
          <div className="flex h-full items-center justify-center system-xs-regular text-text-tertiary">
            {t(($) => $['external.monitoring.noCalls'])}
          </div>
        ) : (
          <ReactECharts
            aria-hidden="true"
            echarts={echarts}
            option={options}
            opts={{ renderer: 'svg' }}
            style={{ height: '100%', width: '100%' }}
          />
        )}
      </div>
      {!empty && (
        <table aria-labelledby={titleId} className="sr-only">
          <thead>
            <tr>
              <th scope="col">
                {t(($) => $['agentDetail.monitoring.table.date'], { ns: 'agentV2' })}
              </th>
              <th scope="col">{title}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.date}>
                <th scope="row">
                  <time dateTime={row.date}>
                    {formatToLocalTime(dayjs(row.date), locale, 'MMM D, YYYY')}
                  </time>
                </th>
                <td>{formatValue(row[metric])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  )
}
