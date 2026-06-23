import type { PromptConfig } from '@/models/debug'
import type { SiteInfo } from '@/models/share'
import type { VisionSettings } from '@/types/app'
import { fireEvent, render, screen } from '@testing-library/react'
import { AppSourceType } from '@/service/share'
import { Resolution, TransferMethod } from '@/types/app'
import TextGenerationResultPanel from '../text-generation-result-panel'
import { TaskStatus } from '../types'

const resPropsSpy = vi.fn()
const resDownloadPropsSpy = vi.fn()

vi.mock('@/app/components/share/text-generation/result', () => ({
  default: (props: Record<string, unknown>) => {
    resPropsSpy(props)
    return <div data-testid={`res-${String(props.taskId ?? 'single')}`} />
  },
}))

vi.mock('@/app/components/share/text-generation/run-batch/res-download', () => ({
  default: (props: Record<string, unknown>) => {
    resDownloadPropsSpy(props)
    return <div data-testid="res-download-mock" />
  },
}))

const promptConfig: PromptConfig = {
  prompt_template: 'template',
  prompt_variables: [
    { key: 'name', name: 'Name', type: 'string', required: true },
  ],
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

const batchTasks = [
  {
    id: 1,
    status: TaskStatus.completed,
    params: { inputs: { name: 'Alpha' } },
  }!,
  {
    id: 2,
    status: TaskStatus.failed,
    params: { inputs: { name: 'Beta' } },
  }!,
]

const baseProps = {
  allFailedTaskList: [],
  allSuccessTaskList: [],
  allTaskList: batchTasks,
  appId: 'app-123',
  appSourceType: AppSourceType.webApp,
  completionFiles: [],
  controlRetry: 88,
  controlSend: 77,
  controlStopResponding: 66,
  exportRes: [{ 'Name': 'Alpha', 'share.generation.completionResult': 'Done' }!],
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
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render a single result in run-once mode and pass non-batch props', () => {
    render(<TextGenerationResultPanel {...baseProps} />)

    expect(screen.getByTestId('res-single'))!.toBeInTheDocument()
    expect(resPropsSpy).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'app-123',
      appSourceType: AppSourceType.webApp,
      completionFiles: [],
      controlSend: 77,
      controlStopResponding: 66,
      hideInlineStopButton: true,
      inputs: { name: 'Alice' },
      isCallBatchAPI: false,
      moreLikeThisEnabled: true,
      taskId: undefined,
    }))
    expect(screen.queryByTestId('res-download-mock')).not.toBeInTheDocument()
  })

  it('should render batch results, download entry, loading area, and retry banner', () => {
    const handleRetryAllFailedTask = vi.fn()

    render(
      <TextGenerationResultPanel
        {...baseProps}
        allFailedTaskList={[batchTasks[1]!]}
        allSuccessTaskList={[batchTasks[0]!]}
        isCallBatchAPI
        noPendingTask={false}
        handleRetryAllFailedTask={handleRetryAllFailedTask}
      />,
    )

    expect(screen.getByTestId('res-1'))!.toBeInTheDocument()
    expect(screen.getByTestId('res-2'))!.toBeInTheDocument()
    expect(resPropsSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({
      inputs: { name: 'Alpha' },
      isError: false,
      controlRetry: 0,
      taskId: 1,
      onRunControlChange: undefined,
    }))
    expect(resPropsSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({
      inputs: { name: 'Beta' },
      isError: true,
      controlRetry: 88,
      taskId: 2,
    }))
    expect(screen.getByText('share.generation.executions:{"num":2}'))!.toBeInTheDocument()
    expect(screen.getByTestId('res-download-mock'))!.toBeInTheDocument()
    expect(resDownloadPropsSpy).toHaveBeenCalledWith(expect.objectContaining({
      isMobile: false,
      values: baseProps.exportRes,
    }))
    expect(screen.getByText('share.generation.batchFailed.info:{"num":1}'))!.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'share.generation.batchFailed.retry' }))!.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'appApi.loading' }))!.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'share.generation.batchFailed.retry' }))
    expect(handleRetryAllFailedTask).toHaveBeenCalledTimes(1)
  })

  it('should toggle mobile result panel handle between show and hide actions', () => {
    const onHideResultPanel = vi.fn()
    const onShowResultPanel = vi.fn()
    const { rerender } = render(
      <TextGenerationResultPanel
        {...baseProps}
        isPC={false}
        isShowResultPanel={true}
        onHideResultPanel={onHideResultPanel}
        onShowResultPanel={onShowResultPanel}
      />,
    )

    fireEvent.click(document.querySelector('.cursor-grab') as HTMLElement)
    expect(onHideResultPanel).toHaveBeenCalledTimes(1)

    rerender(
      <TextGenerationResultPanel
        {...baseProps}
        isPC={false}
        isShowResultPanel={false}
        onHideResultPanel={onHideResultPanel}
        onShowResultPanel={onShowResultPanel}
      />,
    )

    fireEvent.click(document.querySelector('.cursor-grab') as HTMLElement)
    expect(onShowResultPanel).toHaveBeenCalledTimes(1)
  })
})
