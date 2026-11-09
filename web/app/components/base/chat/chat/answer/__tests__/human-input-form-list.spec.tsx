import type {
  DeliveryMethod,
  HumanInputNodeType,
} from '@/app/components/workflow/nodes/human-input/types'
import type { Node } from '@/app/components/workflow/types'
import type { HumanInputFormData } from '@/types/workflow'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  DeliveryMethodType,
  UserActionButtonType,
} from '@/app/components/workflow/nodes/human-input/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import HumanInputFormList from '../human-input-form-list'

const createForm = (overrides: Partial<HumanInputFormData> = {}): HumanInputFormData => ({
  form_id: 'form1',
  node_id: 'node1',
  node_title: 'Visible form',
  form_content: '',
  inputs: [],
  actions: [{ id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary }],
  form_token: 'token',
  resolved_default_values: {},
  display_in_ui: true,
  expiration_time: null,
  ...overrides,
})
const createNode = (deliveryMethods: DeliveryMethod[]): Node<HumanInputNodeType> => ({
  id: 'node1',
  position: { x: 0, y: 0 },
  data: {
    type: BlockEnum.HumanInput,
    title: 'Human input',
    desc: '',
    delivery_methods: deliveryMethods,
    form_content: '',
    inputs: [],
    user_actions: [],
    timeout: 1,
    timeout_unit: 'hour',
  },
})

it('submits only the visible form using its token and action', async () => {
  const user = userEvent.setup()
  const form = createForm()
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  render(
    <HumanInputFormList
      humanInputFormDataList={[
        form,
        createForm({
          form_id: 'hidden',
          node_id: 'node2',
          node_title: 'Hidden form',
          display_in_ui: false,
        }),
      ]}
      onHumanInputFormSubmit={onSubmit}
    />,
  )
  expect(screen.getByText('Visible form')).toBeInTheDocument()
  expect(screen.queryByText('Hidden form')).not.toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: 'Approve' }))
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith('token', { inputs: {}, action: 'approve' })
})

it.each([
  { name: 'missing node', node: undefined, email: false, emailDebug: false, debug: false },
  {
    name: 'no delivery methods',
    node: createNode([]),
    email: false,
    emailDebug: false,
    debug: false,
  },
  {
    name: 'web and debug email',
    node: createNode([
      { id: 'web', type: DeliveryMethodType.WebApp, enabled: true },
      {
        id: 'mail',
        type: DeliveryMethodType.Email,
        enabled: true,
        config: {
          debug_mode: true,
          recipients: { whole_workspace: true, items: [] },
          subject: 'Review',
          body: 'Review form',
        },
      },
    ]),
    email: true,
    emailDebug: true,
    debug: false,
  },
  {
    name: 'disabled delivery',
    node: createNode([
      { id: 'web', type: DeliveryMethodType.WebApp, enabled: false },
      { id: 'mail', type: DeliveryMethodType.Email, enabled: false },
    ]),
    email: false,
    emailDebug: false,
    debug: true,
  },
])('derives form guidance for $name', ({ node, email, emailDebug, debug }) => {
  render(
    <HumanInputFormList
      humanInputFormDataList={[createForm()]}
      getHumanInputNodeData={() => node}
    />,
  )
  const emailTip = screen.queryByText('workflow.common.humanInputEmailTip')
  const emailDebugTip = screen.queryByText(/workflow.common.humanInputEmailTipInDebugMode/)
  const webappTip = screen.queryByText('workflow.common.humanInputWebappTip')
  if (email && !emailDebug) expect(emailTip).toBeInTheDocument()
  else expect(emailTip).not.toBeInTheDocument()
  if (email && emailDebug) expect(emailDebugTip).toBeInTheDocument()
  else expect(emailDebugTip).not.toBeInTheDocument()
  if (debug) expect(webappTip).toBeInTheDocument()
  else expect(webappTip).not.toBeInTheDocument()
})
