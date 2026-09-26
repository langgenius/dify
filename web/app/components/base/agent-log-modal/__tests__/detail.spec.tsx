import type { ComponentProps, ReactNode } from 'react'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type { AgentLogDetailResponse } from '@/models/log'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { fetchAgentLogDetail } from '@/service/log'
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

vi.mock('@/service/log', () => ({
  fetchAgentLogDetail: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: mockToast,
}))

vi.mock('@/app/components/workflow/run/status', () => ({
  default: ({
    status,
    time,
    tokens,
    error,
  }: {
    status: string
    time?: number
    tokens?: number
    error?: string
  }) => (
    <div
      data-testid="status-panel"
      data-status={String(status)}
      data-time={String(time)}
      data-tokens={String(tokens)}
    >
      {error ? <span>{String(error)}</span> : null}
    </div>
  ),
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

vi.mock('@/app/components/workflow/block-icon', () => ({
  default: () => <div data-testid="block-icon" />,
}))

const createMockLog = (overrides: Partial<IChatItem> = {}): IChatItem => ({
  id: 'msg-id',
  content: 'output content',
  isAnswer: false,
  conversationId: 'conv-id',
  input: 'user input',
  ...overrides,
})

const createMockResponse = (
  overrides: Partial<AgentLogDetailResponse> = {},
): AgentLogDetailResponse => ({
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
          tool_label: { 'en-US': 'Tool 1' },
        },
      ],
    },
  ],
  files: [],
  ...overrides,
})

const deferredResponse = () => {
  let resolve!: (response: AgentLogDetailResponse) => void
  let reject!: (error: Error) => void
  const promise = new Promise<AgentLogDetailResponse>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

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
  })

  describe('Rendering', () => {
    it('should show loading indicator while fetching data', async () => {
      vi.mocked(fetchAgentLogDetail).mockReturnValue(new Promise(() => {}))

      renderComponent()

      expect(screen.getByRole('progressbar')).toBeInTheDocument()
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
        signal: expect.any(AbortSignal),
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

      fireEvent.click(screen.getByRole('button', { name: /runLog.tracing/i }))

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

      fireEvent.click(screen.getByRole('button', { name: /runLog.tracing/i }))

      await waitFor(() => {
        expect(screen.getByText(/runLog.tracing/i).getAttribute('data-active')).toBe('true')
      })

      fireEvent.click(screen.getByRole('button', { name: /runLog.detail/i }))

      await waitFor(() => {
        const detailTab = screen.getByText(/runLog.detail/i)
        expect(detailTab.getAttribute('data-active')).toBe('true')
      })
    })
  })

  describe('Request identity', () => {
    it.each([
      { appId: 'next-app' },
      { conversationID: 'next-conversation' },
      { messageID: 'next-message' },
    ])('ignores a late response after identity changes to %j', async (nextIdentity) => {
      const previous = deferredResponse()
      const current = deferredResponse()
      vi.mocked(fetchAgentLogDetail)
        .mockReturnValueOnce(previous.promise)
        .mockReturnValueOnce(current.promise)
      const props = {
        appId: 'app-id',
        conversationID: 'conv-id',
        messageID: 'msg-id',
        log: createMockLog(),
      }
      const { rerender } = render(<AgentLogDetail {...props} />)
      const previousSignal = vi.mocked(fetchAgentLogDetail).mock.calls[0]![0].signal
      rerender(<AgentLogDetail {...props} {...nextIdentity} />)
      expect(previousSignal.aborted).toBe(true)

      await act(async () =>
        current.resolve(
          createMockResponse({
            meta: { ...createMockResponse().meta, total_tokens: 222 },
          }),
        ),
      )
      await waitFor(() =>
        expect(screen.getByTestId('status-panel')).toHaveAttribute('data-tokens', '222'),
      )
      await act(async () =>
        previous.resolve(
          createMockResponse({
            meta: { ...createMockResponse().meta, total_tokens: 111 },
          }),
        ),
      )
      await waitFor(() =>
        expect(screen.getByTestId('status-panel')).toHaveAttribute('data-tokens', '222'),
      )
      const identity = { ...props, ...nextIdentity }
      expect(fetchAgentLogDetail).toHaveBeenLastCalledWith({
        appID: identity.appId,
        signal: expect.any(AbortSignal),
        params: { conversation_id: identity.conversationID, message_id: identity.messageID },
      })
    })

    it('keeps the new request loading and suppresses errors from an obsolete request', async () => {
      const previous = deferredResponse()
      const current = deferredResponse()
      vi.mocked(fetchAgentLogDetail)
        .mockReturnValueOnce(previous.promise)
        .mockReturnValueOnce(current.promise)
      const props = {
        appId: 'app-id',
        conversationID: 'conv-id',
        messageID: 'msg-id',
        log: createMockLog(),
      }
      const { rerender } = render(<AgentLogDetail {...props} />)
      rerender(<AgentLogDetail {...props} messageID="next-message" />)
      await act(async () => previous.reject(new Error('Obsolete failure')))

      expect(mockToast.error).not.toHaveBeenCalled()
      expect(screen.getByRole('progressbar')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      await act(async () => current.resolve(createMockResponse()))
      await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
      expect(screen.getByTestId('status-panel')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('shows an error and retries the current log request', async () => {
      vi.mocked(fetchAgentLogDetail)
        .mockRejectedValueOnce(new Error('API Error'))
        .mockResolvedValueOnce(createMockResponse())

      renderComponent()

      expect(await screen.findByRole('alert')).toHaveTextContent('common.errorBoundary.message')
      fireEvent.click(screen.getByRole('button', { name: 'common.errorBoundary.tryAgain' }))
      expect(await screen.findByTestId('status-panel')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(mockToast.error).not.toHaveBeenCalled()
    })

    it('keeps the current log visible when a background refresh fails', async () => {
      vi.mocked(fetchAgentLogDetail)
        .mockResolvedValueOnce(createMockResponse())
        .mockRejectedValueOnce(new Error('Background failure'))
      const { queryClient } = await renderAndWaitForData()

      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: ['log', 'agent-detail'] })
      })

      expect(screen.getByTestId('status-panel')).toHaveAttribute('data-tokens', '100')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('should stop loading after API error', async () => {
      vi.mocked(fetchAgentLogDetail).mockRejectedValue(new Error('Network failure'))

      renderComponent()

      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
      })
    })

    it('should handle response with empty iterations', async () => {
      vi.mocked(fetchAgentLogDetail).mockResolvedValue(createMockResponse({ iterations: [] }))

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
              {
                tool_name: 'tool1',
                status: 'success',
                tool_icon: null,
                tool_label: { 'en-US': 'Tool 1' },
              },
              {
                tool_name: 'tool2',
                status: 'success',
                tool_icon: null,
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
                tool_label: { 'en-US': 'Tool 1' },
              },
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
