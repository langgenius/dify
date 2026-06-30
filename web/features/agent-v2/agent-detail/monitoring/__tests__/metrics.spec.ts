import type { AgentStatisticSummaryEnvelopeResponse } from '@dify/contracts/api/console/agent/types.gen'
import { getAgentMonitoringMetrics } from '../metrics'

const statisticsSummary: AgentStatisticSummaryEnvelopeResponse = {
  source: 'all',
  summary: {
    average_response_time: 1250,
    average_session_interactions: 1.5,
    currency: 'USD',
    tokens_per_second: 4,
    total_conversations: 2,
    total_end_users: 3,
    total_messages: 1250,
    total_price: '0.005',
    total_tokens: 2500,
    user_satisfaction_rate: 66.67,
  },
  charts: {
    average_response_time: [
      { date: '2026-06-16', latency: 1250 },
    ],
    average_session_interactions: [
      { date: '2026-06-16', interactions: 1.5 },
    ],
    daily_conversations: [
      { date: '2026-06-16', conversation_count: 2 },
    ],
    daily_end_users: [
      { date: '2026-06-16', terminal_count: 3 },
    ],
    daily_messages: [
      { date: '2026-06-16', message_count: 1250 },
    ],
    token_usage: [
      { date: '2026-06-16', token_count: 2500, total_price: '0.005', currency: 'USD' },
    ],
    tokens_per_second: [
      { date: '2026-06-16', tps: 4 },
    ],
    user_satisfaction_rate: [
      { date: '2026-06-16', rate: 66.67 },
    ],
  },
}

describe('getAgentMonitoringMetrics', () => {
  it('should map statistics summary response into monitoring chart metrics', () => {
    const metrics = getAgentMonitoringMetrics(statisticsSummary)

    expect(metrics).toHaveLength(6)
    expect(metrics.map(metric => metric.id)).toEqual([
      'total-messages',
      'active-users',
      'avg-session-interactions',
      'token-output-speed',
      'user-satisfaction-rate',
      'token-usage',
    ])
    expect(metrics[0]).toEqual(expect.objectContaining({
      summaryValue: '1.3k',
      valueKey: 'message_count',
      rows: statisticsSummary.charts.daily_messages,
    }))
    expect(metrics[2]).toEqual(expect.objectContaining({
      summaryValue: '1.5',
      valueKey: 'interactions',
    }))
    expect(metrics[4]).toEqual(expect.objectContaining({
      summaryValue: '66.67%',
      valueKey: 'rate',
      yMaxWhenEmpty: 1000,
    }))
    expect(metrics[5]).toEqual(expect.objectContaining({
      summaryValue: '2.5k',
      valueKey: 'token_count',
      rows: statisticsSummary.charts.token_usage,
    }))
  })

  it('should return zero-valued metrics when statistics data is not loaded yet', () => {
    const metrics = getAgentMonitoringMetrics()

    expect(metrics).toHaveLength(6)
    expect(metrics.every(metric => metric.rows.length === 0)).toBe(true)
    expect(metrics.map(metric => metric.summaryValue)).toEqual(['0', '0', '0', '0', '0%', '0'])
  })

  it('should fill missing daily chart buckets within the selected period', () => {
    const metrics = getAgentMonitoringMetrics(statisticsSummary, {
      start: '2026-06-15 00:00',
      end: '2026-06-17 23:59',
    })
    const totalMessagesMetric = metrics[0]
    const tokenUsageMetric = metrics[5]

    expect(totalMessagesMetric).toBeDefined()
    expect(tokenUsageMetric).toBeDefined()

    expect(totalMessagesMetric?.rows).toEqual([
      { date: '2026-06-15', message_count: 0, total_price: '0' },
      { date: '2026-06-16', message_count: 1250, total_price: '0' },
      { date: '2026-06-17', message_count: 0, total_price: '0' },
    ])
    expect(tokenUsageMetric?.rows).toEqual([
      { date: '2026-06-15', token_count: 0, total_price: '0' },
      { date: '2026-06-16', token_count: 2500, total_price: '0.005', currency: 'USD' },
      { date: '2026-06-17', token_count: 0, total_price: '0' },
    ])
  })
})
