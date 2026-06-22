'use client'

import type { AgentMonitoringChartRow, AgentMonitoringChartType } from './chart-utils'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import ReactECharts from 'echarts-for-react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import {
  buildChartOptions,
  getChartValueField,
  getTokenSummary,
} from './chart-utils'

type AgentMonitoringChartProps = {
  titleKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.monitoring.'>
  explanationKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.monitoring.'>
  summaryValue: string
  rows: AgentMonitoringChartRow[]
  chartType: AgentMonitoringChartType
  valueKey?: string
  unitKey?: I18nKeysWithPrefix<'agentV2', 'agentDetail.monitoring.'>
  yMax?: number
}

export function AgentMonitoringChart({
  titleKey,
  explanationKey,
  summaryValue,
  rows,
  chartType,
  valueKey,
  unitKey,
  yMax,
}: AgentMonitoringChartProps) {
  const { t } = useTranslation('agentV2')
  const yField = getChartValueField(rows, valueKey)
  const tokenSummary = getTokenSummary(rows)
  const options = buildChartOptions({
    rows,
    chartType,
    valueKey: yField,
    yMax,
  })
  const isEmptySummary = summaryValue === '0' || summaryValue.startsWith('0 ')

  return (
    <article className="flex min-h-79 w-full min-w-0 flex-col rounded-xl border border-components-panel-border bg-components-chart-bg px-6 pt-6 pb-4 shadow-xs">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1">
          <h3 className="truncate system-xs-semibold-uppercase text-text-secondary">
            {t(titleKey)}
          </h3>
          <Infotip aria-label={t(explanationKey)}>
            {t(explanationKey)}
          </Infotip>
        </div>
      </div>

      <div className="mt-2 mb-4 flex min-w-0 items-baseline gap-1">
        <div className={`truncate text-2xl leading-8 font-semibold ${isEmptySummary ? 'text-text-quaternary' : 'text-text-primary'}`}>
          {summaryValue}
        </div>
        {chartType !== 'tokenUsage' && unitKey && (
          <div className="truncate system-sm-regular text-text-secondary">
            {t(unitKey)}
          </div>
        )}
        {chartType === 'tokenUsage' && (
          <div className="truncate system-sm-regular text-text-secondary">
            {t('agentDetail.monitoring.tokenUsageConsumed')}
            {' '}
            <span className="text-util-colors-orange-orange-600">
              (~
              {tokenSummary}
              )
            </span>
          </div>
        )}
      </div>

      <ReactECharts option={options} style={{ height: 240 }} />
    </article>
  )
}
