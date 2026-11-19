import type {
  AgentLogSourceListResponse,
  AgentStatisticSummaryEnvelopeResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentMonitoringPage } from '../page'

vi.mock('../tracing-configuration', () => ({ AgentTracingConfiguration: () => null }))

const mocks = vi.hoisted(() => ({
  statisticsQueryFn: vi.fn(),
  logSourcesQueryFn: vi.fn(),
}))

vi.mock('echarts-for-react/esm/core', () => ({
  default: () => <div data-testid="agent-monitoring-chart" />,
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'agent.byAgentId.logSources.get': mocks.logSourcesQueryFn,
      'agent.byAgentId.statistics.summary.get': mocks.statisticsQueryFn,
    }),
  }
})

const logSourcesResponse: AgentLogSourceListResponse = {
  data: [],
  groups: [
    {
      label: 'Webapp',
      type: 'webapp',
      sources: [
        {
          app_icon: '📙',
          app_icon_background: '#FFF4ED',
          app_icon_type: 'emoji',
          app_id: 'webapp-app-id',
          app_name: 'Book Translation',
          id: 'webapp:webapp-app-id',
          type: 'webapp',
        },
      ],
    },
  ],
}

const statisticsResponse: AgentStatisticSummaryEnvelopeResponse = {
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
    average_response_time: [{ date: '2026-06-22', latency: 1250 }],
    average_session_interactions: [{ date: '2026-06-22', interactions: 1.5 }],
    daily_conversations: [{ date: '2026-06-22', conversation_count: 2 }],
    daily_end_users: [{ date: '2026-06-22', terminal_count: 3 }],
    daily_messages: [{ date: '2026-06-22', message_count: 1250 }],
    token_usage: [{ date: '2026-06-22', token_count: 2500, total_price: '0.005', currency: 'USD' }],
    tokens_per_second: [{ date: '2026-06-22', tps: 4 }],
    user_satisfaction_rate: [{ date: '2026-06-22', rate: 66.67 }],
  },
}

const emptyStatisticsResponse: AgentStatisticSummaryEnvelopeResponse = {
  source: 'webapp:webapp-app-id',
  summary: {
    average_response_time: 0,
    average_session_interactions: 0,
    currency: 'USD',
    tokens_per_second: 0,
    total_conversations: 0,
    total_end_users: 0,
    total_messages: 0,
    total_price: '0',
    total_tokens: 0,
    user_satisfaction_rate: 0,
  },
  charts: {
    average_response_time: [],
    average_session_interactions: [],
    daily_conversations: [],
    daily_end_users: [],
    daily_messages: [],
    token_usage: [],
    tokens_per_second: [],
    user_satisfaction_rate: [],
  },
}

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <AgentMonitoringPage agentId="agent-1" />
    </QueryClientProvider>,
  )

  return queryClient
}

describe('AgentMonitoringPage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.statisticsQueryFn.mockResolvedValue(statisticsResponse)
    mocks.logSourcesQueryFn.mockResolvedValue(logSourcesResponse)
  })

  it('should request unfiltered statistics and render backend summary values', async () => {
    renderPage()

    expect(await screen.findByText('1.3k')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('1.5')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('66.67%')).toBeInTheDocument()
    expect(screen.getByText('2.5k')).toBeInTheDocument()

    expect(mocks.statisticsQueryFn).toHaveBeenCalledExactlyOnceWith({
      params: { agent_id: 'agent-1' },
      query: { start: expect.any(String), end: expect.any(String) },
    })
  })

  it('should send the selected backend source id through the source query param', async () => {
    const user = userEvent.setup()

    renderPage()

    await user.click(await screen.findByRole('combobox', { name: /metadata.sourceLabel/ }))
    await user.click(await screen.findByRole('option', { name: /Book Translation/ }))

    await waitFor(() => {
      expect(mocks.statisticsQueryFn).toHaveBeenLastCalledWith({
        params: { agent_id: 'agent-1' },
        query: expect.objectContaining({ source: 'webapp:webapp-app-id' }),
      })
    })

    const clearButton = screen.getByRole('button', { name: /operation.clear.*Book Translation/ })
    await user.click(clearButton)

    await waitFor(() => {
      expect(mocks.statisticsQueryFn).toHaveBeenLastCalledWith({
        params: { agent_id: 'agent-1' },
        query: { start: expect.any(String), end: expect.any(String) },
      })
    })
    expect(
      screen.getByRole('combobox', { name: /metadata.sourceLabel.*sources.all/ }),
    ).toBeInTheDocument()
  })

  it('should keep previous statistics visible while a source filter refetches', async () => {
    const user = userEvent.setup()
    let resolveNextStatistics: (value: AgentStatisticSummaryEnvelopeResponse) => void = () =>
      undefined
    const nextStatisticsPromise = new Promise<AgentStatisticSummaryEnvelopeResponse>((resolve) => {
      resolveNextStatistics = resolve
    })
    mocks.statisticsQueryFn
      .mockResolvedValueOnce(statisticsResponse)
      .mockReturnValueOnce(nextStatisticsPromise)

    renderPage()

    expect(await screen.findByText('1.3k')).toBeInTheDocument()

    await user.click(await screen.findByRole('combobox', { name: /metadata.sourceLabel/ }))
    await user.click(await screen.findByRole('option', { name: /Book Translation/ }))

    await waitFor(() => {
      expect(mocks.statisticsQueryFn).toHaveBeenLastCalledWith({
        params: { agent_id: 'agent-1' },
        query: expect.objectContaining({ source: 'webapp:webapp-app-id' }),
      })
    })
    expect(screen.getByText('1.3k')).toBeInTheDocument()

    await act(async () => {
      resolveNextStatistics(emptyStatisticsResponse)
    })
    expect(await screen.findByText('0%')).toBeInTheDocument()
    expect(screen.queryByText('1.3k')).not.toBeInTheDocument()
  })

  it('announces a loading failure and recovers after retry', async () => {
    const user = userEvent.setup()
    mocks.statisticsQueryFn
      .mockRejectedValueOnce(new Error('Statistics unavailable'))
      .mockResolvedValueOnce(statisticsResponse)

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'agentV2.agentDetail.monitoring.loadFailed',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(await screen.findByText('1.3k')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
