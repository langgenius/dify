import type { AgentMonitoringPeriod } from '../../agent-detail/monitoring/time-range-picker'
import type { ExternalAgentOverviewPreview } from '../preview'
import dayjs from 'dayjs'

type App = ExternalAgentOverviewPreview['agent']['apps'][number]

export type MonitoringCall = {
  appId: string
  date: string
  duration: number
  tokens?: number
}

export type MonitoringMetric =
  | 'calls'
  | 'reportedTokens'
  | 'averageCallDuration'
  | 'tokenReportingCoverage'
export type MonitoringRow = { date: string } & Record<MonitoringMetric, number>

export const getMonitoringAppId = (app: App) => app.id ?? app.name

export function getDefaultMonitoringPeriod(now = dayjs()): AgentMonitoringPeriod {
  return {
    name: 'today',
    query: {
      start: now.startOf('day').format('YYYY-MM-DD HH:mm'),
      end: now.endOf('day').format('YYYY-MM-DD HH:mm'),
    },
  }
}

// Temporary production-call examples for the UI phase, never sent to an API.
// The third app deliberately has no calls so its empty state can be previewed.
export function createMonitoringPreview(apps: readonly App[], now = dayjs()): MonitoringCall[] {
  if (apps.length === 0) return []

  let callIndex = 0
  let reportedIndex = 0
  const reportedByDay = [2, 2, 2, 4, 2, 4, 5]
  return [2, 2, 3, 5, 3, 4, 6]
    .flatMap((count, day) =>
      Array.from({ length: count }, (_, index) => {
        const app = apps[callIndex % Math.min(apps.length, 2)]
        const hasTokens = index < reportedByDay[day]!
        const call = {
          appId: app ? getMonitoringAppId(app) : '',
          date: now.subtract(6 - day, 'day').format('YYYY-MM-DD'),
          duration: 8 + (callIndex % 5),
          ...(hasTokens ? { tokens: reportedIndex === 20 ? 1000 : 650 } : {}),
        }
        callIndex += 1
        if (hasTokens) reportedIndex += 1
        return call
      }),
    )
    .filter((call) => call.appId)
}

function summarize(calls: MonitoringCall[]) {
  const reported = calls.filter((call) => call.tokens !== undefined)
  return {
    calls: calls.length,
    reportedTokens: reported.reduce((sum, call) => sum + call.tokens!, 0),
    averageCallDuration: calls.length
      ? calls.reduce((sum, call) => sum + call.duration, 0) / calls.length
      : 0,
    tokenReportingCoverage: calls.length ? (reported.length / calls.length) * 100 : 0,
    reportedCalls: reported.length,
  }
}

export function getMonitoringMetrics(
  calls: MonitoringCall[],
  period: AgentMonitoringPeriod,
  appId: string,
) {
  const start = dayjs(period.query.start).startOf('day')
  const end = dayjs(period.query.end).startOf('day')
  const selected = calls.filter((call) => {
    const date = dayjs(call.date)
    return (appId === 'all' || call.appId === appId) && !date.isBefore(start) && !date.isAfter(end)
  })
  const days = Math.max(0, end.diff(start, 'day') + 1)
  const rows: MonitoringRow[] = Array.from({ length: days }, (_, index) => {
    const date = start.add(index, 'day').format('YYYY-MM-DD')
    return { date, ...summarize(selected.filter((call) => call.date === date)) }
  })
  return { summary: summarize(selected), rows }
}
