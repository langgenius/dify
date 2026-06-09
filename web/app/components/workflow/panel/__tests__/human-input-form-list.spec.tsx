import type { HumanInputFormData } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CUSTOM_NODE } from '@/app/components/workflow/constants'
import { DeliveryMethodType, UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { InputVarType } from '@/app/components/workflow/types'
import HumanInputFormList from '../human-input-form-list'

const mockNodes: Array<{
  id: string
  type: string
  data: {
    delivery_methods: Array<Record<string, unknown>>
  }
}> = []

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: () => mockNodes,
    }),
  }),
}))

vi.mock('@/context/app-context', () => ({
  useSelector: <T,>(selector: (state: { userProfile: { email: string } }) => T) => selector({
    userProfile: { email: 'debug@example.com' },
  }),
}))

vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
}))

const createFormData = (overrides: Partial<HumanInputFormData> = {}): HumanInputFormData => ({
  form_id: 'form-1',
  node_id: 'human-node-1',
  node_title: 'Need Approval',
  form_content: 'Before {{#$output.reason#}} after',
  inputs: [{
    type: InputVarType.paragraph,
    output_variable_name: 'reason',
    default: {
      selector: [],
      type: 'constant',
      value: 'prefill',
    },
  }],
  actions: [{
    id: 'approve',
    title: 'Approve',
    button_style: UserActionButtonType.Primary,
  }],
  form_token: 'token-1',
  resolved_default_values: {},
  display_in_ui: true,
  expiration_time: 2_000_000_000,
  ...overrides,
})

describe('HumanInputFormList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNodes.splice(0, mockNodes.length)
  })

  it('should render only visible forms, derive delivery method tips, and submit updated inputs', async () => {
    const user = userEvent.setup()
    const onHumanInputFormSubmit = vi.fn().mockResolvedValue(undefined)
    mockNodes.push(
      {
        id: 'human-node-1',
        type: CUSTOM_NODE,
        data: {
          delivery_methods: [{
            id: 'email-1',
            type: DeliveryMethodType.Email,
            enabled: true,
            config: {
              recipients: {
                whole_workspace: false,
                items: [],
              },
              subject: 'Need approval',
              body: 'Please review',
              debug_mode: true,
            },
          }],
        },
      },
      {
        id: 'human-node-2',
        type: CUSTOM_NODE,
        data: {
          delivery_methods: [],
        },
      },
    )

    render(
      <HumanInputFormList
        humanInputFormDataList={[
          createFormData(),
          createFormData({
            form_id: 'form-2',
            node_id: 'human-node-2',
            node_title: 'Hidden Form',
            display_in_ui: false,
          }),
        ]}
        onHumanInputFormSubmit={onHumanInputFormSubmit}
      />,
    )

    expect(screen.getByText('Need Approval')).toBeInTheDocument()
    expect(screen.queryByText('Hidden Form')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('prefill')).toBeInTheDocument()
    expect(screen.getByTestId('expiration-time')).toBeInTheDocument()
    expect(screen.getByTestId('tips')).toBeInTheDocument()

    await user.clear(screen.getByDisplayValue('prefill'))
    await user.type(screen.getByTestId('content-item-textarea'), 'updated reason')
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(onHumanInputFormSubmit).toHaveBeenCalledWith('token-1', {
      inputs: {
        reason: 'updated reason',
      },
      action: 'approve',
    })
  })

  it('should omit delivery tips when the node has no enabled delivery methods', () => {
    mockNodes.push({
      id: 'human-node-1',
      type: CUSTOM_NODE,
      data: {
        delivery_methods: [],
      },
    })

    render(
      <HumanInputFormList
        humanInputFormDataList={[
          createFormData(),
        ]}
      />,
    )

    expect(screen.queryByTestId('tips')).not.toBeInTheDocument()
  })

  it('should render an empty container when there are no visible forms', () => {
    render(
      <HumanInputFormList
        humanInputFormDataList={[]}
      />,
    )

    expect(screen.queryByTestId('content-wrapper')).not.toBeInTheDocument()
  })
})
