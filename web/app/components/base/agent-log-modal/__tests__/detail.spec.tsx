import type { AgentLogResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { ComponentProps } from 'react'
import type { Props as CodeEditorProps } from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import type { ConsoleClient } from '@/service/console'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import AgentLogDetail from '../detail'
import { createChatLog, createIteration, createLogResponse, createToolCall } from './fixtures'

const { getAgentLog } = vi.hoisted(() => ({
  getAgentLog: vi.fn<ConsoleClient['apps']['byAppId']['agent']['logs']['get']>(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { createConsoleQuery } = await import('@/service/console/query-policies')
  const { withAgentLogOperation } = await import('./fixtures')
  const consoleClient = withAgentLogOperation(actual.consoleClient, getAgentLog)
  return { ...actual, consoleClient, consoleQuery: createConsoleQuery(consoleClient) }
})

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', async () => {
  const { serializeCodeEditorValue } =
    await import('@/app/components/workflow/nodes/_base/components/editor/code-editor/utils')
  return {
    default: ({ title, value, isJSONStringifyBeauty }: CodeEditorProps) => (
      <section>
        {title}
        <pre>{serializeCodeEditorValue(value, isJSONStringifyBeauty)}</pre>
      </section>
    ),
  }
})

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({ formatTime: () => '2024-03-12 10:00' }),
}))

const deferredResponse = () => {
  let resolve!: (response: AgentLogResponse) => void
  let reject!: (error: Error) => void
  const promise = new Promise<AgentLogResponse>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const defaultProps: ComponentProps<typeof AgentLogDetail> = {
  appId: 'app-id',
  conversationID: 'conv-id',
  messageID: 'msg-id',
  log: createChatLog(),
}

const renderDetail = (props: Partial<ComponentProps<typeof AgentLogDetail>> = {}) =>
  render(<AgentLogDetail {...defaultProps} {...props} />)

beforeEach(() => {
  getAgentLog.mockReset()
  getAgentLog.mockResolvedValue(createLogResponse())
})

describe('Agent log data ownership', () => {
  it('loads the selected log through generated input and keeps local error ownership', async () => {
    const request = deferredResponse()
    getAgentLog.mockReturnValue(request.promise)
    renderDetail()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    await waitFor(() => expect(getAgentLog).toHaveBeenCalledOnce())
    expect(getAgentLog).toHaveBeenCalledWith(
      { params: { app_id: 'app-id' }, query: { conversation_id: 'conv-id', message_id: 'msg-id' } },
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        context: expect.objectContaining({ silent: true }),
      }),
    )
    await act(async () => request.resolve(createLogResponse()))
    expect(await screen.findByText('Output content')).toBeInTheDocument()
    expect(screen.getByText('User input')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('100 Tokens')
  })

  it.each([
    { appId: 'next-app' },
    { conversationID: 'next-conversation' },
    { messageID: 'next-message' },
  ])(
    'cancels the old identity and ignores its late response after %j changes',
    async (nextIdentity) => {
      const previous = deferredResponse()
      const current = deferredResponse()
      getAgentLog.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise)
      const { rerender } = renderDetail()
      await waitFor(() => expect(getAgentLog).toHaveBeenCalledOnce())
      const previousSignal = getAgentLog.mock.calls[0]?.[1]?.signal
      expect(previousSignal).toBeInstanceOf(AbortSignal)
      rerender(<AgentLogDetail {...defaultProps} {...nextIdentity} />)
      await waitFor(() => expect(getAgentLog).toHaveBeenCalledTimes(2))
      expect(previousSignal?.aborted).toBe(true)
      await act(async () =>
        current.resolve(
          createLogResponse({ meta: { ...createLogResponse().meta, total_tokens: 222 } }),
        ),
      )
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('222 Tokens'))
      await act(async () =>
        previous.resolve(
          createLogResponse({ meta: { ...createLogResponse().meta, total_tokens: 111 } }),
        ),
      )
      expect(screen.getByRole('status')).toHaveTextContent('222 Tokens')
      expect(screen.queryByText('111 Tokens')).not.toBeInTheDocument()
      const identity = { ...defaultProps, ...nextIdentity }
      expect(getAgentLog).toHaveBeenLastCalledWith(
        {
          params: { app_id: identity.appId },
          query: { conversation_id: identity.conversationID, message_id: identity.messageID },
        },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
    },
  )

  it('cancels the request when the log panel closes', async () => {
    getAgentLog.mockReturnValue(new Promise(() => {}))
    const view = renderDetail()
    await waitFor(() => expect(getAgentLog).toHaveBeenCalledOnce())
    const signal = getAgentLog.mock.calls[0]?.[1]?.signal
    view.unmount()
    expect(signal?.aborted).toBe(true)
  })

  it('ignores an obsolete rejection while the selected log is still loading', async () => {
    const previous = deferredResponse()
    const current = deferredResponse()
    getAgentLog.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise)
    const { rerender } = renderDetail()
    await waitFor(() => expect(getAgentLog).toHaveBeenCalledOnce())
    rerender(<AgentLogDetail {...defaultProps} messageID="next-message" />)
    await waitFor(() => expect(getAgentLog).toHaveBeenCalledTimes(2))
    await act(async () => previous.reject(new Error('Obsolete failure')))
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await act(async () => current.resolve(createLogResponse()))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('100 Tokens'))
  })

  it('shows the current failure without automatic retries and retries on request', async () => {
    const user = userEvent.setup()
    getAgentLog
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce(createLogResponse())
    renderDetail()
    expect(await screen.findByRole('alert')).toHaveTextContent('common.errorBoundary.message')
    expect(getAgentLog).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'common.errorBoundary.tryAgain' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('100 Tokens'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(getAgentLog).toHaveBeenCalledTimes(2)
  })

  it('retains the current log when a background refresh fails', async () => {
    const { queryClient } = renderDetail()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('100 Tokens'))
    getAgentLog.mockRejectedValueOnce(new Error('Refresh failure'))
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: consoleQuery.apps.byAppId.agent.logs.get.key(),
      })
    })
    expect(getAgentLog).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status')).toHaveTextContent('100 Tokens')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('switches between the result and tracing while keeping tool names deduplicated', async () => {
    const user = userEvent.setup()
    getAgentLog.mockResolvedValue(
      createLogResponse({
        meta: { ...createLogResponse().meta, iterations: 2 },
        iterations: [
          createIteration(),
          createIteration({
            tool_calls: [
              createToolCall(),
              createToolCall({ tool_name: 'calendar', tool_label: 'Calendar' }),
            ],
          }),
        ],
      }),
    )
    renderDetail()
    expect(await screen.findByText('search, calendar')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'runLog.tracing' }))
    expect(screen.getByText('APPLOG.AGENTLOGDETAIL.ITERATION 1')).toBeInTheDocument()
    expect(screen.getByText('appLog.agentLogDetail.finalProcessing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Calendar/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'runLog.detail' }))
    expect(screen.getByText('Output content')).toBeInTheDocument()
  })

  it('renders an empty trace without fabricated iterations', async () => {
    const user = userEvent.setup()
    getAgentLog.mockResolvedValue(
      createLogResponse({ meta: { ...createLogResponse().meta, iterations: 0 }, iterations: [] }),
    )
    renderDetail()
    await screen.findByText('0')
    await user.click(screen.getByRole('button', { name: 'runLog.tracing' }))
    expect(screen.queryByRole('button', { name: /LLM/ })).not.toBeInTheDocument()
    expect(screen.queryByText('appLog.agentLogDetail.finalProcessing')).not.toBeInTheDocument()
  })
})
