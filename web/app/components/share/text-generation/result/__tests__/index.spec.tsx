import type { PromptConfig } from '@/models/debug'
import type { SiteInfo } from '@/models/share'
import type { IOtherOptions } from '@/service/base'
import type { VisionSettings } from '@/types/app'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TEXT_GENERATION_TIMEOUT_MS } from '@/config'
import { AppSourceType } from '@/service/share'
import { Resolution, TransferMethod } from '@/types/app'
import Result from '../index'

const {
  notifyMock,
  sendCompletionMessageMock,
  sendWorkflowMessageMock,
  stopChatMessageRespondingMock,
} = vi.hoisted(() => ({
  notifyMock: vi.fn(),
  sendCompletionMessageMock: vi.fn(),
  sendWorkflowMessageMock: vi.fn(),
  stopChatMessageRespondingMock: vi.fn(),
}))

vi.mock('i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('i18next')>()

  return {
    ...actual,
    t: () => '',
  }
})

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock } = await import('@/test/i18n-mock')

  return {
    ...actual,
    ...createReactI18nextMock({
      'operation.stopResponding': 'operation.stopResponding',
      'warningMessage.timeoutExceeded': 'Translated timeout warning',
    }),
  }
})

vi.mock('@/app/notifications', () => ({
  toast: (...args: unknown[]) => notifyMock(...args),
}))

vi.mock('@/service/share', async () => {
  const actual = await vi.importActual<typeof import('@/service/share')>('@/service/share')
  return {
    ...actual,
    sendCompletionMessage: (...args: Parameters<typeof actual.sendCompletionMessage>) =>
      sendCompletionMessageMock(...args),
    sendWorkflowMessage: (...args: Parameters<typeof actual.sendWorkflowMessage>) =>
      sendWorkflowMessageMock(...args),
    stopChatMessageResponding: (...args: Parameters<typeof actual.stopChatMessageResponding>) =>
      stopChatMessageRespondingMock(...args),
  }
})

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ token: 'app-123' }),
  usePathname: () => '/completion/app-123',
}))

const promptConfig: PromptConfig = {
  prompt_template: 'template',
  prompt_variables: [{ key: 'name', name: 'Name', type: 'string', required: true }],
}

const siteInfo: SiteInfo = {
  title: 'Share title',
  description: 'Share description',
  icon_type: 'emoji',
  icon: 'robot',
}

const visionConfig: VisionSettings = {
  enabled: false,
  number_limits: 2,
  detail: Resolution.low,
  transfer_methods: [TransferMethod.local_file],
}

const baseProps = {
  appId: 'app-1',
  appSourceType: AppSourceType.webApp,
  completionFiles: [],
  controlRetry: 0,
  controlSend: 0,
  controlStopResponding: 0,
  handleSaveMessage: vi.fn(),
  inputs: { name: 'Alice' },
  isCallBatchAPI: false,
  isError: false,
  isMobile: false,
  isPC: true,
  isShowTextToSpeech: true,
  isWorkflow: false,
  moreLikeThisEnabled: true,
  onCompleted: vi.fn(),
  onRunControlChange: vi.fn(),
  onRunStart: vi.fn(),
  onShowRes: vi.fn(),
  promptConfig,
  siteInfo,
  visionConfig,
}

describe('Result', () => {
  afterEach(() => vi.useRealTimers())

  it('should render no data before the first execution', () => {
    render(<Result {...baseProps} />)

    expect(screen.getByText('share.generation.noData')).toBeVisible()
  })

  it('should stream completion results and stop the current task', async () => {
    const user = userEvent.setup()
    let completionHandlers: {
      onCompleted: () => void
      onData: (
        chunk: string,
        isFirstMessage: boolean,
        info: { messageId: string; taskId?: string },
      ) => void
      onError: () => void
      onMessageReplace: (messageReplace: { answer: string }) => void
    } | null = null

    sendCompletionMessageMock.mockImplementation(async (_data, handlers) => {
      completionHandlers = handlers
    })

    const onCompleted = vi.fn()
    const onRunControlChange = vi.fn()
    const { rerender } = render(
      <Result {...baseProps} onCompleted={onCompleted} onRunControlChange={onRunControlChange} />,
    )

    rerender(
      <Result
        {...baseProps}
        controlSend={1}
        onCompleted={onCompleted}
        onRunControlChange={onRunControlChange}
      />,
    )

    expect(sendCompletionMessageMock).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('progressbar', { name: 'common.loading' })).toBeTruthy()

    await act(async () => {
      completionHandlers?.onData('Hello', false, {
        messageId: 'message-1',
        taskId: 'task-1',
      })
    })

    expect(await screen.findByText('Hello')).toBeVisible()

    await waitFor(() => {
      expect(onRunControlChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          isStopping: false,
        }),
      )
    })

    await user.click(screen.getByRole('button', { name: 'operation.stopResponding' }))
    await waitFor(() => {
      expect(stopChatMessageRespondingMock).toHaveBeenCalledWith(
        'app-1',
        'task-1',
        AppSourceType.webApp,
        'app-1',
        { silent: true },
      )
    })

    await act(async () => {
      completionHandlers?.onCompleted()
    })

    expect(onCompleted).toHaveBeenCalledWith('Hello', undefined, true)
    expect(
      screen.queryByRole('button', { name: 'operation.stopResponding' }),
    ).not.toBeInTheDocument()
  })

  it('should render workflow results after workflow completion', async () => {
    let workflowHandlers: IOtherOptions | null = null
    sendWorkflowMessageMock.mockImplementation(async (_data, handlers) => {
      workflowHandlers = handlers
    })

    const onCompleted = vi.fn()
    const { rerender } = render(<Result {...baseProps} isWorkflow onCompleted={onCompleted} />)

    rerender(<Result {...baseProps} isWorkflow controlSend={1} onCompleted={onCompleted} />)

    await act(async () => {
      workflowHandlers?.onWorkflowStarted?.({
        workflow_run_id: 'run-1',
        task_id: 'task-1',
        event: 'workflow_started',
        data: {
          id: 'run-1',
          workflow_id: 'wf-1',
          created_at: 0,
        },
      })
      workflowHandlers?.onTextChunk?.({
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        event: 'text_chunk',
        data: {
          text: 'Hello',
        },
      })
      workflowHandlers?.onWorkflowFinished?.({
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        event: 'workflow_finished',
        data: {
          id: 'run-1',
          workflow_id: 'wf-1',
          status: 'succeeded',
          outputs: {
            answer: 'Hello',
          },
          error: '',
          elapsed_time: 0,
          total_tokens: 0,
          total_steps: 0,
          created_at: 0,
          created_by: {
            id: 'user-1',
            name: 'User',
            email: 'user@example.com',
          },
          finished_at: 0,
        },
      })
    })

    expect(await screen.findByText('Hello')).toBeVisible()
    expect(onCompleted).toHaveBeenCalledWith('{"answer":"Hello"}', undefined, true)
  })

  it('should finish a timed-out workflow and show a translated warning', async () => {
    vi.useFakeTimers()
    let workflowHandlers: IOtherOptions | null = null
    sendWorkflowMessageMock.mockImplementation(async (_data, handlers) => {
      workflowHandlers = handlers
    })

    const onCompleted = vi.fn()
    const { rerender } = render(<Result {...baseProps} isWorkflow onCompleted={onCompleted} />)

    rerender(<Result {...baseProps} isWorkflow controlSend={1} onCompleted={onCompleted} />)

    await act(async () => {
      workflowHandlers?.onWorkflowStarted?.({
        workflow_run_id: 'run-timeout',
        task_id: 'task-timeout',
        event: 'workflow_started',
        data: {
          id: 'run-timeout',
          workflow_id: 'wf-1',
          created_at: 0,
        },
      })
      await vi.advanceTimersByTimeAsync(TEXT_GENERATION_TIMEOUT_MS)
    })

    await act(async () => {
      workflowHandlers?.onWorkflowFinished?.({
        task_id: 'task-timeout',
        workflow_run_id: 'run-timeout',
        event: 'workflow_finished',
        data: {
          id: 'run-timeout',
          workflow_id: 'wf-1',
          status: 'succeeded',
          outputs: { answer: 'Late result' },
          error: '',
          elapsed_time: 61,
          total_tokens: 0,
          total_steps: 0,
          created_at: 0,
          created_by: {
            id: 'user-1',
            name: 'User',
            email: 'user@example.com',
          },
          finished_at: 61,
        },
      })
    })

    expect(screen.queryByText('Late result')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'operation.stopResponding' }),
    ).not.toBeInTheDocument()
    expect(notifyMock).toHaveBeenCalledWith('Translated timeout warning', { type: 'warning' })
    expect(onCompleted).toHaveBeenCalledWith('', undefined, false)
    expect(onCompleted).toHaveBeenCalledTimes(1)
  })

  it('should render batch task ids for both short and long indexes', () => {
    const { rerender } = render(<Result {...baseProps} isCallBatchAPI taskId={3} />)

    expect(screen.getByText('03')).toBeVisible()
    rerender(<Result {...baseProps} isCallBatchAPI taskId={12} />)
    expect(screen.getByText('12')).toBeVisible()
    expect(screen.queryByText('03')).not.toBeInTheDocument()
  })
})
