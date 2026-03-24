import { render, screen } from '@testing-library/react'
import { BlockEnum, NodeRunningStatus } from '../../types'
import SimpleNode from '../index'

let mockNodesReadOnly = false

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: () => ({
    nodesReadOnly: mockNodesReadOnly,
  }),
}))

vi.mock('@/app/components/workflow/block-icon', () => ({
  __esModule: true,
  default: ({ type }: { type: BlockEnum }) => <div>{`block-icon:${type}`}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/node-control', () => ({
  __esModule: true,
  default: ({ id }: { id: string }) => <div>{`node-control:${id}`}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/node-handle', () => ({
  NodeTargetHandle: ({ handleId }: { handleId: string }) => <div>{`node-handle:${handleId}`}</div>,
}))

const createData = (overrides: Record<string, unknown> = {}) => ({
  title: 'Answer',
  desc: '',
  type: BlockEnum.Answer,
  ...overrides,
})

describe('simple-node', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNodesReadOnly = false
  })

  it('should render the block shell, target handle, and node control by default', () => {
    render(
      <SimpleNode
        id="simple-node"
        data={createData()}
      />,
    )

    expect(screen.getByText('Answer')).toBeInTheDocument()
    expect(screen.getByText('block-icon:answer')).toBeInTheDocument()
    expect(screen.getByText('node-handle:target')).toBeInTheDocument()
    expect(screen.getByText('node-control:simple-node')).toBeInTheDocument()
  })

  it('should show the running state border and spinner', () => {
    const { container } = render(
      <SimpleNode
        id="simple-node"
        data={createData({
          _runningStatus: NodeRunningStatus.Running,
        })}
      />,
    )

    expect(container.querySelector('.text-text-accent')).not.toBeNull()
    expect(container.innerHTML).toContain('!border-state-accent-solid')
    expect(screen.queryByText('node-control:simple-node')).not.toBeInTheDocument()
  })

  it('should show success, failed, and exception status indicators', () => {
    const { container, rerender } = render(
      <SimpleNode
        id="simple-node"
        data={createData({
          _runningStatus: NodeRunningStatus.Succeeded,
        })}
      />,
    )

    expect(container.querySelector('.text-text-success')).not.toBeNull()
    expect(container.innerHTML).toContain('!border-state-success-solid')

    rerender(
      <SimpleNode
        id="simple-node"
        data={createData({
          _runningStatus: NodeRunningStatus.Failed,
        })}
      />,
    )

    expect(container.querySelector('.text-text-destructive')).not.toBeNull()
    expect(container.innerHTML).toContain('!border-state-destructive-solid')

    rerender(
      <SimpleNode
        id="simple-node"
        data={createData({
          _runningStatus: NodeRunningStatus.Exception,
        })}
      />,
    )

    expect(container.querySelector('.text-text-warning-secondary')).not.toBeNull()
    expect(container.innerHTML).toContain('!border-state-warning-solid')
  })

  it('should hide handles and controls for candidate or read-only nodes and show selected waiting styles', () => {
    mockNodesReadOnly = true
    const { container } = render(
      <SimpleNode
        id="simple-node"
        data={createData({
          selected: true,
          _waitingRun: true,
          _isCandidate: true,
        })}
      />,
    )

    expect(screen.queryByText('node-handle:target')).not.toBeInTheDocument()
    expect(screen.queryByText('node-control:simple-node')).not.toBeInTheDocument()
    expect(container.querySelector('.border-components-option-card-option-selected-border')).not.toBeNull()
    expect(container.querySelector('.opacity-70')).not.toBeNull()
  })

  it('should show a spinner when a single run is still running', () => {
    const { container } = render(
      <SimpleNode
        id="simple-node"
        data={createData({
          _singleRunningStatus: NodeRunningStatus.Running,
        })}
      />,
    )

    expect(container.querySelector('.animate-spin')).not.toBeNull()
  })
})
