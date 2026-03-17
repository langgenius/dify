import type { PromptConfig } from '@/models/debug'
import type { SiteInfo } from '@/models/share'
import type { IOtherOptions } from '@/service/base'
import type { VisionSettings } from '@/types/app'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AppSourceType } from '@/service/share'
import { Resolution, TransferMethod } from '@/types/app'
import Result from '../index'

const {
  notifyMock,
  sendCompletionMessageMock,
  sendWorkflowMessageMock,
  stopChatMessageRespondingMock,
  textGenerationResPropsSpy,
} = vi.hoisted(() => ({
  notifyMock: vi.fn(),
  sendCompletionMessageMock: vi.fn(),
  sendWorkflowMessageMock: vi.fn(),
  stopChatMessageRespondingMock: vi.fn(),
  textGenerationResPropsSpy: vi.fn(),
}))

vi.mock('i18next', () => ({
  t: (key: string) => key,
}))

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: notifyMock,
  },
}))

vi.mock('@/utils', async () => {
  const actual = await vi.importActual<typeof import('@/utils')>('@/utils')
  return {
    ...actual,
    sleep: () => new Promise<void>(() => {}),
  }
})

vi.mock('@/service/share', async () => {
  const actual = await vi.importActual<typeof import('@/service/share')>('@/service/share')
  return {
    ...actual,
    sendCompletionMessage: (...args: Parameters<typeof actual.sendCompletionMessage>) => sendCompletionMessageMock(...args),
    sendWorkflowMessage: (...args: Parameters<typeof actual.sendWorkflowMessage>) => sendWorkflowMessageMock(...args),
    stopChatMessageResponding: (...args: Parameters<typeof actual.stopChatMessageResponding>) => stopChatMessageRespondingMock(...args),
  }
})

vi.mock('@/app/components/app/text-generate/item', () => ({
  default: (props: Record<string, unknown>) => {
    textGenerationResPropsSpy(props)
    return (
      <div data-testid="text-generation-res">
        {typeof props.content === 'string' ? props.content : JSON.stringify(props.content ?? null)}
      </div>
    )
  },
}))

vi.mock('@/app/components/share/text-generation/no-data', () => ({
  default: () => <div data-testid="no-data">No data</div>,
}))

const promptConfig: PromptConfig = {
  prompt_template: 'template',
  prompt_variables: [
    { key: 'name', name: 'Name', type: 'string', required: true },
  ],
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
  beforeEach(() => {
    vi.clearAllMocks()
    stopChatMessageRespondingMock.mockResolvedValue(undefined)
  })

  it('should render no data before the first execution', () => {
    render(<Result {...baseProps} />)

    expect(screen.getByTestId('no-data')).toBeTruthy()
    expect(screen.queryByTestId('text-generation-res')).toBeNull()
  })

  it('should stream completion results and stop the current task', async () => {
    let completionHandlers: {
      onCompleted: () => void
      onData: (chunk: string, isFirstMessage: boolean, info: { messageId: string, taskId?: string }) => void
      onError: () => void
      onMessageReplace: (messageReplace: { answer: string }) => void
    } | null = null

    sendCompletionMessageMock.mockImplementation(async (_data, handlers) => {
      completionHandlers = handlers
    })

    const onCompleted = vi.fn()
    const onRunControlChange = vi.fn()
    const { rerender } = render(
      <Result
        {...baseProps}
        onCompleted={onCompleted}
        onRunControlChange={onRunControlChange}
      />,
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
    expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeTruthy()

    await act(async () => {
      completionHandlers?.onData('Hello', false, {
        messageId: 'message-1',
        taskId: 'task-1',
      })
    })

    expect(screen.getByTestId('text-generation-res').textContent).toContain('Hello')

    await waitFor(() => {
      expect(onRunControlChange).toHaveBeenLastCalledWith(expect.objectContaining({
        isStopping: false,
      }))
    })

    fireEvent.click(screen.getByRole('button', { name: 'operation.stopResponding' }))
    await waitFor(() => {
      expect(stopChatMessageRespondingMock).toHaveBeenCalledWith('app-1', 'task-1', AppSourceType.webApp, 'app-1')
    })

    await act(async () => {
      completionHandlers?.onCompleted()
    })

    expect(onCompleted).toHaveBeenCalledWith('Hello', undefined, true)
    expect(textGenerationResPropsSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      messageId: 'message-1',
    }))
  })

  it('should render workflow results after workflow completion', async () => {
    let workflowHandlers: IOtherOptions | null = null
    sendWorkflowMessageMock.mockImplementation(async (_data, handlers) => {
      workflowHandlers = handlers
    })

    const onCompleted = vi.fn()
    const { rerender } = render(
      <Result
        {...baseProps}
        isWorkflow
        onCompleted={onCompleted}
      />,
    )

    rerender(
      <Result
        {...baseProps}
        isWorkflow
        controlSend={1}
        onCompleted={onCompleted}
      />,
    )

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

    expect(screen.getByTestId('text-generation-res').textContent).toContain('{"answer":"Hello"}')
    expect(textGenerationResPropsSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      workflowProcessData: expect.objectContaining({
        resultText: 'Hello',
        status: 'succeeded',
      }),
    }))
    expect(onCompleted).toHaveBeenCalledWith('{"answer":"Hello"}', undefined, true)
  })

  it('should render batch task ids for both short and long indexes', () => {
    const { rerender } = render(
      <Result
        {...baseProps}
        isCallBatchAPI
        taskId={3}
      />,
    )

    expect(textGenerationResPropsSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      taskId: '03',
    }))

    rerender(
      <Result
        {...baseProps}
        isCallBatchAPI
        taskId={12}
      />,
    )

    expect(textGenerationResPropsSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      taskId: '12',
    }))
  })

  it('should render the mobile stop button layout while a batch run is responding', async () => {
    let completionHandlers: {
      onData: (chunk: string, isFirstMessage: boolean, info: { messageId: string, taskId?: string }) => void
    } | null = null

    sendCompletionMessageMock.mockImplementation(async (_data, handlers) => {
      completionHandlers = handlers
    })

    const { rerender } = render(
      <Result
        {...baseProps}
        isCallBatchAPI
        isMobile
        isPC={false}
        taskId={2}
      />,
    )

    rerender(
      <Result
        {...baseProps}
        controlSend={1}
        isCallBatchAPI
        isMobile
        isPC={false}
        taskId={2}
      />,
    )

    await act(async () => {
      completionHandlers?.onData('Hello', false, {
        messageId: 'message-batch',
        taskId: 'task-batch',
      })
    })

    expect(screen.getByRole('button', { name: 'operation.stopResponding' }).parentElement?.className).toContain('justify-center')
  })
})
