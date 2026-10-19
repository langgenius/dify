import type { AgentLogResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { ComponentProps, ReactNode } from 'react'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createHttpError } from '@/service/http-error'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import AgentLogDetail from '../detail'

const { mockToast } = vi.hoisted(() => {
  const mockToast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  })
  return { mockToast }
})

const { fetchAgentLogDetail } = vi.hoisted(() => ({
  fetchAgentLogDetail: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/console')>()),
  consoleClient: { apps: { byAppId: { agent: { logs: { get: fetchAgentLogDetail } } } } },
}))

vi.mock('@/app/notifications', () => ({
  toast: mockToast,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ title, value }: { title: ReactNode; value: string | object }) => (
    <div data-testid="code-editor">
      {title}
      {typeof value === 'string' ? value : JSON.stringify(value)}
    </div>
  ),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({ formatTime: (ts: number, fmt: string) => `${ts}-${fmt}` }),
}))

const createMockLog = (overrides: Partial<IChatItem> = {}): IChatItem => ({
  id: 'msg-id',
  content: 'output content',
  isAnswer: false,
  conversationId: 'conv-id',
  input: 'user input',
  ...overrides,
})

const createMockResponse = (overrides: Partial<AgentLogResponse> = {}): AgentLogResponse => ({
  meta: {
    status: 'succeeded',
    executor: 'User',
    start_time: '2023-01-01',
    elapsed_time: 1.0,
    total_tokens: 100,
    agent_mode: 'function_call',
    iterations: 1,
  },
  iterations: [
    {
      created_at: '',
      files: [],
      thought: '',
      tokens: 0,
      tool_raw: { inputs: '', outputs: '' },
      tool_calls: [
        {
          tool_name: 'tool1',
          status: 'success',
          tool_icon: null,
          time_cost: 0,
          tool_input: {},
          tool_output: {},
          tool_parameters: {},
          tool_label: { 'en-US': 'Tool 1' },
        },
      ],
    },
  ],
  files: [],
  ...overrides,
})

describe('AgentLogDetail', () => {
  const renderComponent = (props: Partial<ComponentProps<typeof AgentLogDetail>> = {}) => {
    const defaultProps: ComponentProps<typeof AgentLogDetail> = {
      appId: 'app-id',
      conversationID: 'conv-id',
      messageID: 'msg-id',
      log: createMockLog(),
    }
    return render(<AgentLogDetail {...defaultProps} {...props} />)
  }

  const renderAndWaitForData = async (
    props: Partial<ComponentProps<typeof AgentLogDetail>> = {},
  ) => {
    const result = renderComponent(props)
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    })
    return result
  }

  beforeEach(() => {
    vi.clearAllMocks()
    fetchAgentLogDetail.mockReset()
  })

  describe('Rendering', () => {
    it('should show loading indicator while fetching data', async () => {
      fetchAgentLogDetail.mockReturnValue(new Promise(() => {}))

      renderComponent()

      expect(screen.getByRole('progressbar')).toBeInTheDocument()
    })

    it('should call fetchAgentLogDetail with correct params', async () => {
      fetchAgentLogDetail.mockResolvedValue(createMockResponse())

      await renderAndWaitForData()

      expect(fetchAgentLogDetail).toHaveBeenCalledWith({
        params: { app_id: 'app-id' },
        query: { conversation_id: 'conv-id', message_id: 'msg-id' },
      })
    })
  })

  describe('Props', () => {
    it('should show TRACING tab when activeTab is TRACING', async () => {
      fetchAgentLogDetail.mockResolvedValue(createMockResponse())

      await renderAndWaitForData({ activeTab: 'TRACING' })

      expect(screen.getByText('appLog.agentLogDetail.finalProcessing')).toBeInTheDocument()
      expect(screen.queryByText('user input')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('switches between the request/result and tool trace', async () => {
      const user = userEvent.setup()
      fetchAgentLogDetail.mockResolvedValue(createMockResponse())
      await renderAndWaitForData()
      expect(screen.getByText('user input')).toBeInTheDocument()
      expect(screen.getByText('output content')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'runLog.tracing' }))
      expect(screen.getByText('appLog.agentLogDetail.finalProcessing')).toBeInTheDocument()
      expect(screen.queryByText('user input')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'runLog.detail' }))
      expect(screen.getByText('user input')).toBeInTheDocument()
      expect(screen.queryByText('appLog.agentLogDetail.finalProcessing')).not.toBeInTheDocument()
      expect(fetchAgentLogDetail).toHaveBeenCalledTimes(1)
    })
  })

  it('shows failed execution as failed in both summary and metadata', async () => {
    const response = createMockResponse()
    response.meta.status = 'failed'
    fetchAgentLogDetail.mockResolvedValue(response)

    await renderAndWaitForData()

    expect(screen.getByText('appLog.status.failed')).toBeInTheDocument()
    expect(screen.getByText('FAILED')).toBeInTheDocument()
    expect(screen.queryByText('appLog.status.succeeded')).not.toBeInTheDocument()
    expect(screen.queryByText('SUCCESS')).not.toBeInTheDocument()
  })

  describe('Edge Cases', () => {
    it('should notify on API error', async () => {
      fetchAgentLogDetail.mockRejectedValue(
        createHttpError(new Response(null, { status: 500 }), { message: 'API Error' }),
      )

      renderComponent()

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('API Error')
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
      })
    })

    it('should handle response with empty iterations', async () => {
      fetchAgentLogDetail.mockResolvedValue(createMockResponse({ iterations: [] }))

      await renderAndWaitForData()
      expect(screen.getByText('Null')).toBeInTheDocument()
      expect(screen.getByText('0')).toBeInTheDocument()
    })

    it('should handle response with multiple iterations and duplicate tools', async () => {
      const response = createMockResponse({
        iterations: [
          {
            created_at: '',
            files: [],
            thought: '',
            tokens: 0,
            tool_raw: { inputs: '', outputs: '' },
            tool_calls: [
              {
                tool_name: 'tool1',
                status: 'success',
                tool_icon: null,
                time_cost: 0,
                tool_input: {},
                tool_output: {},
                tool_parameters: {},
                tool_label: { 'en-US': 'Tool 1' },
              },
              {
                tool_name: 'tool2',
                status: 'success',
                tool_icon: null,
                time_cost: 0,
                tool_input: {},
                tool_output: {},
                tool_parameters: {},
                tool_label: { 'en-US': 'Tool 2' },
              },
            ],
          },
          {
            created_at: '',
            files: [],
            thought: '',
            tokens: 0,
            tool_raw: { inputs: '', outputs: '' },
            tool_calls: [
              {
                tool_name: 'tool1',
                status: 'success',
                tool_icon: null,
                time_cost: 0,
                tool_input: {},
                tool_output: {},
                tool_parameters: {},
                tool_label: { 'en-US': 'Tool 1' },
              },
            ],
          },
        ],
      })
      fetchAgentLogDetail.mockResolvedValue(response)

      await renderAndWaitForData()

      expect(screen.getByText('tool1, tool2')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
    })
  })
})
