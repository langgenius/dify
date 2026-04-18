import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Position } from 'reactflow'
import { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'
import CustomEdge from '../custom-edge'
import { BlockEnum, NodeRunningStatus } from '../types'

const mockUseAvailableBlocks = vi.hoisted(() => vi.fn())
const mockUseNodesInteractions = vi.hoisted(() => vi.fn())
const mockBlockSelector = vi.hoisted(() => vi.fn())
const mockGradientRender = vi.hoisted(() => vi.fn())

vi.mock('reactflow', () => ({
  BaseEdge: (props: {
    id: string
    path: string
    style: {
      stroke: string
      strokeWidth: number
      opacity: number
      strokeDasharray?: string
    }
  }) => (
    <div
      data-testid="base-edge"
      data-id={props.id}
      data-path={props.path}
      data-stroke={props.style.stroke}
      data-stroke-width={props.style.strokeWidth}
      data-opacity={props.style.opacity}
      data-dasharray={props.style.strokeDasharray}
    />
  ),
  EdgeLabelRenderer: ({ children }: { children?: ReactNode }) => <div data-testid="edge-label">{children}</div>,
  getBezierPath: () => ['M 0 0', 24, 48],
  Position: {
    Right: 'right',
    Left: 'left',
  },
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useAvailableBlocks: (...args: unknown[]) => mockUseAvailableBlocks(...args),
  useNodesInteractions: () => mockUseNodesInteractions(),
}))

vi.mock('@/app/components/workflow/block-selector', () => ({
  __esModule: true,
  default: (props: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSelect: (nodeType: string, pluginDefaultValue?: Record<string, unknown>) => void
    availableBlocksTypes: string[]
    triggerClassName?: () => string
  }) => {
    mockBlockSelector(props)
    return (
      <button
        type="button"
        data-testid="block-selector"
        data-trigger-class={props.triggerClassName?.()}
        onClick={() => {
          props.onOpenChange(true)
          props.onSelect('llm', { provider: 'openai' })
        }}
      >
        {props.availableBlocksTypes.join(',')}
      </button>
    )
  },
}))

vi.mock('@/app/components/workflow/custom-edge-linear-gradient-render', () => ({
  __esModule: true,
  default: (props: {
    id: string
    startColor: string
    stopColor: string
  }) => {
    mockGradientRender(props)
    return <div data-testid="edge-gradient">{props.id}</div>
  },
}))

describe('CustomEdge', () => {
  const mockHandleNodeAdd = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseNodesInteractions.mockReturnValue({
      handleNodeAdd: mockHandleNodeAdd,
    })
    mockUseAvailableBlocks.mockImplementation((nodeType: BlockEnum) => {
      if (nodeType === BlockEnum.Code)
        return { availablePrevBlocks: ['code', 'llm'] }

      return { availableNextBlocks: ['llm', 'tool'] }
    })
  })

  it('should render a gradient edge and insert a node between the source and target', () => {
    render(
      <CustomEdge
        id="edge-1"
        source="source-node"
        sourceHandleId="source"
        target="target-node"
        targetHandleId="target"
        sourceX={100}
        sourceY={120}
        sourcePosition={Position.Right}
        targetX={300}
        targetY={220}
        targetPosition={Position.Left}
        selected={false}
        data={{
          sourceType: BlockEnum.Start,
          targetType: BlockEnum.Code,
          _sourceRunningStatus: NodeRunningStatus.Succeeded,
          _targetRunningStatus: NodeRunningStatus.Failed,
          _hovering: true,
          _waitingRun: true,
          _dimmed: true,
          _isTemp: true,
          isInIteration: true,
          isInLoop: true,
        } as never}
      />,
    )

    expect(screen.getByTestId('edge-gradient')).toHaveTextContent('edge-1')
    expect(mockGradientRender).toHaveBeenCalledWith(expect.objectContaining({
      id: 'edge-1',
      startColor: 'var(--color-workflow-link-line-success-handle)',
      stopColor: 'var(--color-workflow-link-line-error-handle)',
    }))
    expect(screen.getByTestId('base-edge')).toHaveAttribute('data-stroke', 'url(#edge-1)')
    expect(screen.getByTestId('base-edge')).toHaveAttribute('data-opacity', '0.3')
    expect(screen.getByTestId('base-edge')).toHaveAttribute('data-dasharray', '8 8')
    expect(screen.getByTestId('block-selector')).toHaveTextContent('llm')
    expect(screen.getByTestId('block-selector').parentElement).toHaveStyle({
      transform: 'translate(-50%, -50%) translate(24px, 48px)',
      opacity: '0.7',
    })

    fireEvent.click(screen.getByTestId('block-selector'))

    expect(mockHandleNodeAdd).toHaveBeenCalledWith(
      {
        nodeType: 'llm',
        pluginDefaultValue: { provider: 'openai' },
      },
      {
        prevNodeId: 'source-node',
        prevNodeSourceHandle: 'source',
        nextNodeId: 'target-node',
        nextNodeTargetHandle: 'target',
      },
    )
  })

  it('should prefer the running stroke color when the edge is selected', () => {
    render(
      <CustomEdge
        id="edge-selected"
        source="source-node"
        target="target-node"
        sourceX={0}
        sourceY={0}
        sourcePosition={Position.Right}
        targetX={100}
        targetY={100}
        targetPosition={Position.Left}
        selected
        data={{
          sourceType: BlockEnum.Start,
          targetType: BlockEnum.Code,
          _sourceRunningStatus: NodeRunningStatus.Succeeded,
          _targetRunningStatus: NodeRunningStatus.Running,
        } as never}
      />,
    )

    expect(screen.getByTestId('base-edge')).toHaveAttribute('data-stroke', 'var(--color-workflow-link-line-handle)')
  })

  it('should use the fail-branch running color while the connected node is hovering', () => {
    render(
      <CustomEdge
        id="edge-hover"
        source="source-node"
        sourceHandleId={ErrorHandleTypeEnum.failBranch}
        target="target-node"
        sourceX={0}
        sourceY={0}
        sourcePosition={Position.Right}
        targetX={100}
        targetY={100}
        targetPosition={Position.Left}
        selected={false}
        data={{
          sourceType: BlockEnum.Start,
          targetType: BlockEnum.Code,
          _connectedNodeIsHovering: true,
        } as never}
      />,
    )

    expect(screen.getByTestId('base-edge')).toHaveAttribute('data-stroke', 'var(--color-workflow-link-line-failure-handle)')
  })

  it('should fall back to the default edge color when no highlight state is active', () => {
    render(
      <CustomEdge
        id="edge-default"
        source="source-node"
        target="target-node"
        sourceX={0}
        sourceY={0}
        sourcePosition={Position.Right}
        targetX={100}
        targetY={100}
        targetPosition={Position.Left}
        selected={false}
        data={{
          sourceType: BlockEnum.Start,
          targetType: BlockEnum.Code,
        } as never}
      />,
    )

    expect(screen.getByTestId('base-edge')).toHaveAttribute('data-stroke', 'var(--color-workflow-link-line-normal)')
    expect(screen.getByTestId('block-selector')).toHaveAttribute('data-trigger-class', 'hover:scale-150 transition-all')
  })
})
