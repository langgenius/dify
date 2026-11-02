import type { Task } from '../types'
import type { PromptConfig } from '@/models/debug'
import type { SiteInfo } from '@/models/share'
import type { VisionSettings } from '@/types/app'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { AppSourceType } from '@/service/share'
import { captureDownloads } from '@/test/download'
import { Resolution, TransferMethod } from '@/types/app'
import TextGenerationResultPanel from '../text-generation-result-panel'
import { TaskStatus } from '../types'

type CompletionHandlers = Parameters<typeof import('@/service/share').sendCompletionMessage>[1]

const sendCompletion = vi.hoisted(() =>
  vi.fn<typeof import('@/service/share').sendCompletionMessage>(),
)
vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  sendCompletionMessage: sendCompletion,
}))
vi.mock('@/next/navigation', () => ({
  useParams: () => ({ token: 'app-123' }),
  usePathname: () => '/completion/app-123',
}))

const promptConfig: PromptConfig = {
  prompt_template: 'template',
  prompt_variables: [{ key: 'name', name: 'Name', type: 'string', required: true }],
}

const siteInfo: SiteInfo = {
  title: 'Text Generation',
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

const batchTasks: Task[] = [
  {
    id: 1,
    status: TaskStatus.completed,
    params: { inputs: { name: 'Alpha' } },
  },
  {
    id: 2,
    status: TaskStatus.failed,
    params: { inputs: { name: 'Beta' } },
  },
]

const baseProps = {
  allFailedTaskList: [],
  allSuccessTaskList: [],
  allTaskList: batchTasks,
  appId: 'app-123',
  appSourceType: AppSourceType.webApp,
  completionFiles: [],
  controlRetry: 0,
  controlSend: 0,
  controlStopResponding: 0,
  exportRes: [{ Name: 'Alpha', 'share.generation.completionResult': 'Hello Alpha' }],
  handleCompleted: vi.fn(),
  handleRetryAllFailedTask: vi.fn(),
  handleSaveMessage: vi.fn(async () => {}),
  inputs: { name: 'Alice' },
  isCallBatchAPI: false,
  isPC: true,
  isShowResultPanel: true,
  isWorkflow: false,
  moreLikeThisEnabled: true,
  noPendingTask: true,
  onHideResultPanel: vi.fn(),
  onRunControlChange: vi.fn(),
  onRunStart: vi.fn(),
  onShowResultPanel: vi.fn(),
  promptConfig,
  resultExisted: true,
  showTaskList: batchTasks,
  siteInfo,
  textToSpeechEnabled: true,
  visionConfig,
}

describe('TextGenerationResultPanel', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders the single execution for the current inputs without batch controls', async () => {
    let handlers!: CompletionHandlers
    sendCompletion.mockImplementation(async (_data, callbacks) => {
      handlers = callbacks
    })
    const { rerender } = render(<TextGenerationResultPanel {...baseProps} />)
    rerender(<TextGenerationResultPanel {...baseProps} controlSend={1} />)

    expect(sendCompletion).toHaveBeenCalledExactlyOnceWith(
      { inputs: { name: 'Alice' } },
      expect.any(Object),
      AppSourceType.webApp,
      'app-123',
    )
    await act(async () => {
      handlers.onData?.('Hello Alice', true, { messageId: 'message-alice', taskId: 'task-alice' })
      handlers.onCompleted?.()
    })
    expect(await screen.findByText('Hello Alice')).toBeVisible()
    expect(screen.queryByText(/share.generation.executions/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'common.operation.download' }),
    ).not.toBeInTheDocument()
  })

  it('renders per-task inputs, exports successful results and retries failed executions', async () => {
    const user = userEvent.setup()
    const downloads = captureDownloads()
    let betaAttempt = 0
    sendCompletion.mockImplementation(async ({ inputs }, handlers) => {
      const { name } = inputs as { name: string }
      if (name === 'Beta' && betaAttempt++ === 0) {
        handlers.onError?.('offline')
        return
      }
      handlers.onData?.(`Hello ${name}`, true, {
        messageId: `message-${name}`,
        taskId: `task-${name}`,
      })
      handlers.onCompleted?.()
    })
    function Batch() {
      const [retry, setRetry] = useState(0)
      const [tasks, setTasks] = useState(batchTasks)
      return (
        <TextGenerationResultPanel
          {...baseProps}
          allFailedTaskList={tasks.filter((task) => task.status === TaskStatus.failed)}
          showTaskList={tasks}
          handleCompleted={(_content, id, success) =>
            setTasks((current) =>
              current.map((task) =>
                task.id === id
                  ? { ...task, status: success ? TaskStatus.completed : TaskStatus.failed }
                  : task,
              ),
            )
          }
          allSuccessTaskList={tasks.filter((task) => task.status === TaskStatus.completed)}
          allTaskList={[
            ...tasks,
            { id: 3, status: TaskStatus.pending, params: { inputs: { name: 'Gamma' } } },
          ]}
          isCallBatchAPI
          noPendingTask={false}
          controlSend={1}
          controlRetry={retry}
          handleRetryAllFailedTask={() => setRetry((value) => value + 1)}
        />
      )
    }
    render(<Batch />)

    expect(await screen.findByText('Hello Alpha')).toBeVisible()
    expect(screen.getByText('01')).toBeVisible()
    expect(screen.getByText('02')).toBeVisible()
    expect(screen.getByText('share.generation.executions:{"num":3}')).toBeVisible()
    expect(screen.getByText('share.generation.batchFailed.info:{"num":1}')).toBeVisible()
    expect(screen.getByRole('progressbar', { name: 'common.loading' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.download' }))
    expect(downloads).toHaveLength(1)
    expect(downloads[0]!.filename).toBe('result.csv')
    expect(await downloads[0]!.blob.text()).toBe(
      '\uFEFFName,share.generation.completionResult\r\nAlpha,Hello Alpha',
    )

    await user.click(screen.getByText('share.generation.batchFailed.retry'))
    await waitFor(() => expect(sendCompletion).toHaveBeenCalledTimes(3))
    expect(sendCompletion.mock.calls.map(([data]) => data.inputs)).toEqual([
      { name: 'Alpha' },
      { name: 'Beta' },
      { name: 'Beta' },
    ])
    expect(screen.getByText('Hello Alpha')).toBeVisible()
    expect(await screen.findByText('Hello Beta')).toBeVisible()
    expect(
      screen.queryByText('share.generation.batchFailed.info:{"num":1}'),
    ).not.toBeInTheDocument()
  })
})
