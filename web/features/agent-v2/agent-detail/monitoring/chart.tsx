'use client'

import type { AgentMonitoringChartRow, AgentMonitoringChartType } from './chart-utils'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import { Button } from '@langgenius/dify-ui/button'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import dayjs from 'dayjs'
import ReactECharts from 'echarts-for-react/esm/core'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { echarts } from '@/app/components/base/line-chart/echarts'
import { formatToLocalTime } from '@/utils/format'
import { buildChartOptions, getChartValueField, getTokenSummary } from './chart-utils'

type AgentMonitoringChartProps = {
  titleKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.monitoring.'>
  explanationKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.monitoring.'>
  summaryValue: string
  rows: AgentMonitoringChartRow[]
  chartType: AgentMonitoringChartType
  valueKey?: string
  unitKey?: I18nKeysWithPrefix<'agentV2', 'agentDetail.monitoring.'>
  yMaxWhenEmpty: number
}

const hasChartData = (rows: AgentMonitoringChartRow[], valueKey: string) => {
  return rows.some((row) => Number(row[valueKey] ?? 0) !== 0)
}

export function AgentMonitoringChart({
  titleKey,
  explanationKey,
  summaryValue,
  rows,
  chartType,
  valueKey,
  unitKey,
  yMaxWhenEmpty,
}: AgentMonitoringChartProps) {
  const titleId = useId()
  const tableId = useId()
  const [isDataVisible, setIsDataVisible] = useState(false)

  const { t } = useTranslation(['agentV2'])
  const locale = useLocale()
  const yField = getChartValueField(rows, valueKey)
  const tokenSummary = getTokenSummary(rows)
  const shouldUseEmptyYAxis = !hasChartData(rows, yField)
  const options = buildChartOptions({
    rows,
    chartType,
    valueKey: yField,
    yMax: shouldUseEmptyYAxis ? yMaxWhenEmpty : undefined,
  })
  const isEmptySummary = Number.parseFloat(summaryValue.replace(/,/g, '')) === 0

  return (
    <article className="flex min-h-79 w-full min-w-0 flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg">
      <div className="flex h-11 shrink-0 items-center px-6 pt-6 pb-1">
        <div className="flex min-w-0 items-center gap-1">
          <h3 id={titleId} className="truncate system-md-semibold text-text-secondary">
            {t(($) => $[titleKey])}
          </h3>
          <Infotip>
            <InfotipTrigger aria-labelledby={titleId} />
            <InfotipContent aria-labelledby={titleId}>{t(($) => $[explanationKey])}</InfotipContent>
          </Infotip>
        </div>
      </div>

      <div className="flex h-8 shrink-0 items-start gap-1 px-6 py-1">
        <div
          className={`truncate text-3xl leading-7 font-normal ${isEmptySummary ? 'text-text-quaternary' : 'text-text-primary'}`}
        >
          {summaryValue}
        </div>
        {chartType !== 'tokenUsage' && unitKey && (
          <div className="mt-0.5 truncate system-sm-regular text-text-secondary">
            {t(($) => $[unitKey])}
          </div>
        )}
        {chartType === 'tokenUsage' && (
          <div className="mt-0.5 truncate system-sm-regular text-text-secondary">
            {t(($) => $['agentDetail.monitoring.tokenUsageConsumed'])}{' '}
            <span className="text-util-colors-orange-orange-600">
              (~
              {tokenSummary})
            </span>
          </div>
        )}
      </div>

      <div className="h-60 px-6">
        <ReactECharts
          aria-hidden="true"
          echarts={echarts}
          option={options}
          style={{ height: 240, width: '100%' }}
        />
      </div>
      <div className="px-6 pb-4">
        <Button
          variant="ghost"
          size="small"
          aria-controls={tableId}
          aria-expanded={isDataVisible}
          onClick={() => setIsDataVisible((value) => !value)}
        >
          {isDataVisible
            ? t(($) => $['agentDetail.monitoring.table.hideData'])
            : t(($) => $['agentDetail.monitoring.table.viewData'])}
        </Button>
      </div>
      <div className={isDataVisible ? 'overflow-x-auto px-6 pb-6' : 'sr-only'}>
        <table
          id={tableId}
          aria-labelledby={titleId}
          className="w-full border-collapse text-left system-sm-regular"
        >
          <thead>
            <tr>
              <th scope="col">{t(($) => $['agentDetail.monitoring.table.date'])}</th>
              <th scope="col">{t(($) => $['agentDetail.monitoring.table.value'])}</th>
              {chartType === 'tokenUsage' && (
                <th scope="col">{t(($) => $['agentDetail.monitoring.table.estimatedCost'])}</th>
              )}
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
                <td>{row[yField] ?? 0}</td>
                {chartType === 'tokenUsage' && <td>${row.total_price ?? 0}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  )
}
