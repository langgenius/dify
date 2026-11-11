'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { useDocLink } from '@/context/i18n'
import useDocumentTitle from '@/hooks/use-document-title'
import { AgentMonitoringTimeRangePicker } from '../../agent-detail/monitoring/time-range-picker'
import { useExternalAgentPreview } from '../state'
import { MonitoringAppsFilter } from './apps-filter'
import { MonitoringChart } from './chart'
import {
  createMonitoringPreview,
  getDefaultMonitoringPeriod,
  getMonitoringMetrics,
} from './preview'
import { ExternalAgentTracingConfiguration } from './tracing-configuration'

export function ExternalAgentMonitoringPage({ agentId }: { agentId: string }) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const locale = useLocale()
  const docLink = useDocLink()
  const { preview } = useExternalAgentPreview(agentId)
  const [period, setPeriod] = useState(getDefaultMonitoringPeriod)
  const [appId, setAppId] = useState('all')
  const [calls] = useState(() => createMonitoringPreview(preview.agent.apps))
  const { summary, rows } = getMonitoringMetrics(calls, period, appId)
  const empty = summary.calls === 0
  const formatNumber = new Intl.NumberFormat(locale)
  useDocumentTitle(`${preview.agent.name} - ${t(($) => $['external.overview.monitoring'])}`)

  return (
    <div className="my-1 me-1 flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto rounded-lg bg-linear-to-b from-background-gradient-bg-fill-chat-bg-1 to-background-gradient-bg-fill-chat-bg-2">
      <header className="px-6 py-4">
        <h1 className="system-xl-semibold text-text-primary">
          {t(($) => $['external.overview.monitoring'])}
        </h1>
        <p className="mt-1 system-sm-regular text-text-tertiary">
          {t(($) => $['external.monitoring.description'])}{' '}
          <a
            href={docLink('/use-dify/monitor/analysis')}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 rounded-sm text-text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid"
          >
            {t(($) => $['operation.learnMore'], { ns: 'common' })}
            <span aria-hidden className="i-ri-arrow-right-up-line size-3" />
          </a>
        </p>
      </header>
      <div className="flex flex-col gap-8 px-6 pt-6 pb-12">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <AgentMonitoringTimeRangePicker value={period} onChange={setPeriod} />
            <MonitoringAppsFilter apps={preview.agent.apps} value={appId} onChange={setAppId} />
          </div>
          <ExternalAgentTracingConfiguration agentId={agentId} />
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
          <MonitoringChart
            metric="calls"
            summary={formatNumber.format(summary.calls)}
            rows={rows}
            empty={empty}
          />
          <MonitoringChart
            metric="reportedTokens"
            summary={empty ? '—' : formatNumber.format(summary.reportedTokens)}
            rows={rows}
            empty={empty}
          />
          <MonitoringChart
            metric="averageCallDuration"
            summary={
              empty
                ? '—'
                : `${summary.averageCallDuration.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`
            }
            rows={rows}
            empty={empty}
          />
          <MonitoringChart
            metric="tokenReportingCoverage"
            summary={empty ? '—' : `${Math.round(summary.tokenReportingCoverage)}%`}
            detail={
              empty
                ? undefined
                : t(($) => $['external.monitoring.coverageDetail'], {
                    reported: summary.reportedCalls,
                    total: summary.calls,
                  })
            }
            rows={rows}
            empty={empty}
          />
        </div>
      </div>
    </div>
  )
}
