import type { AgentMonitoringChartRow } from './chart-utils'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import { getDefaultChartData } from './chart-utils'

type AgentMonitoringMetric = {
  id: string
  titleKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.monitoring.'>
  explanationKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.monitoring.'>
  chartType: 'conversations' | 'endUsers' | 'tokenUsage'
  rows: AgentMonitoringChartRow[]
  summaryValue: string
  valueKey?: string
  unitKey?: I18nKeysWithPrefix<'agentV2', 'agentDetail.monitoring.'>
  yMax: number
}

export const getAgentMonitoringMetrics = ({
  start,
  end,
}: {
  start: string
  end: string
}): AgentMonitoringMetric[] => [
  {
    id: 'total-messages',
    titleKey: 'agentDetail.monitoring.metrics.totalMessages.title',
    explanationKey: 'agentDetail.monitoring.metrics.totalMessages.explanation',
    chartType: 'conversations',
    rows: getDefaultChartData({ start, end, key: 'messages' }),
    summaryValue: '250k',
    valueKey: 'messages',
    yMax: 500,
  },
  {
    id: 'active-users',
    titleKey: 'agentDetail.monitoring.metrics.activeUsers.title',
    explanationKey: 'agentDetail.monitoring.metrics.activeUsers.explanation',
    chartType: 'endUsers',
    rows: getDefaultChartData({ start, end, key: 'users' }),
    summaryValue: '20k',
    valueKey: 'users',
    yMax: 500,
  },
  {
    id: 'avg-session-interactions',
    titleKey: 'agentDetail.monitoring.metrics.avgSessionInteractions.title',
    explanationKey: 'agentDetail.monitoring.metrics.avgSessionInteractions.explanation',
    chartType: 'conversations',
    rows: getDefaultChartData({ start, end, key: 'interactions' }),
    summaryValue: '20k',
    valueKey: 'interactions',
    yMax: 500,
  },
  {
    id: 'token-output-speed',
    titleKey: 'agentDetail.monitoring.metrics.tokenOutputSpeed.title',
    explanationKey: 'agentDetail.monitoring.metrics.tokenOutputSpeed.explanation',
    chartType: 'conversations',
    rows: getDefaultChartData({ start, end, key: 'tps' }),
    summaryValue: '1087',
    valueKey: 'tps',
    unitKey: 'agentDetail.monitoring.units.tokenPerSecond',
    yMax: 100,
  },
  {
    id: 'user-satisfaction-rate',
    titleKey: 'agentDetail.monitoring.metrics.userSatisfactionRate.title',
    explanationKey: 'agentDetail.monitoring.metrics.userSatisfactionRate.explanation',
    chartType: 'endUsers',
    rows: getDefaultChartData({ start, end, key: 'rate' }),
    summaryValue: '0',
    valueKey: 'rate',
    yMax: 1000,
  },
  {
    id: 'token-usage',
    titleKey: 'agentDetail.monitoring.metrics.tokenUsage.title',
    explanationKey: 'agentDetail.monitoring.metrics.tokenUsage.explanation',
    chartType: 'tokenUsage',
    rows: getDefaultChartData({ start, end, key: 'tokens' }),
    summaryValue: '1087',
    valueKey: 'tokens',
    yMax: 100,
  },
]
