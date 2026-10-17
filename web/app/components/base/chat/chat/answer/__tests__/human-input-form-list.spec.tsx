import type { ComponentProps } from 'react'
import type {
  DeliveryMethod,
  HumanInputNodeType,
} from '@/app/components/workflow/nodes/human-input/types'
import type { Node } from '@/app/components/workflow/types'
import type { HumanInputFormData } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import { DeliveryMethodType } from '@/app/components/workflow/nodes/human-input/types'
import { BlockEnum } from '@/app/components/workflow/types'
import HumanInputFormList from '../human-input-form-list'

type ContentProps = ComponentProps<
  typeof import('../human-input-content/unsubmitted').UnsubmittedHumanInputContent
>
const mockContent = vi.fn<(props: ContentProps) => void>()
// Form filling has its own tests; this list owns visibility and delivery-mode flags.
vi.mock('../human-input-content/unsubmitted', () => ({
  UnsubmittedHumanInputContent: (props: ContentProps) => {
    mockContent(props)
    return null
  },
}))
const createForm = (overrides: Partial<HumanInputFormData> = {}): HumanInputFormData => ({
  form_id: 'form1',
  node_id: 'node1',
  node_title: 'Visible form',
  form_content: '',
  inputs: [],
  actions: [],
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

it('renders only visible forms and forwards the selected form and submit boundary', () => {
  const form = createForm()
  const onSubmit = vi.fn()
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
  expect(mockContent).toHaveBeenCalledOnce()
  expect(mockContent).toHaveBeenCalledWith(expect.objectContaining({ formData: form, onSubmit }))
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
  expect(mockContent).toHaveBeenCalledWith(
    expect.objectContaining({
      showEmailTip: email,
      isEmailDebugMode: emailDebug,
      showDebugModeTip: debug,
    }),
  )
})
