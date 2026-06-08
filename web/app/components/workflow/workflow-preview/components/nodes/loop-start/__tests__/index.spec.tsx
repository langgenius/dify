import { render } from '@testing-library/react'
import LoopStartNode from '..'

vi.mock('reactflow', () => ({
  Handle: (props: { id: string, type: string, className?: string }) => (
    <div data-testid="handle" data-handleid={props.id} data-type={props.type} className={props.className} />
  ),
  Position: {
    Right: 'right',
  },
}))

describe('workflow preview loop-start node', () => {
  it('renders the start marker and source handle', () => {
    const props: React.ComponentProps<typeof LoopStartNode> = {
      id: 'loop-start-1',
      type: 'loop-start-node',
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
      <LoopStartNode {...props} />,
    )

    expect(container.querySelector('[data-handleid="source"]')).toBeInTheDocument()
    expect(container.firstChild).toHaveClass('rounded-2xl')
  })
})
