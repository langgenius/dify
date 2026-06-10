import { render, screen } from '@testing-library/react'
import IterationNode from '../node'

vi.mock('reactflow', () => ({
  Background: (props: {
    id: string
    gap: [number, number]
    size: number
    color: string
  }) => (
    <div
      data-testid="background"
      data-id={props.id}
      data-gap={JSON.stringify(props.gap)}
      data-size={props.size}
      data-color={props.color}
    />
  ),
  useViewport: () => ({
    zoom: 2,
  }),
}))

describe('workflow preview iteration node', () => {
  it('scales the dotted background with the current viewport zoom', () => {
    render(
      <IterationNode
        id="iteration-1"
        data={{} as never}
      />,
    )

    expect(screen.getByTestId('background')).toHaveAttribute('data-id', 'iteration-background-iteration-1')
    expect(screen.getByTestId('background')).toHaveAttribute('data-gap', '[7,7]')
    expect(screen.getByTestId('background')).toHaveAttribute('data-size', '1')
  })
})
