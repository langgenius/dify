'use client'

import type { AgentMonitoringChartRow, AgentMonitoringChartType } from './chart-utils'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import ReactECharts from 'echarts-for-react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
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
  const { t } = useTranslation('agentV2')
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
    <article className="flex h-[316px] w-full min-w-0 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg">
      <div className="flex h-11 shrink-0 items-center px-6 pt-6 pb-1">
        <div className="flex min-w-0 items-center gap-1">
          <h3 className="truncate system-md-semibold text-text-secondary">
            {t(($) => $[titleKey])}
          </h3>
          <Infotip aria-label={t(($) => $[explanationKey])}>{t(($) => $[explanationKey])}</Infotip>
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
        <ReactECharts option={options} style={{ height: 240, width: '100%' }} />
      </div>
    </article>
  )
}
