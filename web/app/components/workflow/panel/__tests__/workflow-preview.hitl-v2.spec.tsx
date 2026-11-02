import type { HumanInputFormData } from '@/types/workflow'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNode, createWorkflowRunningData } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import {
  DeliveryMethodType,
  UserActionButtonType,
} from '@/app/components/workflow/nodes/human-input/types'
import { BlockEnum, InputVarType, WorkflowRunningStatus } from '@/app/components/workflow/types'
import { submitHumanInputForm } from '@/service/workflow'
import WorkflowPreview from '../workflow-preview'

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  ENABLE_HITL_IM: true,
}))
vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  submitHumanInputForm: vi.fn(),
}))

const mockSubmitHumanInputForm = vi.mocked(submitHumanInputForm)
type WorkflowResult = NonNullable<ReturnType<typeof createWorkflowRunningData>['result']>

const createWorkflowResult = (overrides: Partial<WorkflowResult> = {}): WorkflowResult => ({
  status: WorkflowRunningStatus.Paused,
  inputs_truncated: false,
  process_data_truncated: false,
  outputs_truncated: false,
  files: [],
  ...overrides,
})

const createHumanInputFormData = (
  version: HumanInputFormData['form_version'],
): HumanInputFormData => ({
  form_id: 'form-1',
  node_id: 'human-node-1',
  node_title: 'Need Approval',
  form_content: 'Name {{#$output.name#}} Reason {{#$output.reason#}}',
  inputs: [
    {
      type: InputVarType.paragraph,
      output_variable_name: 'name',
      default: { type: 'constant', value: '', selector: [] },
    },
    {
      type: InputVarType.paragraph,
      output_variable_name: 'reason',
      default: { type: 'constant', value: '', selector: [] },
    },
  ],
  actions: [{ id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary }],
  form_token: 'form-token',
  form_version: version,
  resolved_default_values: {},
  display_in_ui: true,
  expiration_time: null,
})

const createHumanInputNodeData = (version: '1' | '2') => ({
  title: 'Need Approval',
  desc: '',
  type: BlockEnum.HumanInput,
  version,
  form_content: 'Name {{#$output.name#}} Reason {{#$output.reason#}}',
  inputs: [],
  user_actions: [{ id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary }],
  timeout: 3,
  timeout_unit: 'day',
  ...(version === '2'
    ? {
        recipients_spec: [],
        message_template: { subject: '', body: '' },
        debug_mode: { enabled: false, channels: [] },
      }
    : {
        delivery_methods: [{ id: 'webapp', type: DeliveryMethodType.WebApp, enabled: true }],
      }),
})

describe('WorkflowPreview HITL submission versions', () => {
  it.each([undefined, '1', '2'] as const)(
    'submits the actual paused form with event version %s',
    async (version) => {
      mockSubmitHumanInputForm.mockResolvedValue({ result: 'success' })
      const user = userEvent.setup()
      const nodeVersion = version === '2' ? '1' : '2'
      renderWorkflowFlowComponent(<WorkflowPreview />, {
        nodes: [
          createNode({
            id: 'human-node-1',
            type: 'default',
            data: createHumanInputNodeData(nodeVersion),
          }),
        ],
        initialStoreState: {
          workflowRunningData: createWorkflowRunningData({
            result: createWorkflowResult(),
            humanInputFormDataList: [createHumanInputFormData(version)],
            humanInputFilledFormDataList: [],
          }),
        },
      })

      await user.type(screen.getByRole('textbox', { name: 'name' }), 'Ada')
      await user.type(screen.getByRole('textbox', { name: 'reason' }), 'Ready to ship')
      await user.click(screen.getByRole('button', { name: 'Approve' }))

      await waitFor(() =>
        expect(mockSubmitHumanInputForm).toHaveBeenCalledWith(
          'form-token',
          {
            inputs: { name: 'Ada', reason: 'Ready to ship' },
            action: 'approve',
          },
          version,
        ),
      )
    },
  )
})
