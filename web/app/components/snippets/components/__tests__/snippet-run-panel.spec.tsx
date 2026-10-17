import type { InputVar } from '@/models/pipeline'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from 'reactflow'
import { renderWorkflowComponent as renderWithWorkflowStore } from '@/app/components/workflow/__tests__/workflow-test-env'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { PipelineInputVarType } from '@/models/pipeline'
import SnippetRunPanel from '../snippet-run-panel'

const renderWorkflowComponent = (
  ui: Parameters<typeof renderWithWorkflowStore>[0],
  options?: Parameters<typeof renderWithWorkflowStore>[1],
) => renderWithWorkflowStore(<ReactFlowProvider>{ui}</ReactFlowProvider>, options)

const workflowHookMocks = vi.hoisted(() => ({
  handleCancelDebugAndPreviewPanel: vi.fn(),
  handleRun: vi.fn(),
}))

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}))

const copyMock = vi.hoisted(() => vi.fn())

vi.mock('copy-to-clipboard', () => ({
  default: copyMock,
}))

vi.mock('@/app/notifications', () => ({
  toast: toastMocks,
}))

vi.mock('@/app/components/workflow/hooks/use-workflow-panel-interactions', () => ({
  useWorkflowInteractions: () => ({
    handleCancelDebugAndPreviewPanel: workflowHookMocks.handleCancelDebugAndPreviewPanel,
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-workflow-run', () => ({
  useWorkflowRun: () => ({
    handleRun: workflowHookMocks.handleRun,
  }),
}))

vi.mock('@/app/components/workflow/run/result-text', () => ({
  default: ({ outputs, onClick }: { outputs?: string; onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      {outputs || 'empty-result'}
    </button>
  ),
}))

vi.mock('@/app/components/workflow/run/result-panel', () => ({
  default: ({ status }: { status: string }) => <div>{`detail-${status}`}</div>,
}))

vi.mock('@/app/components/workflow/run/tracing-panel', () => ({
  default: ({ list }: { list: unknown[] }) => <div>{`tracing-${list.length}`}</div>,
}))

const fields: InputVar[] = [
  {
    label: 'Topic',
    variable: 'topic',
    type: PipelineInputVarType.textInput,
    default_value: 'default topic',
    required: true,
  },
]

describe('SnippetRunPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resizes the run panel with the keyboard within the available canvas width', async () => {
    const user = userEvent.setup()
    renderWorkflowComponent(<SnippetRunPanel fields={[]} />, {
      initialStoreState: { previewPanelWidth: 480, workflowCanvasWidth: 1000 },
    })
    await user.tab()
    const handle = screen.getByRole('separator', { name: 'workflow.singleRun.testRun' })
    expect(handle).toHaveFocus()
    await user.keyboard('{ArrowLeft}{Shift>}{ArrowLeft}{/Shift}')
    expect(handle).toHaveAttribute('aria-valuenow', '520')
    await user.keyboard('{End}{ArrowLeft}')
    expect(handle).toHaveAttribute('aria-valuenow', '600')
    await user.keyboard('{Home}{ArrowRight}')
    expect(handle).toHaveAttribute('aria-valuenow', '400')
  })

  it('closes the panel from its close action', async () => {
    const user = userEvent.setup()
    renderWorkflowComponent(<SnippetRunPanel fields={[]} />, {
      initialStoreState: { previewPanelWidth: 480 },
    })

    const closeButton = screen.getByRole('button', { name: 'common.operation.close' })
    await user.click(closeButton)

    expect(workflowHookMocks.handleCancelDebugAndPreviewPanel).toHaveBeenCalledOnce()
  })

  it('disables result tabs until a workflow run is available', async () => {
    const user = userEvent.setup()
    renderWorkflowComponent(<SnippetRunPanel fields={fields} />, {
      initialStoreState: {
        showInputsPanel: true,
        previewPanelWidth: 480,
      },
    })

    const inputTab = screen.getByRole('tab', { name: 'runLog.input' })
    const resultTab = screen.getByRole('tab', { name: 'runLog.result' })
    const detailTab = screen.getByRole('tab', { name: 'runLog.detail' })
    const tracingTab = screen.getByRole('tab', { name: 'runLog.tracing' })

    expect(resultTab).toHaveAttribute('aria-disabled', 'true')
    expect(detailTab).toHaveAttribute('aria-disabled', 'true')
    expect(tracingTab).toHaveAttribute('aria-disabled', 'true')
    await user.click(resultTab)
    expect(inputTab).toHaveAttribute('aria-selected', 'true')
  })

  it('should render snippet input fields with defaults and run with edited inputs', async () => {
    const user = userEvent.setup()

    renderWorkflowComponent(<SnippetRunPanel fields={fields} />, {
      initialStoreState: {
        showInputsPanel: true,
        previewPanelWidth: 480,
      },
    })

    const topic = screen.getByRole('textbox', { name: 'Topic' })
    expect(topic).toHaveValue('default topic')
    expect(topic).toHaveFocus()
    await user.clear(topic)
    await user.click(screen.getByRole('button', { name: 'workflow.singleRun.startRun' }))
    expect(workflowHookMocks.handleRun).not.toHaveBeenCalled()
    expect(toastMocks.error).toHaveBeenCalledWith(
      'appDebug.errorMessage.valueOfVarRequired:{"key":"Topic"}',
    )
    await user.type(topic, 'changed topic')
    await user.click(screen.getByRole('button', { name: 'workflow.singleRun.startRun' }))

    expect(workflowHookMocks.handleRun).toHaveBeenCalledWith({
      inputs: { topic: 'changed topic' },
    })
    expect(screen.getByText('empty-result')).toBeInTheDocument()
  })

  it('should copy successful text results and open details from the result panel', async () => {
    const user = userEvent.setup()

    renderWorkflowComponent(<SnippetRunPanel fields={[]} />, {
      initialStoreState: {
        showInputsPanel: false,
        previewPanelWidth: 480,
        workflowRunningData: {
          task_id: 'task-1',
          resultText: 'final answer',
          tracing: [],
          result: {
            status: WorkflowRunningStatus.Succeeded,
            finished_at: 1710000000,
            files: [],
            inputs: '{}',
            inputs_truncated: false,
            process_data_truncated: false,
            outputs: '{}',
            outputs_truncated: false,
          },
        },
      },
    })

    expect(screen.getByText('final answer')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.copy' }))

    expect(copyMock).toHaveBeenCalledWith('final answer')
    expect(toastMocks.success).toHaveBeenCalledWith('common.actionMsg.copySuccessfully')

    await user.click(screen.getByText('final answer'))

    expect(screen.getByText(`detail-${WorkflowRunningStatus.Succeeded}`)).toBeInTheDocument()
  })
})
