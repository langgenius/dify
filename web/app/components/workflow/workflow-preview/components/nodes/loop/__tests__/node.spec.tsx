import { render, screen } from '@testing-library/react'
import LoopNode from '../node'

const mockHandleNodeLoopRerender = vi.hoisted(() => vi.fn())

vi.mock('reactflow', () => ({
  Background: (props: {
    id: string
  }) => <div data-testid="background" data-id={props.id} />,
  useViewport: () => ({
    zoom: 1,
  }),
  useNodesInitialized: () => true,
}))

vi.mock('../hooks', () => ({
  useNodeLoopInteractions: () => ({
    handleNodeLoopRerender: mockHandleNodeLoopRerender,
  }),
}))

describe('workflow preview loop node', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rerenders the loop bounds once child nodes are initialized', () => {
    render(
      <LoopNode
        id="loop-1"
        data={{} as never}
      />,
    )

    expect(screen.getByTestId('background')).toHaveAttribute('data-id', 'loop-background-loop-1')
    expect(mockHandleNodeLoopRerender).toHaveBeenCalledWith('loop-1')
  })
})
