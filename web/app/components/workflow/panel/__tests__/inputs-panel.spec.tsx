import type { Shape as HooksStoreShape } from '../../hooks-store/store'
import type { RunFile } from '../../types'
import type { FileUpload } from '@/app/components/base/features/types'
import { fireEvent, screen } from '@testing-library/react'
import { TransferMethod } from '@/types/app'
import { FlowType } from '@/types/common'
import { createStartNode } from '../../__tests__/fixtures'
import {
  resetReactFlowMockState,
  rfState,
} from '../../__tests__/reactflow-mock-state'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { InputVarType, WorkflowRunningStatus } from '../../types'
import InputsPanel from '../inputs-panel'

const mockCheckInputsForm = vi.fn()
const mockFormChangeValues: Record<string, unknown> = {}

vi.mock('reactflow', async () =>
  (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock())

vi.mock('@/app/components/base/chat/chat/check-input-forms-hooks', () => ({
  useCheckInputsForms: () => ({
    checkInputsForm: mockCheckInputsForm,
  }),
}))

vi.mock('../../nodes/_base/components/before-run-form/form-item', () => ({
  default: ({
    payload,
    value,
    onChange,
    autoFocus,
  }: {
    payload: { variable: string }
    value: unknown
    onChange: (value: unknown) => void
    autoFocus?: boolean
  }) => (
    <div
      data-testid={`form-item-${payload.variable}`}
      data-value={JSON.stringify(value ?? null)}
      data-autofocus={String(!!autoFocus)}
    >
      <button onClick={() => onChange(mockFormChangeValues[payload.variable])} type="button">
        {`change-${payload.variable}`}
      </button>
    </div>
  ),
}))

const fileSettingsWithImage: FileUpload = {
  enabled: true,
  image: {
    enabled: true,
  },
}

const uploadedRunFile = {
  transfer_method: TransferMethod.remote_url,
  upload_file_id: 'file-2',
} as unknown as RunFile

const uploadingRunFile = {
  transfer_method: TransferMethod.local_file,
} as unknown as RunFile

const createHooksStoreProps = (
  overrides: Partial<HooksStoreShape> = {},
): Partial<HooksStoreShape> => ({
  handleRun: vi.fn(),
  configsMap: {
    flowId: 'flow-1',
    flowType: FlowType.appFlow,
    fileSettings: fileSettingsWithImage,
  },
  ...overrides,
})

describe('InputsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetReactFlowMockState()
    Object.keys(mockFormChangeValues).forEach(key => delete mockFormChangeValues[key])
    mockCheckInputsForm.mockReturnValue(true)
  })

  it('renders start-node defaults, current inputs, and the image field when image upload is enabled', () => {
    rfState.nodes = [
      createStartNode({
        data: {
          variables: [
            {
              type: InputVarType.textInput,
              variable: 'question',
              label: 'Question',
              required: true,
              default: 'default question',
            },
            {
              type: InputVarType.number,
              variable: 'count',
              label: 'Count',
              required: false,
              default: '2',
            },
          ],
        },
      }),
    ]

    renderWorkflowComponent(<InputsPanel onRun={vi.fn()} />, {
      initialStoreState: {
        inputs: {
          question: 'overridden question',
        },
      },
      hooksStoreProps: createHooksStoreProps(),
    })

    expect(screen.getByTestId('form-item-question')).toHaveAttribute('data-value', JSON.stringify('overridden question'))
    expect(screen.getByTestId('form-item-question')).toHaveAttribute('data-autofocus', 'true')
    expect(screen.getByTestId('form-item-count')).toHaveAttribute('data-value', JSON.stringify('2'))
    expect(screen.getByTestId('form-item-__image')).toBeInTheDocument()
  })

  it('updates workflow inputs and files when the form items change', () => {
    const imageFiles = [
      {
        transfer_method: TransferMethod.remote_url,
        upload_file_id: 'file-1',
      },
    ]
    mockFormChangeValues.question = 'changed question'
    mockFormChangeValues.__image = imageFiles

    rfState.nodes = [
      createStartNode({
        data: {
          variables: [
            {
              type: InputVarType.textInput,
              variable: 'question',
              label: 'Question',
              required: true,
            },
          ],
        },
      }),
    ]

    const { store } = renderWorkflowComponent(<InputsPanel onRun={vi.fn()} />, {
      hooksStoreProps: createHooksStoreProps(),
    })

    fireEvent.click(screen.getByRole('button', { name: 'change-question' }))
    fireEvent.click(screen.getByRole('button', { name: 'change-__image' }))

    expect(store.getState().inputs).toEqual({ question: 'changed question' })
    expect(store.getState().files).toEqual(imageFiles)
  })

  it('does not start the run when input validation fails', () => {
    mockCheckInputsForm.mockReturnValue(false)
    const onRun = vi.fn()
    const handleRun = vi.fn()

    rfState.nodes = [
      createStartNode({
        data: {
          variables: [
            {
              type: InputVarType.textInput,
              variable: 'question',
              label: 'Question',
              required: true,
              default: 'default question',
            },
          ],
        },
      }),
    ]

    renderWorkflowComponent(<InputsPanel onRun={onRun} />, {
      hooksStoreProps: createHooksStoreProps({ handleRun }),
    })

    fireEvent.click(screen.getByRole('button', { name: 'workflow.singleRun.startRun' }))

    expect(mockCheckInputsForm).toHaveBeenCalledWith(
      { question: 'default question' },
      expect.arrayContaining([
        expect.objectContaining({ variable: 'question' }),
        expect.objectContaining({ variable: '__image' }),
      ]),
    )
    expect(onRun).not.toHaveBeenCalled()
    expect(handleRun).not.toHaveBeenCalled()
  })

  it('starts the run with processed inputs when validation succeeds', () => {
    const onRun = vi.fn()
    const handleRun = vi.fn()
    const hooksStoreProps = createHooksStoreProps({
      handleRun,
      configsMap: {
        flowId: 'flow-1',
        flowType: FlowType.appFlow,
        fileSettings: {
          enabled: false,
        },
      },
    })

    rfState.nodes = [
      createStartNode({
        data: {
          variables: [
            {
              type: InputVarType.textInput,
              variable: 'question',
              label: 'Question',
              required: true,
            },
            {
              type: InputVarType.checkbox,
              variable: 'confirmed',
              label: 'Confirmed',
              required: false,
            },
          ],
        },
      }),
    ]

    renderWorkflowComponent(<InputsPanel onRun={onRun} />, {
      initialStoreState: {
        inputs: {
          question: 'run this',
          confirmed: 'truthy',
        },
        files: [uploadedRunFile],
      },
      hooksStoreProps,
    })

    fireEvent.click(screen.getByRole('button', { name: 'workflow.singleRun.startRun' }))

    expect(onRun).toHaveBeenCalledTimes(1)
    expect(handleRun).toHaveBeenCalledWith(
      {
        inputs: {
          question: 'run this',
          confirmed: true,
        },
        files: [uploadedRunFile],
      },
    )
  })

  it('disables the run button when a local file is still uploading', () => {
    rfState.nodes = [createStartNode()]

    renderWorkflowComponent(<InputsPanel onRun={vi.fn()} />, {
      initialStoreState: {
        files: [uploadingRunFile],
      },
      hooksStoreProps: createHooksStoreProps(),
    })

    expect(screen.getByRole('button', { name: 'workflow.singleRun.startRun' })).toBeDisabled()
  })

  it('disables the run button while the workflow is already running', () => {
    rfState.nodes = [createStartNode()]

    renderWorkflowComponent(<InputsPanel onRun={vi.fn()} />, {
      initialStoreState: {
        workflowRunningData: {
          result: {
            status: WorkflowRunningStatus.Running,
            inputs_truncated: false,
            process_data_truncated: false,
            outputs_truncated: false,
          },
          tracing: [],
        },
      },
      hooksStoreProps: createHooksStoreProps(),
    })

    expect(screen.getByRole('button', { name: 'workflow.singleRun.startRun' })).toBeDisabled()
  })
})
