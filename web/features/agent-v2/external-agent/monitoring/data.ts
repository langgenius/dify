import type { ExternalMonitoringResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import type { AgentMonitoringPeriod } from '../../agent-detail/monitoring/time-range-picker'
import dayjs from 'dayjs'
import timezonePlugin from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)
dayjs.extend(timezonePlugin)

export type MonitoringMetric =
  | 'calls'
  | 'reportedTokens'
  | 'averageCallDuration'
  | 'tokenReportingCoverage'
export type MonitoringRow = { date: string } & Record<MonitoringMetric, number | null>
export type MonitoringApps = NonNullable<ExternalMonitoringResponse['apps']>

export function getDefaultMonitoringPeriod(): AgentMonitoringPeriod {
  // Keep the existing date picker's browser-calendar selection; the request
  // boundary below resolves those selected dates in the account's timezone.
  const today = dayjs()
  return {
    name: 'today',
    query: {
      start: today.startOf('day').format('YYYY-MM-DD HH:mm'),
      end: today.endOf('day').format('YYYY-MM-DD HH:mm'),
    },
  }
}

export function getMonitoringWindow(period: AgentMonitoringPeriod, timezone: string) {
  const first = period.query.start.slice(0, 10)
  const next = dayjs(period.query.end.slice(0, 10)).add(1, 'day').format('YYYY-MM-DD')
  return {
    start: dayjs.tz(`${first} 00:00`, timezone).toISOString(),
    end: dayjs.tz(`${next} 00:00`, timezone).toISOString(),
    timezone,
  }
}

export function getMonitoringRows(response: ExternalMonitoringResponse): MonitoringRow[] {
  return response.days.map(({ date, metrics }) => ({
    date,
    calls: metrics.calls,
    reportedTokens: metrics.reported_tokens,
    averageCallDuration: metrics.average_call_duration,
    tokenReportingCoverage:
      metrics.token_reporting_coverage === null ? null : metrics.token_reporting_coverage * 100,
  }))
}
