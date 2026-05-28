import type { AgentMonitoringChartRow } from './chart-utils'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import { getDefaultChartData } from './chart-utils'

type AgentMonitoringMetric = {
  id: string
  titleKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.monitoring.'>
  explanationKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.monitoring.'>
  chartType: 'conversations' | 'endUsers' | 'tokenUsage'
  rows: AgentMonitoringChartRow[]
  valueKey?: string
  isAvg?: boolean
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
    id: 'total-conversations',
    titleKey: 'agentDetail.monitoring.metrics.totalConversations.title',
    explanationKey: 'agentDetail.monitoring.metrics.totalConversations.explanation',
    chartType: 'conversations',
    rows: getDefaultChartData({ start, end }),
    yMax: 500,
  },
  {
    id: 'active-users',
    titleKey: 'agentDetail.monitoring.metrics.activeUsers.title',
    explanationKey: 'agentDetail.monitoring.metrics.activeUsers.explanation',
    chartType: 'endUsers',
    rows: getDefaultChartData({ start, end }),
    yMax: 500,
  },
  {
    id: 'avg-session-interactions',
    titleKey: 'agentDetail.monitoring.metrics.avgSessionInteractions.title',
    explanationKey: 'agentDetail.monitoring.metrics.avgSessionInteractions.explanation',
    chartType: 'conversations',
    rows: getDefaultChartData({ start, end, key: 'interactions' }),
    valueKey: 'interactions',
    isAvg: true,
    yMax: 500,
  },
  {
    id: 'token-output-speed',
    titleKey: 'agentDetail.monitoring.metrics.tokenOutputSpeed.title',
    explanationKey: 'agentDetail.monitoring.metrics.tokenOutputSpeed.explanation',
    chartType: 'conversations',
    rows: getDefaultChartData({ start, end, key: 'tps' }),
    valueKey: 'tps',
    isAvg: true,
    unitKey: 'agentDetail.monitoring.units.tokenPerSecond',
    yMax: 100,
  },
  {
    id: 'user-satisfaction-rate',
    titleKey: 'agentDetail.monitoring.metrics.userSatisfactionRate.title',
    explanationKey: 'agentDetail.monitoring.metrics.userSatisfactionRate.explanation',
    chartType: 'endUsers',
    rows: getDefaultChartData({ start, end, key: 'rate' }),
    valueKey: 'rate',
    isAvg: true,
    yMax: 1000,
  },
  {
    id: 'token-usage',
    titleKey: 'agentDetail.monitoring.metrics.tokenUsage.title',
    explanationKey: 'agentDetail.monitoring.metrics.tokenUsage.explanation',
    chartType: 'tokenUsage',
    rows: getDefaultChartData({ start, end }),
    yMax: 100,
  },
  {
    id: 'total-messages',
    titleKey: 'agentDetail.monitoring.metrics.totalMessages.title',
    explanationKey: 'agentDetail.monitoring.metrics.totalMessages.explanation',
    chartType: 'conversations',
    rows: getDefaultChartData({ start, end }),
    yMax: 500,
  },
]
