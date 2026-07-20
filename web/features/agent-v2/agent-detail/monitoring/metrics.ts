import type { AgentStatisticSummaryEnvelopeResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentMonitoringChartRow, AgentMonitoringChartType } from './chart-utils'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import dayjs from 'dayjs'
import { formatNumberAbbreviated } from '@/utils/format'

export type AgentMonitoringMetric = {
  id: string
  titleKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.monitoring.'>
  explanationKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.monitoring.'>
  chartType: AgentMonitoringChartType
  rows: AgentMonitoringChartRow[]
  summaryValue: string
  valueKey: string
  unitKey?: I18nKeysWithPrefix<'agentV2', 'agentDetail.monitoring.'>
  yMaxWhenEmpty: number
}

type AgentMonitoringPeriodQuery = {
  start: string
  end: string
}

type ChartRowValue = number | string | undefined

const chartDateFormat = 'YYYY-MM-DD'

const toMetricNumber = (value: number) => {
  if (Number.isInteger(value)) return value.toLocaleString()

  return value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })
}

const getChartRowValue = (row: AgentMonitoringChartRow | undefined, key: string): ChartRowValue => {
  if (!row) return 0

  return row[key] ?? 0
}

const fillChartRows = <T extends { date: string }>(
  rows: T[] | undefined,
  periodQuery: AgentMonitoringPeriodQuery,
  valueKey: string,
) => {
  const rowsByDate = new Map(
    (rows ?? []).map((row) => [
      dayjs(row.date).format(chartDateFormat),
      row as AgentMonitoringChartRow,
    ]),
  )
  const start = dayjs(periodQuery.start).startOf('day')
  const end = dayjs(periodQuery.end).startOf('day')
  const days = Math.max(end.diff(start, 'day'), 0)

  return Array.from({ length: days + 1 }, (_, index) => {
    const date = start.add(index, 'day').format(chartDateFormat)
    const row = rowsByDate.get(date)

    return {
      ...row,
      date,
      [valueKey]: getChartRowValue(row, valueKey),
      total_price: row?.total_price ?? '0',
    }
  }) as AgentMonitoringChartRow[]
}

export const getAgentMonitoringMetrics = (
  data?: AgentStatisticSummaryEnvelopeResponse,
  periodQuery?: AgentMonitoringPeriodQuery,
): AgentMonitoringMetric[] => {
  const summary = data?.summary
  const charts = data?.charts
  const toChartRows = <T extends { date: string }>(rows: T[] | undefined, valueKey: string) => {
    if (!periodQuery) return (rows ?? []) as AgentMonitoringChartRow[]

    return fillChartRows(rows, periodQuery, valueKey)
  }

  return [
    {
      id: 'total-messages',
      titleKey: 'agentDetail.monitoring.metrics.totalMessages.title',
      explanationKey: 'agentDetail.monitoring.metrics.totalMessages.explanation',
      chartType: 'conversations',
      rows: toChartRows(charts?.daily_messages, 'message_count'),
      summaryValue: formatNumberAbbreviated(summary?.total_messages ?? 0),
      valueKey: 'message_count',
      yMaxWhenEmpty: 500,
    },
    {
      id: 'active-users',
      titleKey: 'agentDetail.monitoring.metrics.activeUsers.title',
      explanationKey: 'agentDetail.monitoring.metrics.activeUsers.explanation',
      chartType: 'endUsers',
      rows: toChartRows(charts?.daily_end_users, 'terminal_count'),
      summaryValue: formatNumberAbbreviated(summary?.total_end_users ?? 0),
      valueKey: 'terminal_count',
      yMaxWhenEmpty: 500,
    },
    {
      id: 'avg-session-interactions',
      titleKey: 'agentDetail.monitoring.metrics.avgSessionInteractions.title',
      explanationKey: 'agentDetail.monitoring.metrics.avgSessionInteractions.explanation',
      chartType: 'conversations',
      rows: toChartRows(charts?.average_session_interactions, 'interactions'),
      summaryValue: toMetricNumber(summary?.average_session_interactions ?? 0),
      valueKey: 'interactions',
      yMaxWhenEmpty: 500,
    },
    {
      id: 'token-output-speed',
      titleKey: 'agentDetail.monitoring.metrics.tokenOutputSpeed.title',
      explanationKey: 'agentDetail.monitoring.metrics.tokenOutputSpeed.explanation',
      chartType: 'conversations',
      rows: toChartRows(charts?.tokens_per_second, 'tps'),
      summaryValue: toMetricNumber(summary?.tokens_per_second ?? 0),
      valueKey: 'tps',
      unitKey: 'agentDetail.monitoring.units.tokenPerSecond',
      yMaxWhenEmpty: 100,
    },
    {
      id: 'user-satisfaction-rate',
      titleKey: 'agentDetail.monitoring.metrics.userSatisfactionRate.title',
      explanationKey: 'agentDetail.monitoring.metrics.userSatisfactionRate.explanation',
      chartType: 'endUsers',
      rows: toChartRows(charts?.user_satisfaction_rate, 'rate'),
      summaryValue: `${toMetricNumber(summary?.user_satisfaction_rate ?? 0)}%`,
      valueKey: 'rate',
      yMaxWhenEmpty: 1000,
    },
    {
      id: 'token-usage',
      titleKey: 'agentDetail.monitoring.metrics.tokenUsage.title',
      explanationKey: 'agentDetail.monitoring.metrics.tokenUsage.explanation',
      chartType: 'tokenUsage',
      rows: toChartRows(charts?.token_usage, 'token_count'),
      summaryValue: formatNumberAbbreviated(summary?.total_tokens ?? 0),
      valueKey: 'token_count',
      yMaxWhenEmpty: 100,
    },
  ]
}
