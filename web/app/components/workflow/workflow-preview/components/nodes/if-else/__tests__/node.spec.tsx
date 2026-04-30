import { render } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import Node from '../node'

vi.mock('reactflow', () => ({
  Handle: (props: { id: string, type: string, className?: string }) => (
    <div data-testid="handle" data-handleid={props.id} data-type={props.type} className={props.className} />
  ),
  Position: {
    Right: 'right',
  },
}))

describe('workflow preview if-else node', () => {
  it('shows the condition-not-setup state for incomplete cases', () => {
    const props: React.ComponentProps<typeof Node> = {
      id: 'if-else-1',
      type: 'if-else-node',
      selected: false,
      zIndex: 1,
      isConnectable: true,
      dragging: false,
      xPos: 0,
      yPos: 0,
      dragHandle: undefined,
      data: {
        type: BlockEnum.IfElse,
        title: 'If else',
        desc: '',
        isInIteration: false,
        isInLoop: false,
        cases: [
          {
            case_id: 'case-1',
            logical_operator: 'and',
            conditions: [
              {
                id: 'condition-1',
                variable_selector: [],
                comparison_operator: 'contains',
                value: 'hello',
              },
            ],
          },
        ],
      } as never,
    }

    const { container, getByText } = render(
      <Node {...props} />,
    )

    expect(getByText('workflow.nodes.ifElse.conditionNotSetup')).toBeInTheDocument()
    expect(container.querySelector('[data-handleid="case-1"]')).toBeInTheDocument()
    expect(container.querySelector('[data-handleid="false"]')).toBeInTheDocument()
  })
})
