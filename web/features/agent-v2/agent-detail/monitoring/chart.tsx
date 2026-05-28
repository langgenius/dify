'use client'

import type { AgentMonitoringChartRow, AgentMonitoringChartType } from './chart-utils'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import ReactECharts from 'echarts-for-react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import {
  buildChartOptions,
  getChartValueField,
  getSummaryValue,
  getTokenSummary,
} from './chart-utils'

type AgentMonitoringChartProps = {
  titleKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.monitoring.'>
  explanationKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.monitoring.'>
  periodName: string
  rows: AgentMonitoringChartRow[]
  chartType: AgentMonitoringChartType
  valueKey?: string
  isAvg?: boolean
  unitKey?: I18nKeysWithPrefix<'agentV2', 'agentDetail.monitoring.'>
  yMax?: number
}

export function AgentMonitoringChart({
  titleKey,
  explanationKey,
  periodName,
  rows,
  chartType,
  valueKey,
  isAvg,
  unitKey,
  yMax,
}: AgentMonitoringChartProps) {
  const { t } = useTranslation('agentV2')
  const yField = getChartValueField(rows, valueKey)
  const summaryValue = getSummaryValue({
    chartType,
    rows,
    valueKey: yField,
    isAvg,
    unit: unitKey ? t(unitKey) : undefined,
  })
  const tokenSummary = getTokenSummary(rows)
  const options = buildChartOptions({
    rows,
    chartType,
    valueKey: yField,
    yMax,
  })
  const isEmptySummary = summaryValue === '0' || summaryValue.startsWith('0 ')

  return (
    <article className="flex min-h-63 w-full min-w-0 flex-col rounded-xl border border-components-panel-border bg-components-chart-bg px-6 py-4 shadow-xs">
      <div className="mb-3 min-w-0">
        <div className="flex min-w-0 items-center gap-1">
          <h3 className="truncate system-md-semibold text-text-primary">
            {t(titleKey)}
          </h3>
          <Infotip aria-label={t(explanationKey)}>
            {t(explanationKey)}
          </Infotip>
        </div>
        <div className="mt-2 system-2xs-medium-uppercase text-text-tertiary">
          {periodName}
        </div>
      </div>

      <div className="mb-4">
        <div className={`truncate text-3xl leading-9 font-normal ${isEmptySummary ? 'text-text-quaternary' : 'text-text-primary'}`}>
          {summaryValue}
        </div>
        {chartType === 'tokenUsage' && (
          <div className="mt-2 system-2xs-semibold-uppercase text-text-secondary">
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

      <ReactECharts option={options} style={{ height: 160 }} />
    </article>
  )
}
