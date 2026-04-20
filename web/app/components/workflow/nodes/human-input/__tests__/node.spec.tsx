import type { HumanInputNodeType } from '../types'
import { render, screen } from '@testing-library/react'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import Node from '../node'
import { DeliveryMethodType, UserActionButtonType } from '../types'

vi.mock('../../_base/components/node-handle', () => ({
  NodeSourceHandle: (props: { handleId: string }) => <div>{`handle:${props.handleId}`}</div>,
}))

const createData = (overrides: Partial<HumanInputNodeType> = {}): HumanInputNodeType => ({
  title: 'Human Input',
  desc: '',
  type: BlockEnum.HumanInput,
  delivery_methods: [{
    id: 'dm-webapp',
    type: DeliveryMethodType.WebApp,
    enabled: true,
  }, {
    id: 'dm-email',
    type: DeliveryMethodType.Email,
    enabled: true,
  }],
  form_content: 'Please review this request',
  inputs: [{
    type: InputVarType.textInput,
    output_variable_name: 'review_result',
    default: {
      selector: [],
      type: 'constant',
      value: '',
    },
  }],
  user_actions: [{
    id: 'approve',
    title: 'Approve',
    button_style: UserActionButtonType.Primary,
  }, {
    id: 'reject',
    title: 'Reject',
    button_style: UserActionButtonType.Default,
  }],
  timeout: 3,
  timeout_unit: 'day',
  ...overrides,
})

describe('human-input/node', () => {
  it('renders delivery methods, user action handles, and the timeout handle', () => {
    render(
      <Node
        id="human-input-node"
        data={createData()}
      />,
    )

    expect(screen.getByText('workflow.nodes.humanInput.deliveryMethod.title')).toBeInTheDocument()
    expect(screen.getByText('webapp')).toBeInTheDocument()
    expect(screen.getByText('email')).toBeInTheDocument()
    expect(screen.getByText('approve')).toBeInTheDocument()
    expect(screen.getByText('reject')).toBeInTheDocument()
    expect(screen.getByText('Timeout')).toBeInTheDocument()
    expect(screen.getByText('handle:approve')).toBeInTheDocument()
    expect(screen.getByText('handle:reject')).toBeInTheDocument()
    expect(screen.getByText('handle:__timeout')).toBeInTheDocument()
  })

  it('keeps the timeout handle when delivery methods and actions are empty', () => {
    render(
      <Node
        id="human-input-node"
        data={createData({
          delivery_methods: [],
          user_actions: [],
        })}
      />,
    )

    expect(screen.queryByText('workflow.nodes.humanInput.deliveryMethod.title')).not.toBeInTheDocument()
    expect(screen.getByText('Timeout')).toBeInTheDocument()
    expect(screen.getByText('handle:__timeout')).toBeInTheDocument()
  })
})
