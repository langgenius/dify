import type { ComponentProps } from 'react'
import { render } from '@testing-library/react'
import { getBezierPath, Position } from 'reactflow'
import CustomConnectionLine from '../custom-connection-line'

const createConnectionLineProps = (
  overrides: Partial<ComponentProps<typeof CustomConnectionLine>> = {},
): ComponentProps<typeof CustomConnectionLine> => ({
  fromX: 10,
  fromY: 20,
  toX: 70,
  toY: 80,
  fromPosition: Position.Right,
  toPosition: Position.Left,
  connectionLineType: undefined,
  connectionStatus: null,
  ...overrides,
} as ComponentProps<typeof CustomConnectionLine>)

describe('CustomConnectionLine', () => {
  it('should render the bezier path and target marker', () => {
    const [expectedPath] = getBezierPath({
      sourceX: 10,
      sourceY: 20,
      sourcePosition: Position.Right,
      targetX: 70,
      targetY: 80,
      targetPosition: Position.Left,
      curvature: 0.16,
    })

    const { container } = render(
      <svg>
        <CustomConnectionLine {...createConnectionLineProps()} />
      </svg>,
    )

    const path = container.querySelector('path')
    const marker = container.querySelector('rect')

    expect(path).toHaveAttribute('fill', 'none')
    expect(path).toHaveAttribute('stroke', '#D0D5DD')
    expect(path).toHaveAttribute('stroke-width', '2')
    expect(path).toHaveAttribute('d', expectedPath)

    expect(marker).toHaveAttribute('x', '70')
    expect(marker).toHaveAttribute('y', '76')
    expect(marker).toHaveAttribute('width', '2')
    expect(marker).toHaveAttribute('height', '8')
    expect(marker).toHaveAttribute('fill', '#2970FF')
  })

  it('should update the path when the endpoints change', () => {
    const [expectedPath] = getBezierPath({
      sourceX: 30,
      sourceY: 40,
      sourcePosition: Position.Right,
      targetX: 160,
      targetY: 200,
      targetPosition: Position.Left,
      curvature: 0.16,
    })

    const { container } = render(
      <svg>
        <CustomConnectionLine
          {...createConnectionLineProps({
            fromX: 30,
            fromY: 40,
            toX: 160,
            toY: 200,
          })}
        />
      </svg>,
    )

    expect(container.querySelector('path')).toHaveAttribute('d', expectedPath)
    expect(container.querySelector('rect')).toHaveAttribute('x', '160')
    expect(container.querySelector('rect')).toHaveAttribute('y', '196')
  })
})
