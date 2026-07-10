import type { AgentLogListResponse, AgentLogMessageListResponse, AgentLogSourceListResponse } from '@dify/contracts/api/console/agent/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentLogsPage } from '../page'

type AgentLogsQueryInput = {
  input: {
    params: {
      agent_id: string
    }
    query?: Record<string, unknown>
  }
}

const mocks = vi.hoisted(() => ({
  logsQueryFn: vi.fn(),
  logSourcesQueryFn: vi.fn(),
  messagesQueryFn: vi.fn(),
  logsQueryOptions: vi.fn((input: AgentLogsQueryInput) => ({
    queryKey: ['agent-logs', input],
    queryFn: () => mocks.logsQueryFn(input),
  })),
  logSourcesQueryOptions: vi.fn((input: AgentLogsQueryInput) => ({
    queryKey: ['agent-log-sources', input],
    queryFn: () => mocks.logSourcesQueryFn(input),
  })),
  messagesQueryOptions: vi.fn((input: AgentLogsQueryInput) => ({
    queryKey: ['agent-log-messages', input],
    queryFn: () => mocks.messagesQueryFn(input),
  })),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (value: number) => `formatted-${value}`,
  }),
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
        logs: {
          get: {
            queryOptions: mocks.logsQueryOptions,
          },
          byConversationId: {
            messages: {
              get: {
                queryOptions: mocks.messagesQueryOptions,
              },
            },
          },
        },
      },
    },
  },
}))

const emptyLogsResponse: AgentLogListResponse = {
  data: [],
  has_more: false,
  limit: 25,
  page: 1,
  total: 0,
}

const populatedLogsResponse: AgentLogListResponse = {
  data: [
    {
      conversation_id: 'conversation-1',
      created_at: 1781660000,
      end_user_id: 'end-user-1',
      id: 'log-1',
      message_count: 3,
      operation_rate: null,
      source: {
        app_icon: '📙',
        app_icon_background: '#FFF4ED',
        app_icon_type: 'emoji',
        app_id: 'webapp-app-id',
        app_name: 'Book Translation',
        id: 'webapp:webapp-app-id',
        type: 'webapp',
      },
      status: 'success',
      title: 'Previous conversation',
      unread: false,
      updated_at: 1781661000,
      user_rate: null,
    },
  ],
  has_more: false,
  limit: 25,
  page: 1,
  total: 1,
}

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
    {
      label: 'Workflow',
      type: 'workflow',
      sources: [
        {
          app_icon: '🖌',
          app_icon_background: '#EEF4FF',
          app_icon_type: 'emoji',
          app_id: 'workflow-app-id',
          app_name: 'SVG Logo Design',
          id: 'workflow:workflow-app-id:workflow-id:v3:agent-node-id',
          node_id: 'agent-node-id',
          type: 'workflow',
          workflow_id: 'workflow-id',
          workflow_version: 'v3',
        },
      ],
    },
  ],
}

const messagesResponse: AgentLogMessageListResponse = {
  data: [
    {
      answer: 'Translated chapter summary',
      answer_tokens: 12,
      conversation_id: 'conversation-1',
      created_at: 1781660001,
      currency: 'USD',
      error: null,
      from_account_id: null,
      from_end_user_id: 'end-user-1',
      id: 'message-1',
      latency: 1.234,
      message_id: 'message-1',
      message_tokens: 8,
      query: 'Translate this chapter',
      status: 'success',
      total_price: '0.001',
      total_tokens: 20,
      updated_at: 1781660002,
    },
  ],
  has_more: false,
  limit: 100,
  page: 1,
  total: 1,
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
      <AgentLogsPage agentId="agent-1" />
    </QueryClientProvider>,
  )

  return queryClient
}

const getLatestLogsQueryInput = () => {
  const latestCall = mocks.logsQueryOptions.mock.calls.at(-1)

  if (!latestCall)
    throw new Error('Expected logs query options to be called')

  return latestCall[0]
}

describe('AgentLogsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.logsQueryFn.mockResolvedValue(emptyLogsResponse)
    mocks.logSourcesQueryFn.mockResolvedValue(logSourcesResponse)
    mocks.messagesQueryFn.mockResolvedValue(messagesResponse)
  })

  describe('Query contract', () => {
    it('should request logs with generated contract filters by default', async () => {
      renderPage()

      await waitFor(() => {
        expect(mocks.logsQueryOptions).toHaveBeenCalled()
      })

      expect(getLatestLogsQueryInput()).toEqual({
        input: {
          params: {
            agent_id: 'agent-1',
          },
          query: expect.objectContaining({
            keyword: undefined,
            limit: 25,
            page: 1,
            sort_by: 'created_at',
            sort_order: 'desc',
          }),
        },
      })
      expect(getLatestLogsQueryInput().input.query).not.toHaveProperty('source')
      expect(getLatestLogsQueryInput().input.query).not.toHaveProperty('sources')
    })

    it('should send multiple source ids through the sources array filter', async () => {
      const user = userEvent.setup()

      renderPage()

      await user.click(await screen.findByRole('combobox', { name: 'agentV2.agentDetail.logs.filters.source.label' }))
      await user.click(await screen.findByRole('option', { name: /Book Translation/ }))
      await user.click(await screen.findByRole('option', { name: /SVG Logo Design/ }))

      await waitFor(() => {
        expect(getLatestLogsQueryInput().input.query).toEqual(expect.objectContaining({
          sources: [
            'webapp:webapp-app-id',
            'workflow:workflow-app-id:workflow-id:v3:agent-node-id',
          ],
        }))
      })

      expect(getLatestLogsQueryInput().input.query).not.toHaveProperty('source')
    })

    it('should translate Sort selection into sort_by and sort_order query params', async () => {
      const user = userEvent.setup()

      renderPage()

      await user.click(screen.getByRole('button', { name: /appLog\.filter\.sortBy/ }))
      await user.click(await screen.findByRole('menuitemradio', { name: 'agentV2.agentDetail.logs.filters.sort.lastUpdatedTime' }))

      await waitFor(() => {
        expect(getLatestLogsQueryInput().input.query).toEqual(expect.objectContaining({
          sort_by: 'updated_at',
          sort_order: 'desc',
        }))
      })

      await user.click(screen.getByRole('button', { name: 'appLog.filter.ascending' }))

      await waitFor(() => {
        expect(getLatestLogsQueryInput().input.query).toEqual(expect.objectContaining({
          sort_by: 'updated_at',
          sort_order: 'asc',
        }))
      })
    })

    it('should keep existing log rows visible while filter changes refetch', async () => {
      const user = userEvent.setup()
      let resolveNextLogs: (value: AgentLogListResponse) => void = () => undefined
      const nextLogsPromise = new Promise<AgentLogListResponse>((resolve) => {
        resolveNextLogs = resolve
      })
      mocks.logsQueryFn
        .mockResolvedValueOnce(populatedLogsResponse)
        .mockReturnValueOnce(nextLogsPromise)

      renderPage()

      expect(await screen.findByText('Previous conversation')).toBeInTheDocument()

      await user.click(await screen.findByRole('combobox', { name: 'agentV2.agentDetail.logs.filters.source.label' }))
      await user.click(await screen.findByRole('option', { name: /Book Translation/ }))

      await waitFor(() => {
        expect(getLatestLogsQueryInput().input.query).toEqual(expect.objectContaining({
          sources: ['webapp:webapp-app-id'],
        }))
        expect(mocks.logsQueryFn).toHaveBeenCalledTimes(2)
      })

      expect(screen.getByText('Previous conversation')).toBeInTheDocument()

      resolveNextLogs(emptyLogsResponse)

      await waitFor(() => {
        expect(screen.queryByText('Previous conversation')).not.toBeInTheDocument()
      })
    })

    it('should open chatbot-style log detail drawer with generated messages contract when a row is clicked', async () => {
      const user = userEvent.setup()
      mocks.logsQueryFn.mockResolvedValue(populatedLogsResponse)

      renderPage()

      await user.click(await screen.findByRole('button', { name: 'Previous conversation' }))

      await waitFor(() => {
        expect(mocks.messagesQueryOptions).toHaveBeenCalledWith({
          input: {
            params: {
              agent_id: 'agent-1',
              conversation_id: 'conversation-1',
            },
            query: {
              limit: 100,
              page: 1,
              sort_by: 'created_at',
              sort_order: 'asc',
              sources: ['webapp:webapp-app-id'],
            },
          },
        })
      })
      expect(await screen.findByText('Translated chapter summary')).toBeInTheDocument()
    })
  })
})
