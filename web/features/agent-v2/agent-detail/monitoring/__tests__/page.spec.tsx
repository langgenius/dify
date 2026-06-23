import type { AgentLogSourceListResponse, AgentStatisticSummaryEnvelopeResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { EChartsOption } from 'echarts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentMonitoringPage } from '../page'

type AgentMonitoringQueryInput = {
  input: {
    params: {
      agent_id: string
    }
    query?: Record<string, unknown>
  }
}

const mocks = vi.hoisted(() => ({
  chartOptions: [] as EChartsOption[],
  statisticsQueryFn: vi.fn(),
  logSourcesQueryFn: vi.fn(),
  statisticsQueryOptions: vi.fn((input: AgentMonitoringQueryInput) => ({
    queryKey: ['agent-monitoring-statistics', input],
    queryFn: () => mocks.statisticsQueryFn(input),
  })),
  logSourcesQueryOptions: vi.fn((input: AgentMonitoringQueryInput) => ({
    queryKey: ['agent-log-sources', input],
    queryFn: () => mocks.logSourcesQueryFn(input),
  })),
}))

vi.mock('echarts-for-react', () => ({
  default: ({ option, style }: { option: EChartsOption, style?: React.CSSProperties }) => {
    mocks.chartOptions.push(option)

    return <div data-testid="agent-monitoring-chart" style={style} />
  },
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
  useLocale: () => 'en-US',
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      byAgentId: {
        logSources: {
          get: {
            queryOptions: mocks.logSourcesQueryOptions,
          },
        },
        statistics: {
          summary: {
            get: {
              queryOptions: mocks.statisticsQueryOptions,
            },
          },
        },
      },
    },
  },
}))

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
    average_response_time: [
      { date: '2026-06-22', latency: 1250 },
    ],
    average_session_interactions: [
      { date: '2026-06-22', interactions: 1.5 },
    ],
    daily_conversations: [
      { date: '2026-06-22', conversation_count: 2 },
    ],
    daily_end_users: [
      { date: '2026-06-22', terminal_count: 3 },
    ],
    daily_messages: [
      { date: '2026-06-22', message_count: 1250 },
    ],
    token_usage: [
      { date: '2026-06-22', token_count: 2500, total_price: '0.005', currency: 'USD' },
    ],
    tokens_per_second: [
      { date: '2026-06-22', tps: 4 },
    ],
    user_satisfaction_rate: [
      { date: '2026-06-22', rate: 66.67 },
    ],
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

const getLatestStatisticsQueryInput = () => {
  const latestCall = mocks.statisticsQueryOptions.mock.calls.at(-1)

  if (!latestCall)
    throw new Error('Expected statistics query options to be called')

  return latestCall[0]
}

describe('AgentMonitoringPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.chartOptions = []
    mocks.statisticsQueryFn.mockResolvedValue(statisticsResponse)
    mocks.logSourcesQueryFn.mockResolvedValue(logSourcesResponse)
  })

  it('should request statistics through the generated contract without a source filter by default', async () => {
    renderPage()

    await waitFor(() => {
      expect(mocks.statisticsQueryOptions).toHaveBeenCalled()
    })

    expect(getLatestStatisticsQueryInput()).toEqual({
      input: {
        params: {
          agent_id: 'agent-1',
        },
        query: expect.objectContaining({
          start: expect.any(String),
          end: expect.any(String),
        }),
      },
    })
    expect(getLatestStatisticsQueryInput().input.query).not.toHaveProperty('source')
  })

  it('should render statistics summary values and chart options from backend data', async () => {
    renderPage()

    expect(await screen.findByText('1.3k')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('1.5')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('66.67%')).toBeInTheDocument()
    expect(screen.getByText('2.5k')).toBeInTheDocument()

    await waitFor(() => {
      expect(mocks.chartOptions).toHaveLength(6)
    })
    const firstChartOption = mocks.chartOptions[0]

    expect(firstChartOption).toBeDefined()
    expect(firstChartOption).toEqual(expect.objectContaining({
      grid: { top: 8, right: 36, bottom: 10, left: 25, containLabel: true },
    }))
    expect(firstChartOption?.xAxis).toEqual(expect.any(Array))
  })

  it('should use overview empty y-axis fallbacks when backend charts are empty', async () => {
    mocks.statisticsQueryFn.mockResolvedValue(emptyStatisticsResponse)

    renderPage()

    expect(await screen.findByText('0%')).toBeInTheDocument()

    await waitFor(() => {
      expect(mocks.chartOptions).toHaveLength(6)
    })

    expect((mocks.chartOptions[0]?.yAxis as { max?: number }).max).toBe(500)
    expect((mocks.chartOptions[3]?.yAxis as { max?: number }).max).toBe(100)
    expect((mocks.chartOptions[4]?.yAxis as { max?: number }).max).toBe(1000)
  })

  it('should send the selected backend source id through the source query param', async () => {
    const user = userEvent.setup()

    renderPage()

    await user.click(await screen.findByRole('combobox', { name: /metadata.sourceLabel/ }))
    await user.click(await screen.findByRole('option', { name: /Book Translation/ }))

    await waitFor(() => {
      expect(getLatestStatisticsQueryInput().input.query).toEqual(expect.objectContaining({
        source: 'webapp:webapp-app-id',
      }))
    })

    const sourceTrigger = screen.getByRole('combobox', { name: /Book Translation/ })

    expect(within(sourceTrigger).getByText(/metadata.sourceLabel/)).toHaveClass('system-sm-regular', 'text-text-tertiary')
    expect(within(sourceTrigger).getByText('Book Translation')).toHaveClass('system-sm-medium', 'text-text-secondary')
  })

  it('should keep previous statistics visible while a source filter refetches', async () => {
    const user = userEvent.setup()
    let resolveNextStatistics: (value: AgentStatisticSummaryEnvelopeResponse) => void = () => undefined
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
      expect(getLatestStatisticsQueryInput().input.query).toEqual(expect.objectContaining({
        source: 'webapp:webapp-app-id',
      }))
    })
    expect(screen.getByText('1.3k')).toBeInTheDocument()

    resolveNextStatistics(emptyStatisticsResponse)
  })
})
