import { render } from '@testing-library/react'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { BlockEnum } from '@/app/components/workflow/types'
import Node from '../node'

vi.mock('reactflow', () => ({
  Handle: (props: { id: string; type: string; className?: string }) => (
    <div
      data-testid="handle"
      data-handleid={props.id}
      data-type={props.type}
      className={props.className}
    />
  ),
  Position: {
    Right: 'right',
  },
}))

describe('workflow preview human input node', () => {
  it('renders one output handle per user action and timeout', () => {
    const props: React.ComponentProps<typeof Node> = {
      id: 'human-input-1',
      type: 'human-input-node',
      selected: false,
      zIndex: 1,
      isConnectable: true,
      dragging: false,
      xPos: 0,
      yPos: 0,
      dragHandle: undefined,
      data: {
        type: BlockEnum.HumanInput,
        title: 'Human Input',
        desc: '',
        delivery_methods: [],
        form_content: '',
        inputs: [],
        user_actions: [
          { id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary },
          { id: 'regenerate', title: 'Regenerate', button_style: UserActionButtonType.Default },
        ],
        timeout: 1,
        timeout_unit: 'hour',
      } as never,
    }

    const { container, getByText } = render(<Node {...props} />)

    expect(getByText('approve')).toBeInTheDocument()
    expect(getByText('regenerate')).toBeInTheDocument()
    expect(getByText('Timeout')).toBeInTheDocument()
    expect(container.querySelector('[data-handleid="approve"]')).toBeInTheDocument()
    expect(container.querySelector('[data-handleid="regenerate"]')).toBeInTheDocument()
    expect(container.querySelector('[data-handleid="__timeout"]')).toBeInTheDocument()
  })
})
