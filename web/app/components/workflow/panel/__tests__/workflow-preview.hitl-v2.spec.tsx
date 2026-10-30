import type { HumanInputFieldValue } from '@/app/components/base/chat/chat/answer/human-input-content/field-renderer'
import type { HumanInputFilledFormData, HumanInputFormData } from '@/types/workflow'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNode, createWorkflowRunningData } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { submitHumanInputForm } from '@/service/workflow'
import WorkflowPreview from '../workflow-preview'

const mockHandleCancelDebugAndPreviewPanel = vi.fn()

vi.mock('copy-to-clipboard', () => ({
  default: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    success: vi.fn(),
  },
}))

vi.mock('@/service/workflow', () => ({
  submitHumanInputForm: vi.fn(),
}))

vi.mock('../../hooks/use-workflow-panel-interactions', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../hooks/use-workflow-panel-interactions')>()

  return {
    ...actual,
    useWorkflowInteractions: () => ({
      handleCancelDebugAndPreviewPanel: mockHandleCancelDebugAndPreviewPanel,
    }),
  }
})

vi.mock('@/app/components/workflow/run/result-panel', () => ({
  default: ({ status, onOpenTracingTab }: { status?: string; onOpenTracingTab?: () => void }) => (
    <div data-testid="result-panel">
      <div>{status}</div>
      <button type="button" onClick={onOpenTracingTab}>
        open-tracing
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/run/result-text', () => ({
  default: ({
    outputs,
    isPaused,
    isRunning,
    onClick,
  }: {
    outputs?: string
    isPaused?: boolean
    isRunning?: boolean
    onClick?: () => void
  }) => (
    <div>
      <div data-testid="result-text">{JSON.stringify({ outputs, isPaused, isRunning })}</div>
      <button type="button" onClick={onClick}>
        open-detail
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/run/tracing-panel', () => ({
  default: ({ list }: { list: unknown[] }) => <div data-testid="tracing-panel">{list.length}</div>,
}))

vi.mock('@/app/components/base/chat/chat/answer/reasoning-panel', () => ({
  default: ({ content, done }: { content: Record<string, string>; done: boolean }) => (
    <div data-testid="reasoning-panel" data-done={String(done)}>
      {Object.keys(content).join(',')}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/panel/inputs-panel', () => ({
  default: ({ onRun }: { onRun: () => void }) => (
    <button type="button" onClick={onRun}>
      run-inputs
    </button>
  ),
}))

vi.mock('@/app/components/workflow/panel/human-input-form-list', () => ({
  default: ({
    humanInputFormDataList,
    onHumanInputFormSubmit,
  }: {
    humanInputFormDataList: unknown[]
    onHumanInputFormSubmit?: (
      token: string,
      formData: { inputs: Record<string, HumanInputFieldValue>; action: string },
    ) => Promise<void>
  }) => (
    <div>
      <div data-testid="human-form-list">{humanInputFormDataList.length}</div>
      <button
        type="button"
        onClick={() =>
          onHumanInputFormSubmit?.('form-token', { inputs: { answer: 'ok' }, action: 'approve' })
        }
      >
        submit-human-form
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/panel/human-input-filled-form-list', () => ({
  default: ({ humanInputFilledFormDataList }: { humanInputFilledFormDataList: unknown[] }) => (
    <div data-testid="filled-form-list">{humanInputFilledFormDataList.length}</div>
  ),
}))
const mockSubmitHumanInputForm = vi.mocked(submitHumanInputForm)

type WorkflowResult = NonNullable<ReturnType<typeof createWorkflowRunningData>['result']>

const createWorkflowResult = (overrides: Partial<WorkflowResult> = {}): WorkflowResult => ({
  status: WorkflowRunningStatus.Running,
  inputs_truncated: false,
  process_data_truncated: false,
  outputs_truncated: false,
  ...overrides,
})

const createHumanInputFormData = (
  overrides: Partial<HumanInputFormData> = {},
): HumanInputFormData => ({
  form_id: 'form-1',
  node_id: 'human-node-1',
  node_title: 'Need Approval',
  form_content: 'Before {{#$output.reason#}} after',
  inputs: [],
  actions: [],
  form_token: 'token-1',
  resolved_default_values: {},
  display_in_ui: true,
  expiration_time: 2_000_000_000,
  ...overrides,
})

const createHumanInputFilledFormData = (
  overrides: Partial<HumanInputFilledFormData> = {},
): HumanInputFilledFormData => ({
  form_id: 'form-1',
  node_id: 'node-1',
  node_title: 'Need Approval',
  rendered_content: 'rendered',
  action_id: 'approve',
  action_text: 'Approve',
  ...overrides,
})

describe('WorkflowPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1200,
    })
  })

  it.each([undefined, '1', '2'] as const)(
    'submits paused forms with event version %s',
    async (version) => {
      const user = userEvent.setup()
      const pausedData = createWorkflowRunningData({
        result: createWorkflowResult({
          status: WorkflowRunningStatus.Paused,
          files: [],
        }),
        humanInputFormDataList: [
          createHumanInputFormData({ form_token: 'form-token', form_version: version }),
        ],
        humanInputFilledFormDataList: [createHumanInputFilledFormData()],
      })

      renderWorkflowFlowComponent(<WorkflowPreview />, {
        nodes: [
          createNode({
            id: 'human-node-1',
            type: 'default',
            data: { version: version === '2' ? '1' : '2' },
          }),
        ],
        initialStoreState: {
          workflowRunningData: pausedData,
        },
      })

      expect(screen.getByTestId('human-form-list')).toHaveTextContent('1')
      expect(screen.getByTestId('filled-form-list')).toHaveTextContent('1')

      await user.click(screen.getByRole('button', { name: 'submit-human-form' }))
      expect(mockSubmitHumanInputForm).toHaveBeenCalledWith(
        'form-token',
        {
          inputs: { answer: 'ok' },
          action: 'approve',
        },
        version,
      )
    },
  )
})
