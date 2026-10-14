import type { SnippetInputField } from '@/models/snippet'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from 'reactflow'
import { renderWorkflowComponent as renderWithWorkflowStore } from '@/app/components/workflow/__tests__/workflow-test-env'
import { InputVarType, WorkflowRunningStatus } from '@/app/components/workflow/types'
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

const checkInputMocks = vi.hoisted(() => ({
  checkInputsForm: vi.fn(() => true),
}))

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
}))

const copyMock = vi.hoisted(() => vi.fn())

vi.mock('copy-to-clipboard', () => ({
  default: copyMock,
}))

vi.mock('@/app/notifications', () => ({
  toast: toastMocks,
}))

vi.mock('@/app/components/base/chat/chat/check-input-forms-hooks', () => ({
  useCheckInputsForms: () => ({
    checkInputsForm: checkInputMocks.checkInputsForm,
  }),
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

vi.mock('@/app/components/workflow/nodes/_base/components/before-run-form/form-item', () => ({
  default: ({
    payload,
    value,
    onChange,
  }: {
    payload: { variable: string; label: string; type: InputVarType }
    value: unknown
    onChange: (value: unknown) => void
  }) => (
    <div>
      <span>{`${payload.label}:${payload.type}:${String(value)}`}</span>
      {payload.type === InputVarType.textInput && <input aria-label={payload.label} />}
      <button type="button" onClick={() => onChange('changed topic')}>
        {`change-${payload.variable}`}
      </button>
    </div>
  ),
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

const fields: SnippetInputField[] = [
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
    checkInputMocks.checkInputsForm.mockReturnValue(true)
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

  it('closes the panel with an accessible button using Enter and Space', async () => {
    const user = userEvent.setup()
    renderWorkflowComponent(<SnippetRunPanel fields={[]} />, {
      initialStoreState: { previewPanelWidth: 480 },
    })

    const closeButton = screen.getByRole('button', { name: 'common.operation.close' })
    closeButton.focus()
    await user.keyboard('{Enter}')
    closeButton.focus()
    await user.keyboard('[Space]')

    expect(workflowHookMocks.handleCancelDebugAndPreviewPanel).toHaveBeenCalledTimes(2)
  })

  it('navigates between enabled tabs with the arrow keys', async () => {
    const user = userEvent.setup()
    renderWorkflowComponent(<SnippetRunPanel fields={fields} />, {
      initialStoreState: {
        showInputsPanel: true,
        previewPanelWidth: 480,
        workflowRunningData: {
          task_id: 'task-1',
          resultText: 'final answer',
          tracing: [],
          result: {
            status: WorkflowRunningStatus.Succeeded,
            files: [],
            inputs_truncated: false,
            process_data_truncated: false,
            outputs_truncated: false,
          },
        },
      },
    })

    const inputTab = screen.getByRole('tab', { name: 'runLog.input' })
    const resultTab = screen.getByRole('tab', { name: 'runLog.result' })
    const detailTab = screen.getByRole('tab', { name: 'runLog.detail' })
    inputTab.focus()

    expect(inputTab).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowRight}')
    expect(resultTab).toHaveFocus()
    expect(resultTab).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowRight}')
    expect(detailTab).toHaveFocus()
    expect(detailTab).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(inputTab).toHaveFocus()
    expect(inputTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('textbox', { name: 'Topic' })).not.toHaveFocus()
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
    inputTab.focus()
    await user.keyboard('{ArrowRight}')
    expect(resultTab).toHaveFocus()
    expect(inputTab).toHaveAttribute('aria-selected', 'true')
  })

  it('focuses the first input when the input tab is active', () => {
    renderWorkflowComponent(<SnippetRunPanel fields={fields} />, {
      initialStoreState: {
        showInputsPanel: true,
        previewPanelWidth: 480,
      },
    })

    expect(screen.getByRole('textbox', { name: 'Topic' })).toHaveFocus()
  })

  it('should render snippet input fields with defaults and run with edited inputs', async () => {
    const user = userEvent.setup()

    renderWorkflowComponent(<SnippetRunPanel fields={fields} />, {
      initialStoreState: {
        showInputsPanel: true,
        previewPanelWidth: 480,
      },
    })

    expect(screen.getByText(`Topic:${InputVarType.textInput}:default topic`)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'change-topic' }))
    await user.click(screen.getByRole('button', { name: 'workflow.singleRun.startRun' }))

    expect(checkInputMocks.checkInputsForm).toHaveBeenCalledWith(
      { topic: 'changed topic' },
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Topic',
          variable: 'topic',
          type: InputVarType.textInput,
          default: 'default topic',
        }),
      ]),
    )
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

    fireEvent.click(screen.getByText('final answer'))

    expect(screen.getByText(`detail-${WorkflowRunningStatus.Succeeded}`)).toBeInTheDocument()
  })
})
