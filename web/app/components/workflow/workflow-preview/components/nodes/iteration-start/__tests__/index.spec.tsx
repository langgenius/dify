import { render } from '@testing-library/react'
import IterationStartNode from '..'

vi.mock('reactflow', () => ({
  Handle: (props: { id: string, type: string, className?: string }) => (
    <div data-testid="handle" data-handleid={props.id} data-type={props.type} className={props.className} />
  ),
  Position: {
    Right: 'right',
  },
}))

describe('workflow preview iteration-start node', () => {
  it('renders the start marker and source handle', () => {
    const props: React.ComponentProps<typeof IterationStartNode> = {
      id: 'iteration-start-1',
      type: 'iteration-start-node',
      selected: false,
      zIndex: 1,
      isConnectable: true,
      dragging: false,
      xPos: 0,
      yPos: 0,
      dragHandle: undefined,
      data: {},
    }

    const { container } = render(
      <IterationStartNode {...props} />,
    )

    expect(container.querySelector('[data-handleid="source"]')).toBeInTheDocument()
    expect(container.firstChild).toHaveClass('rounded-2xl')
  })
})
