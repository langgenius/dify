import type { SnippetInputField } from '@/models/snippet'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { InputVarType, WorkflowRunningStatus } from '@/app/components/workflow/types'
import { PipelineInputVarType } from '@/models/pipeline'
import SnippetRunPanel from '../snippet-run-panel'

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

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: toastMocks,
}))

vi.mock('@/app/components/base/chat/chat/check-input-forms-hooks', () => ({
  useCheckInputsForms: () => ({
    checkInputsForm: checkInputMocks.checkInputsForm,
  }),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useWorkflowInteractions: () => ({
    handleCancelDebugAndPreviewPanel: workflowHookMocks.handleCancelDebugAndPreviewPanel,
  }),
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
