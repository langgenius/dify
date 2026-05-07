import type { PropsWithChildren } from 'react'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { fireEvent, screen } from '@testing-library/react'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'
import BaseNode from '../node'

const mockHasNodeInspectVars = vi.fn()
const mockUseNodePluginInstallation = vi.fn()
const mockHandleNodeIterationChildSizeChange = vi.fn()
const mockHandleNodeLoopChildSizeChange = vi.fn()
const mockUseNodeResizeObserver = vi.fn()
const mockUseCollaboration = vi.fn()

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: false }),
  useToolIcon: () => undefined,
}))

vi.mock('@/app/components/workflow/collaboration/hooks/use-collaboration', () => ({
  useCollaboration: (...args: unknown[]) => mockUseCollaboration(...args),
}))

vi.mock('@/app/components/workflow/hooks/use-inspect-vars-crud', () => ({
  default: () => ({
    hasNodeInspectVars: mockHasNodeInspectVars,
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-node-plugin-installation', () => ({
  useNodePluginInstallation: (...args: unknown[]) => mockUseNodePluginInstallation(...args),
}))

vi.mock('@/app/components/workflow/nodes/iteration/use-interactions', () => ({
  useNodeIterationInteractions: () => ({
    handleNodeIterationChildSizeChange: mockHandleNodeIterationChildSizeChange,
  }),
}))

vi.mock('@/app/components/workflow/nodes/loop/use-interactions', () => ({
  useNodeLoopInteractions: () => ({
    handleNodeLoopChildSizeChange: mockHandleNodeLoopChildSizeChange,
  }),
}))

vi.mock('../use-node-resize-observer', () => ({
  default: (options: { enabled: boolean, onResize: () => void }) => {
    mockUseNodeResizeObserver(options)
    if (options.enabled)
      options.onResize()
  },
}))

vi.mock('../components/add-variable-popup-with-position', () => ({
  default: () => <div data-testid="add-var-popup" />,
}))
vi.mock('../components/entry-node-container', () => ({
  __esModule: true,
  StartNodeTypeEnum: { Start: 'start', Trigger: 'trigger' },
  default: ({ children }: PropsWithChildren) => <div data-testid="entry-node-container">{children}</div>,
}))
vi.mock('../components/error-handle/error-handle-on-node', () => ({
  default: () => <div data-testid="error-handle-node" />,
}))
vi.mock('../components/node-control', () => ({
  default: () => <div data-testid="node-control" />,
}))
vi.mock('../components/node-handle', () => ({
  NodeSourceHandle: () => <div data-testid="node-source-handle" />,
  NodeTargetHandle: () => <div data-testid="node-target-handle" />,
}))
vi.mock('../components/node-resizer', () => ({
  default: () => <div data-testid="node-resizer" />,
}))
vi.mock('../components/retry/retry-on-node', () => ({
  default: () => <div data-testid="retry-node" />,
}))
vi.mock('@/app/components/workflow/block-icon', () => ({
  default: () => <div data-testid="block-icon" />,
}))
vi.mock('@/app/components/workflow/nodes/tool/components/copy-id', () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}))

const createData = (overrides: Record<string, unknown> = {}) => ({
  type: BlockEnum.Tool,
  title: 'Node title',
  desc: 'Node description',
  selected: false,
  width: 280,
  height: 180,
  provider_type: 'builtin',
  provider_id: 'tool-1',
  _runningStatus: undefined,
  _singleRunningStatus: undefined,
  ...overrides,
})

const toNodeData = (data: ReturnType<typeof createData>) => data as CommonNodeType

describe('BaseNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasNodeInspectVars.mockReturnValue(false)
    mockUseNodeResizeObserver.mockReset()
    mockUseCollaboration.mockReturnValue({ nodePanelPresence: {} })
    mockUseNodePluginInstallation.mockReturnValue({
      shouldDim: false,
      isChecking: false,
      isMissing: false,
      canInstall: false,
      uniqueIdentifier: undefined,
    })
  })

  it('should render content, handles and description for a regular node', () => {
    renderWorkflowComponent(
      <BaseNode id="node-1" data={toNodeData(createData())}>
        <div>Body</div>
      </BaseNode>,
    )

    expect(screen.getByText('Node title')).toBeInTheDocument()
    expect(screen.getByText('Node description')).toBeInTheDocument()
    expect(screen.getByTestId('node-control')).toBeInTheDocument()
    expect(screen.getByTestId('node-source-handle')).toBeInTheDocument()
    expect(screen.getByTestId('node-target-handle')).toBeInTheDocument()
  })

  it('should render entry nodes inside the entry container', () => {
    renderWorkflowComponent(
      <BaseNode id="node-1" data={toNodeData(createData({ type: BlockEnum.Start }))}>
        <div>Body</div>
      </BaseNode>,
    )

    expect(screen.getByTestId('entry-node-container')).toBeInTheDocument()
  })

  it('should block interaction when plugin installation is required', () => {
    mockUseNodePluginInstallation.mockReturnValue({
      shouldDim: false,
      isChecking: false,
      isMissing: true,
      canInstall: true,
      uniqueIdentifier: 'plugin-1',
    })

    renderWorkflowComponent(
      <BaseNode id="node-1" data={toNodeData(createData())}>
        <div>Body</div>
      </BaseNode>,
    )

    const overlay = screen.getByTestId('workflow-node-install-overlay')
    expect(overlay).toBeInTheDocument()
    fireEvent.click(overlay)
  })

  it('should render running status indicators for loop nodes', () => {
    renderWorkflowComponent(
      <BaseNode
        id="node-1"
        data={toNodeData(createData({
          type: BlockEnum.Loop,
          _loopIndex: 3,
          _runningStatus: NodeRunningStatus.Running,
          width: 320,
          height: 220,
        }))}
      >
        <div>Loop body</div>
      </BaseNode>,
    )

    expect(screen.getByText(/workflow\.nodes\.loop\.currentLoopCount/)).toBeInTheDocument()
    expect(screen.getByTestId('node-resizer')).toBeInTheDocument()
  })

  it('should render an iteration node resizer and dimmed overlay', () => {
    mockUseNodePluginInstallation.mockReturnValue({
      shouldDim: true,
      isChecking: false,
      isMissing: false,
      canInstall: false,
      uniqueIdentifier: undefined,
    })

    renderWorkflowComponent(
      <BaseNode
        id="node-1"
        data={toNodeData(createData({
          type: BlockEnum.Iteration,
          selected: true,
          isInIteration: true,
        }))}
      >
        <div>Iteration body</div>
      </BaseNode>,
    )

    expect(screen.getByTestId('node-resizer')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-node-install-overlay')).toBeInTheDocument()
    expect(mockHandleNodeIterationChildSizeChange).toHaveBeenCalledWith('node-1')
  })

  it('should trigger loop resize updates when the selected node is inside a loop', () => {
    renderWorkflowComponent(
      <BaseNode
        id="node-2"
        data={toNodeData(createData({
          type: BlockEnum.Loop,
          selected: true,
          isInLoop: true,
        }))}
      >
        <div>Loop body</div>
      </BaseNode>,
    )

    expect(mockHandleNodeLoopChildSizeChange).toHaveBeenCalledWith('node-2')
    expect(mockUseNodeResizeObserver).toHaveBeenCalledTimes(2)
  })

  it('should keep viewer avatars outside the truncated title area', () => {
    const longTitle = 'This is a very long node title that should truncate before it clips the viewer avatars'
    mockUseCollaboration.mockReturnValue({
      nodePanelPresence: {
        'node-1': {
          'client-1': {
            userId: 'viewer-1',
            username: 'Zed',
            avatar: null,
            clientId: 'client-1',
            timestamp: Date.now(),
          },
        },
      },
    })

    renderWorkflowComponent(
      <BaseNode id="node-1" data={toNodeData(createData({ title: longTitle }))}>
        <div>Body</div>
      </BaseNode>,
    )

    const titleContainer = screen.getByTitle(longTitle)
    expect(titleContainer).toHaveClass('min-w-0', 'grow', 'truncate')
    expect(titleContainer?.nextElementSibling).toHaveClass('shrink-0')
    expect(screen.getByText('Z')).toBeInTheDocument()
  })
})
