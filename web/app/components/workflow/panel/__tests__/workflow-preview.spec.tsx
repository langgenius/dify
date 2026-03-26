import type { Shape } from '../../store/workflow'
import type { HumanInputFilledFormData, HumanInputFormData } from '@/types/workflow'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import { toast } from '@/app/components/base/ui/toast'
import { createNodeTracing, createWorkflowRunningData } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { submitHumanInputForm } from '@/service/workflow'
import WorkflowPreview from '../workflow-preview'

const mockHandleCancelDebugAndPreviewPanel = vi.fn()

vi.mock('copy-to-clipboard', () => ({
  default: vi.fn(),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: vi.fn(),
  },
}))

vi.mock('@/service/workflow', () => ({
  submitHumanInputForm: vi.fn(),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useWorkflowInteractions: () => ({
    handleCancelDebugAndPreviewPanel: mockHandleCancelDebugAndPreviewPanel,
  }),
}))

vi.mock('@/app/components/workflow/run/result-panel', () => ({
  default: ({ status }: { status?: string }) => <div data-testid="result-panel">{status}</div>,
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
      <button type="button" onClick={onClick}>open-detail</button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/run/tracing-panel', () => ({
  default: ({ list }: { list: unknown[] }) => <div data-testid="tracing-panel">{list.length}</div>,
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
    onHumanInputFormSubmit?: (token: string, formData: Record<string, string>) => Promise<void>
  }) => (
    <div>
      <div data-testid="human-form-list">{humanInputFormDataList.length}</div>
      <button type="button" onClick={() => onHumanInputFormSubmit?.('form-token', { answer: 'ok' })}>
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

const mockCopy = vi.mocked(copy)
const mockToastSuccess = vi.mocked(toast.success)
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

  it('should keep the input tab active, switch to result after running, and close the preview panel', async () => {
    const user = userEvent.setup()
    const { container } = renderWorkflowComponent(
      <WorkflowPreview />,
      {
        initialStoreState: {
          showInputsPanel: true,
          showDebugAndPreviewPanel: true,
          previewPanelWidth: 420,
        },
      },
    )

    expect(screen.getByRole('button', { name: 'run-inputs' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'run-inputs' }))
    expect(screen.getByTestId('result-text')).toBeInTheDocument()

    await user.click(container.querySelector('.flex.items-center.justify-between .cursor-pointer.p-1') as HTMLElement)
    expect(mockHandleCancelDebugAndPreviewPanel).toHaveBeenCalledTimes(1)
  })

  it('should switch to detail when the workflow is listening', () => {
    renderWorkflowComponent(
      <WorkflowPreview />,
      {
        initialStoreState: {
          isListening: true,
          workflowRunningData: createWorkflowRunningData({
            result: createWorkflowResult({
              status: WorkflowRunningStatus.Running,
            }),
          }),
        },
      },
    )

    expect(screen.getByTestId('result-panel')).toHaveTextContent(WorkflowRunningStatus.Running)
  })

  it('should switch to detail when a finished run has no outputs or files', () => {
    renderWorkflowComponent(
      <WorkflowPreview />,
      {
        initialStoreState: {
          workflowRunningData: {
            ...createWorkflowRunningData({
              result: createWorkflowResult({
                status: WorkflowRunningStatus.Succeeded,
                files: [],
              }),
            }),
            resultText: '',
          } as NonNullable<Shape['workflowRunningData']>,
        },
      },
    )

    expect(screen.getByTestId('result-panel')).toHaveTextContent(WorkflowRunningStatus.Succeeded)
  })

  it('should render paused human input results and submit pending forms', async () => {
    const user = userEvent.setup()
    const pausedData = createWorkflowRunningData({
      result: createWorkflowResult({
        status: WorkflowRunningStatus.Paused,
        files: [],
      }),
      humanInputFormDataList: [createHumanInputFormData()],
      humanInputFilledFormDataList: [createHumanInputFilledFormData()],
    })

    renderWorkflowComponent(
      <WorkflowPreview />,
      {
        initialStoreState: {
          workflowRunningData: pausedData,
        },
      },
    )

    expect(screen.getByTestId('human-form-list')).toHaveTextContent('1')
    expect(screen.getByTestId('filled-form-list')).toHaveTextContent('1')

    await user.click(screen.getByRole('button', { name: 'submit-human-form' }))
    expect(mockSubmitHumanInputForm).toHaveBeenCalledWith('form-token', { answer: 'ok' })
  })

  it('should copy successful string output and show a success toast', async () => {
    const user = userEvent.setup()

    renderWorkflowComponent(
      <WorkflowPreview />,
      {
        initialStoreState: {
          workflowRunningData: {
            ...createWorkflowRunningData({
              result: createWorkflowResult({
                status: WorkflowRunningStatus.Succeeded,
                files: [],
              }),
            }),
            resultText: 'final answer',
          } as NonNullable<Shape['workflowRunningData']>,
        },
      },
    )

    await user.click(screen.getByText('runLog.result'))
    await user.click(screen.getByRole('button', { name: 'common.operation.copy' }))

    expect(mockCopy).toHaveBeenCalledWith('final answer')
    expect(mockToastSuccess).toHaveBeenCalledWith('common.actionMsg.copySuccessfully')
  })

  it('should show a loading state for an empty detail panel', () => {
    renderWorkflowComponent(
      <WorkflowPreview />,
      {
        initialStoreState: {
          isListening: true,
          workflowRunningData: undefined,
        },
      },
    )

    expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
  })

  it('should show a loading state for an empty tracing panel', () => {
    renderWorkflowComponent(
      <WorkflowPreview />,
      {
        initialStoreState: {
          workflowRunningData: createWorkflowRunningData({
            tracing: [],
          }),
        },
      },
    )

    expect(screen.getByTestId('tracing-panel')).toHaveTextContent('0')
    expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
  })

  it('should keep inert tabs disabled without run data and switch among result, detail, and tracing when data exists', async () => {
    const user = userEvent.setup()
    const { store } = renderWorkflowComponent(
      <WorkflowPreview />,
      {
        initialStoreState: {
          showInputsPanel: true,
          workflowRunningData: undefined,
        },
      },
    )

    await user.click(screen.getByText('runLog.result'))
    await user.click(screen.getByText('runLog.detail'))
    await user.click(screen.getByText('runLog.tracing'))
    expect(screen.getByRole('button', { name: 'run-inputs' })).toBeInTheDocument()

    store.setState({
      workflowRunningData: {
        ...createWorkflowRunningData({
          result: createWorkflowResult({
            status: WorkflowRunningStatus.Succeeded,
            files: [],
          }),
          tracing: [createNodeTracing()],
        }),
        resultText: 'ready',
      } as NonNullable<Shape['workflowRunningData']>,
    })

    await user.click(screen.getByText('runLog.result'))
    expect(screen.getByTestId('result-text')).toBeInTheDocument()

    await user.click(screen.getByText('runLog.detail'))
    expect(screen.getByTestId('result-panel')).toBeInTheDocument()

    await user.click(screen.getByText('runLog.tracing'))
    expect(screen.getByTestId('tracing-panel')).toHaveTextContent('1')

    await user.click(screen.getByText('runLog.result'))
    await user.click(screen.getByRole('button', { name: 'open-detail' }))
    expect(screen.getByTestId('result-panel')).toBeInTheDocument()
  })

  it('should resize the preview panel within the allowed workflow canvas bounds', async () => {
    const { container, store } = renderWorkflowComponent(
      <WorkflowPreview />,
      {
        initialStoreState: {
          previewPanelWidth: 450,
          workflowCanvasWidth: 1000,
        },
      },
    )

    const resizeHandle = container.querySelector('.cursor-col-resize') as HTMLElement

    fireEvent.mouseDown(resizeHandle)
    fireEvent.mouseMove(window, { clientX: 700 })
    fireEvent.mouseMove(window, { clientX: 100 })
    fireEvent.mouseUp(window)

    await waitFor(() => {
      expect(store.getState().previewPanelWidth).toBe(500)
    })
  })
})
