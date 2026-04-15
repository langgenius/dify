import { render, screen } from '@testing-library/react'
import { Position } from 'reactflow'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import CustomEdge from '../custom-edge'

vi.mock('reactflow', () => ({
  BaseEdge: (props: {
    id: string
    path: string
    style: {
      stroke: string
      strokeWidth: number
      opacity: number
    }
  }) => (
    <div
      data-testid="base-edge"
      data-id={props.id}
      data-path={props.path}
      data-stroke={props.style.stroke}
      data-stroke-width={props.style.strokeWidth}
      data-opacity={props.style.opacity}
    />
  ),
  getBezierPath: () => ['M 0 0'],
  Position: {
    Right: 'right',
    Left: 'left',
  },
}))

describe('workflow preview custom edge', () => {
  it('renders a gradient edge when both ends have finished statuses', () => {
    const edgeProps: React.ComponentProps<typeof CustomEdge> = {
      id: 'edge-1',
      source: 'source-node',
      target: 'target-node',
      sourceX: 100,
      sourceY: 120,
      targetX: 260,
      targetY: 120,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      selected: false,
      data: {
        _sourceRunningStatus: NodeRunningStatus.Succeeded,
        _targetRunningStatus: NodeRunningStatus.Running,
        _waitingRun: true,
      } as never,
    }

    const { container } = render(
      <svg>
        <CustomEdge {...edgeProps} />
      </svg>,
    )

    expect(container.querySelector('linearGradient#edge-1')).toBeInTheDocument()
    expect(screen.getByTestId('base-edge')).toHaveAttribute('data-stroke', 'url(#edge-1)')
    expect(screen.getByTestId('base-edge')).toHaveAttribute('data-opacity', '0.7')
  })

  it('prefers the running stroke color when the edge is selected', () => {
    const edgeProps: React.ComponentProps<typeof CustomEdge> = {
      id: 'edge-selected',
      source: 'source-node',
      target: 'target-node',
      sourceX: 0,
      sourceY: 0,
      targetX: 100,
      targetY: 100,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      selected: true,
      data: {
        _sourceRunningStatus: NodeRunningStatus.Succeeded,
        _targetRunningStatus: NodeRunningStatus.Succeeded,
      } as never,
    }

    render(
      <svg>
        <CustomEdge {...edgeProps} />
      </svg>,
    )

    expect(screen.getByTestId('base-edge')).toHaveAttribute('data-stroke', 'var(--color-workflow-link-line-handle)')
  })
})
