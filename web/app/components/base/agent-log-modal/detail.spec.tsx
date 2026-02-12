import type { ComponentProps } from 'react'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type { AgentLogDetailResponse } from '@/models/log'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ToastContext } from '@/app/components/base/toast'
import { fetchAgentLogDetail } from '@/service/log'
import AgentLogDetail from './detail'

vi.mock('@/service/log', () => ({
  fetchAgentLogDetail: vi.fn(),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: vi.fn(selector => selector({ appDetail: { id: 'app-id' } })),
}))

vi.mock('@/app/components/workflow/run/status', () => ({
  default: ({ status, time, tokens, error }: { status: string, time?: number, tokens?: number, error?: string }) => (
    <div data-testid="status-panel" data-status={String(status)} data-time={String(time)} data-tokens={String(tokens)}>{error ? <span>{String(error)}</span> : null}</div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ title, value }: { title: React.ReactNode, value: string | object }) => (
    <div data-testid="code-editor">
      {title}
      {typeof value === 'string' ? value : JSON.stringify(value)}
    </div>
  ),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({ formatTime: (ts: number, fmt: string) => `${ts}-${fmt}` }),
}))

vi.mock('@/app/components/workflow/block-icon', () => ({
  default: () => <div data-testid="block-icon" />,
}))

vi.mock('@/app/components/base/icons/src/vender/line/arrows', () => ({
  ChevronRight: (props: { className?: string }) => <div data-testid="chevron-right" className={props.className} />,
}))

const createMockLog = (overrides: Partial<IChatItem> = {}): IChatItem => ({
  id: 'msg-id',
  content: 'output content',
  isAnswer: false,
  conversationId: 'conv-id',
  input: 'user input',
  ...overrides,
})

const createMockResponse = (overrides: Partial<AgentLogDetailResponse> = {}): AgentLogDetailResponse => ({
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
      tool_calls: [{ tool_name: 'tool1', status: 'success', tool_icon: null, tool_label: { 'en-US': 'Tool 1' } }],
    },
  ],
  files: [],
  ...overrides,
})

describe('AgentLogDetail', () => {
  const notify = vi.fn()

  const renderComponent = (props: Partial<ComponentProps<typeof AgentLogDetail>> = {}) => {
    const defaultProps: ComponentProps<typeof AgentLogDetail> = {
      conversationID: 'conv-id',
      messageID: 'msg-id',
      log: createMockLog(),
    }
    return render(
      <ToastContext.Provider value={{ notify, close: vi.fn() } as ComponentProps<typeof ToastContext.Provider>['value']}>
        <AgentLogDetail {...defaultProps} {...props} />
      </ToastContext.Provider>,
    )
  }

  const renderAndWaitForData = async (props: Partial<ComponentProps<typeof AgentLogDetail>> = {}) => {
    const result = renderComponent(props)
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
    return result
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should show loading indicator while fetching data', async () => {
      vi.mocked(fetchAgentLogDetail).mockReturnValue(new Promise(() => {}))

      renderComponent()

      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should display result panel after data loads', async () => {
      vi.mocked(fetchAgentLogDetail).mockResolvedValue(createMockResponse())

      await renderAndWaitForData()

      expect(screen.getByText(/runLog.detail/i)).toBeInTheDocument()
      expect(screen.getByText(/runLog.tracing/i)).toBeInTheDocument()
    })

    it('should call fetchAgentLogDetail with correct params', async () => {
      vi.mocked(fetchAgentLogDetail).mockResolvedValue(createMockResponse())

      await renderAndWaitForData()

      expect(fetchAgentLogDetail).toHaveBeenCalledWith({
        appID: 'app-id',
        params: {
          conversation_id: 'conv-id',
          message_id: 'msg-id',
        },
      })
    })
  })

  describe('Props', () => {
    it('should default to DETAIL tab when activeTab is not provided', async () => {
      vi.mocked(fetchAgentLogDetail).mockResolvedValue(createMockResponse())

      await renderAndWaitForData()

      const detailTab = screen.getByText(/runLog.detail/i)
      expect(detailTab.getAttribute('data-active')).toBe('true')
    })

    it('should show TRACING tab when activeTab is TRACING', async () => {
      vi.mocked(fetchAgentLogDetail).mockResolvedValue(createMockResponse())

      await renderAndWaitForData({ activeTab: 'TRACING' })

      const tracingTab = screen.getByText(/runLog.tracing/i)
      expect(tracingTab.getAttribute('data-active')).toBe('true')
    })
  })

  describe('User Interactions', () => {
    it('should switch to TRACING tab when clicked', async () => {
      vi.mocked(fetchAgentLogDetail).mockResolvedValue(createMockResponse())

      await renderAndWaitForData()

      fireEvent.click(screen.getByText(/runLog.tracing/i))

      await waitFor(() => {
        const tracingTab = screen.getByText(/runLog.tracing/i)
        expect(tracingTab.getAttribute('data-active')).toBe('true')
      })

      const detailTab = screen.getByText(/runLog.detail/i)
      expect(detailTab.getAttribute('data-active')).toBe('false')
    })

    it('should switch back to DETAIL tab after switching to TRACING', async () => {
      vi.mocked(fetchAgentLogDetail).mockResolvedValue(createMockResponse())

      await renderAndWaitForData()

      fireEvent.click(screen.getByText(/runLog.tracing/i))

      await waitFor(() => {
        expect(screen.getByText(/runLog.tracing/i).getAttribute('data-active')).toBe('true')
      })

      fireEvent.click(screen.getByText(/runLog.detail/i))

      await waitFor(() => {
        const detailTab = screen.getByText(/runLog.detail/i)
        expect(detailTab.getAttribute('data-active')).toBe('true')
      })
    })
  })

  describe('Edge Cases', () => {
    it('should notify on API error', async () => {
      vi.mocked(fetchAgentLogDetail).mockRejectedValue(new Error('API Error'))

      renderComponent()

      await waitFor(() => {
        expect(notify).toHaveBeenCalledWith({
          type: 'error',
          message: 'Error: API Error',
        })
      })
    })

    it('should stop loading after API error', async () => {
      vi.mocked(fetchAgentLogDetail).mockRejectedValue(new Error('Network failure'))

      renderComponent()

      await waitFor(() => {
        expect(screen.queryByRole('status')).not.toBeInTheDocument()
      })
    })

    it('should handle response with empty iterations', async () => {
      vi.mocked(fetchAgentLogDetail).mockResolvedValue(
        createMockResponse({ iterations: [] }),
      )

      await renderAndWaitForData()
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
              { tool_name: 'tool1', status: 'success', tool_icon: null, tool_label: { 'en-US': 'Tool 1' } },
              { tool_name: 'tool2', status: 'success', tool_icon: null, tool_label: { 'en-US': 'Tool 2' } },
            ],
          },
          {
            created_at: '',
            files: [],
            thought: '',
            tokens: 0,
            tool_raw: { inputs: '', outputs: '' },
            tool_calls: [
              { tool_name: 'tool1', status: 'success', tool_icon: null, tool_label: { 'en-US': 'Tool 1' } },
            ],
          },
        ],
      })
      vi.mocked(fetchAgentLogDetail).mockResolvedValue(response)

      await renderAndWaitForData()

      expect(screen.getByText(/runLog.detail/i)).toBeInTheDocument()
    })
  })
})
