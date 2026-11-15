'use client'

import type { AgentMonitoringPeriod } from '../../agent-detail/monitoring/time-range-picker'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { useDocLink } from '@/context/i18n'
import { currentWorkspaceAtom, currentWorkspaceLoadingAtom } from '@/context/workspace-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import useDocumentTitle from '@/hooks/use-document-title'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { getHttpErrorStatus } from '@/service/http-error'
import { AgentMonitoringTimeRangePicker } from '../../agent-detail/monitoring/time-range-picker'
import { ExternalAgentRequestState } from '../request-state'
import { MonitoringAppsFilter } from './apps-filter'
import { MonitoringChart } from './chart'
import { getDefaultMonitoringPeriod, getMonitoringRows, getMonitoringWindow } from './data'
import { ExternalAgentTracingConfiguration } from './tracing-configuration'

function MonitoringSession({ agentId, timezone }: { agentId: string; timezone: string }) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const router = useRouter()
  const locale = useLocale()
  const docLink = useDocLink()
  const [period, setPeriod] = useState<AgentMonitoringPeriod>(() => getDefaultMonitoringPeriod())
  const [appId, setAppId] = useState('all')
  const monitoring = useQuery(
    consoleQuery.externalAgents.byAgentId.monitoring.get.queryOptions({
      input: {
        params: { agent_id: agentId },
        query: {
          ...getMonitoringWindow(period, timezone),
          ...(appId !== 'all' ? { app_id: appId } : {}),
        },
      },
      retry: false,
    }),
  )
  const status = getHttpErrorStatus(monitoring.error)
  const missing = status === 404 || status === 410
  useEffect(() => {
    if (missing) router.replace('/agents?agent_type=external')
  }, [missing, router])
  const formatNumber = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  const data = monitoring.isError ? undefined : monitoring.data
  const summary = data?.summary
  const rows = data ? getMonitoringRows(data) : []
  const value = (number: number | null | undefined) =>
    number === null || number === undefined ? '—' : formatNumber.format(number)
  const empty = summary?.calls === 0

  if (missing) return null

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
            {data?.apps !== undefined && data.apps !== null && (
              <MonitoringAppsFilter apps={data.apps} value={appId} onChange={setAppId} />
            )}
            <span className="system-xs-regular text-text-tertiary">{timezone}</span>
          </div>
          <ExternalAgentTracingConfiguration agentId={agentId} />
        </div>
        {monitoring.isPending ? (
          <ExternalAgentRequestState pending />
        ) : (
          summary && (
            <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
              <MonitoringChart
                metric="calls"
                summary={value(summary.calls)}
                rows={rows}
                empty={empty}
              />
              <MonitoringChart
                metric="reportedTokens"
                summary={value(summary.reported_tokens)}
                rows={rows}
                empty={empty}
              />
              <MonitoringChart
                metric="averageCallDuration"
                summary={
                  summary.average_call_duration === null
                    ? '—'
                    : `${value(summary.average_call_duration)} s`
                }
                rows={rows}
                empty={empty}
              />
              <MonitoringChart
                metric="tokenReportingCoverage"
                summary={
                  summary.token_reporting_coverage === null
                    ? '—'
                    : `${value(summary.token_reporting_coverage * 100)}%`
                }
                detail={
                  summary.token_reporting_denominator === 0
                    ? undefined
                    : t(($) => $['external.monitoring.coverageDetail'], {
                        reported: summary.token_reporting_numerator,
                        total: summary.token_reporting_denominator,
                      })
                }
                rows={rows}
                empty={empty}
              />
            </div>
          )
        )}
      </div>
    </div>
  )
}

export function ExternalAgentMonitoringPage({ agentId }: { agentId: string }) {
  const { t } = useTranslation(['agentRoster'])
  const profile = useQuery(userProfileQueryOptions())
  const workspace = useAtomValue(currentWorkspaceAtom)
  const workspaceLoading = useAtomValue(currentWorkspaceLoadingAtom)
  useDocumentTitle(t(($) => $['external.overview.monitoring']))
  if (profile.isPending || profile.isError || workspaceLoading)
    return (
      <ExternalAgentRequestState
        pending={profile.isPending || workspaceLoading}
        error={profile.error}
      />
    )
  const timezone = profile.data.profile.timezone ?? 'UTC'
  return (
    <MonitoringSession
      key={`${workspace.id}:${agentId}:${timezone}`}
      agentId={agentId}
      timezone={timezone}
    />
  )
}
