import type { Shape as HooksStoreShape } from '../../hooks-store/store'
import type { RunFile } from '../../types'
import type { FileUpload } from '@/app/components/base/features/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferMethod } from '@/types/app'
import { FlowType } from '@/types/common'
import { createStartNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import { InputVarType, WorkflowRunningStatus } from '../../types'
import InputsPanel from '../inputs-panel'

const mockCheckInputsForm = vi.fn()
const mockNotify = vi.fn()

vi.mock('next/navigation', () => ({
  useParams: () => ({}),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: (message: string) => mockNotify({ type: 'success', message }),
    error: (message: string) => mockNotify({ type: 'error', message }),
    warning: (message: string) => mockNotify({ type: 'warning', message }),
    info: (message: string) => mockNotify({ type: 'info', message }),
  },
}))

vi.mock('@/app/components/base/chat/chat/check-input-forms-hooks', () => ({
  useCheckInputsForms: () => ({
    checkInputsForm: mockCheckInputsForm,
  }),
}))

const fileSettingsWithImage = {
  enabled: true,
  image: {
    enabled: true,
  },
  allowed_file_upload_methods: [TransferMethod.remote_url],
  number_limits: 3,
  image_file_size_limit: 10,
} satisfies FileUpload & { image_file_size_limit: number }

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

const renderInputsPanel = (
  startNode: ReturnType<typeof createStartNode>,
  options?: Omit<Parameters<typeof renderWorkflowFlowComponent>[1], 'nodes' | 'edges'>,
  onRun = vi.fn(),
) =>
  renderWorkflowFlowComponent(
    <InputsPanel onRun={onRun} />,
    {
      nodes: [startNode],
      edges: [],
      ...options,
    },
  )

describe('InputsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckInputsForm.mockReturnValue(true)
  })

  describe('Rendering', () => {
    it('should render current inputs, defaults, and the image uploader from the start node', () => {
      renderInputsPanel(
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
        {
          initialStoreState: {
            inputs: {
              question: 'overridden question',
            },
          },
          hooksStoreProps: createHooksStoreProps(),
        },
      )

      expect(screen.getByDisplayValue('overridden question')).toHaveFocus()
      expect(screen.getByRole('spinbutton')).toHaveValue(2)
      expect(screen.getByText('common.imageUploader.pasteImageLink')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should update workflow inputs and image files when users edit the form', async () => {
      const user = userEvent.setup()
      const { store } = renderInputsPanel(
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
        {
          hooksStoreProps: createHooksStoreProps(),
        },
      )

      await user.type(screen.getByPlaceholderText('Question'), 'changed question')
      expect(store.getState().inputs).toEqual({ question: 'changed question' })

      await user.click(screen.getByText('common.imageUploader.pasteImageLink'))
      await user.type(
        await screen.findByPlaceholderText('common.imageUploader.pasteImageLinkInputPlaceholder'),
        'https://example.com/image.png',
      )
      await user.click(screen.getByRole('button', { name: 'common.operation.ok' }))

      await waitFor(() => {
        expect(store.getState().files).toEqual([{
          type: 'image',
          transfer_method: TransferMethod.remote_url,
          url: 'https://example.com/image.png',
          upload_file_id: '',
        }])
      })
    })

    it('should not start a run when input validation fails', async () => {
      const user = userEvent.setup()
      mockCheckInputsForm.mockReturnValue(false)
      const onRun = vi.fn()
      const handleRun = vi.fn()

      renderInputsPanel(
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
        {
          hooksStoreProps: createHooksStoreProps({ handleRun }),
        },
        onRun,
      )

      await user.click(screen.getByRole('button', { name: 'workflow.singleRun.startRun' }))

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

    it('should start a run with processed inputs when validation succeeds', async () => {
      const user = userEvent.setup()
      const onRun = vi.fn()
      const handleRun = vi.fn()

      renderInputsPanel(
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
        {
          initialStoreState: {
            inputs: {
              question: 'run this',
              confirmed: 'truthy',
            },
            files: [uploadedRunFile],
          },
          hooksStoreProps: createHooksStoreProps({
            handleRun,
            configsMap: {
              flowId: 'flow-1',
              flowType: FlowType.appFlow,
              fileSettings: {
                enabled: false,
              },
            },
          }),
        },
        onRun,
      )

      await user.click(screen.getByRole('button', { name: 'workflow.singleRun.startRun' }))

      expect(onRun).toHaveBeenCalledTimes(1)
      expect(handleRun).toHaveBeenCalledWith({
        inputs: {
          question: 'run this',
          confirmed: true,
        },
        files: [uploadedRunFile],
      })
    })
  })

  describe('Disabled States', () => {
    it('should disable the run button while a local file is still uploading', () => {
      renderInputsPanel(createStartNode(), {
        initialStoreState: {
          files: [uploadingRunFile],
        },
        hooksStoreProps: createHooksStoreProps({
          configsMap: {
            flowId: 'flow-1',
            flowType: FlowType.appFlow,
            fileSettings: {
              enabled: false,
            },
          },
        }),
      })

      expect(screen.getByRole('button', { name: 'workflow.singleRun.startRun' })).toBeDisabled()
    })

    it('should disable the run button while the workflow is already running', () => {
      renderInputsPanel(createStartNode(), {
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
})
