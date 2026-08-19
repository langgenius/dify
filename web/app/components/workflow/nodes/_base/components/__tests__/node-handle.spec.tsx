import type { ReactNode } from 'react'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { NodeSourceHandle, NodeTargetHandle } from '../node-handle'

type MockHooksState = {
  availablePrevBlocks: BlockEnum[]
  availableNextBlocks: BlockEnum[]
  isChatMode: boolean
  isReadOnly: boolean
}

type MockStoreState = {
  dataSourceList: unknown[]
  nodes: unknown[]
  shouldAutoOpenStartNodeSelector: boolean
  setShouldAutoOpenStartNodeSelector?: (open: boolean) => void
  setHasSelectedStartNode?: (selected: boolean) => void
}

const {
  mockHandleNodeAdd,
  mockSetShouldAutoOpenStartNodeSelector,
  mockSetHasSelectedStartNode,
  mockWorkflowStoreSetState,
  mockHooksState,
  mockStoreState,
} = vi.hoisted(() => {
  const mockHooksState: MockHooksState = {
    availablePrevBlocks: [],
    availableNextBlocks: [],
    isChatMode: false,
    isReadOnly: false,
  }
  const mockStoreState: MockStoreState = {
    dataSourceList: [],
    nodes: [],
    shouldAutoOpenStartNodeSelector: false,
    setShouldAutoOpenStartNodeSelector: undefined,
    setHasSelectedStartNode: undefined,
  }

  return {
    mockHandleNodeAdd: vi.fn(),
    mockSetShouldAutoOpenStartNodeSelector: vi.fn(),
    mockSetHasSelectedStartNode: vi.fn(),
    mockWorkflowStoreSetState: vi.fn(),
    mockHooksState,
    mockStoreState,
  }
})

type HandleProps = {
  id?: string
  className?: string
  children?: ReactNode
  onClick?: () => void
}

vi.mock('reactflow', () => ({
  Handle: ({ id, className, children, onClick }: HandleProps) => (
    <div
      data-testid={`handle-${id ?? 'unknown'}`}
      data-handleid={id}
      className={className}
      onClick={onClick}
    >
      {children}
    </div>
  ),
  Position: {
    Left: 'left',
    Right: 'right',
  },
  useStoreApi: () => ({
    getState: () => ({ getNodes: () => [] }),
  }),
}))

vi.mock('../../../../hooks/use-available-blocks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../hooks/use-available-blocks')>()

  return {
    ...actual,
    useAvailableBlocks: () => ({
      availablePrevBlocks: mockHooksState.availablePrevBlocks,
      availableNextBlocks: mockHooksState.availableNextBlocks,
    }),
  }
})

vi.mock('../../../../hooks/use-nodes-interactions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../hooks/use-nodes-interactions')>()

  return {
    ...actual,
    useNodesInteractions: () => ({
      handleNodeAdd: mockHandleNodeAdd,
    }),
  }
})

vi.mock('../../../../hooks/use-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../hooks/use-workflow')>()

  return {
    ...actual,
    useIsChatMode: () => mockHooksState.isChatMode,
    useNodesReadOnly: () => ({
      getNodesReadOnly: () => mockHooksState.isReadOnly,
    }),
  }
})

vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(selector: (state: MockStoreState) => T) => selector(mockStoreState),
  useWorkflowStore: () => ({
    setState: mockWorkflowStoreSetState,
  }),
}))

vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      configsMap: { flowType: 'app-flow' },
      availableNodesMetaData: { nodes: [] },
    }),
}))

vi.mock('@/service/use-plugins', () => ({
  useFeaturedToolsRecommendations: () => ({ plugins: [], isLoading: false }),
  useFeaturedTriggersRecommendations: () => ({ plugins: [], isLoading: false }),
}))

vi.mock('@/service/use-triggers', () => ({
  useAllTriggerPlugins: () => ({ data: [] }),
  useInvalidateAllTriggerPlugins: () => vi.fn(),
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: [] }),
  useAllCustomTools: () => ({ data: [] }),
  useAllWorkflowTools: () => ({ data: [] }),
  useAllMCPTools: () => ({ data: [] }),
  useInvalidateAllBuiltInTools: () => vi.fn(),
}))

vi.mock('@/app/components/plugins/marketplace/query', () => ({
  useMarketplacePlugins: () => ({ data: undefined }),
}))

const createNodeData = (overrides: Partial<CommonNodeType> = {}): CommonNodeType => ({
  type: BlockEnum.Code,
  title: 'Node',
  desc: '',
  selected: false,
  ...overrides,
})

const getAddNodeButton = () => screen.getByRole('button', { name: 'workflow.common.addBlock' })
const queryAddNodeButton = () => screen.queryByRole('button', { name: 'workflow.common.addBlock' })

const renderTargetHandle = (dataOverrides: Partial<CommonNodeType> = {}) => {
  return render(
    <NodeTargetHandle
      id="target-node"
      data={createNodeData(dataOverrides)}
      handleId="target-handle"
      nodeSelectorClassName="custom-selector"
      handleClassName="custom-target-handle"
    />,
  )
}

const renderSourceHandle = (
  dataOverrides: Partial<CommonNodeType> = {},
  propsOverrides: Partial<React.ComponentProps<typeof NodeSourceHandle>> = {},
) => {
  return render(
    <NodeSourceHandle
      id="source-node"
      data={createNodeData(dataOverrides)}
      handleId="source-handle"
      nodeSelectorClassName="custom-selector"
      handleClassName="custom-source-handle"
      {...propsOverrides}
    />,
  )
}

describe('node-handle', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockHooksState.availablePrevBlocks = [BlockEnum.Code]
    mockHooksState.availableNextBlocks = [BlockEnum.Code]
    mockHooksState.isChatMode = false
    mockHooksState.isReadOnly = false

    mockStoreState.shouldAutoOpenStartNodeSelector = false
    mockStoreState.setShouldAutoOpenStartNodeSelector = mockSetShouldAutoOpenStartNodeSelector
    mockStoreState.setHasSelectedStartNode = mockSetHasSelectedStartNode
  })

  // Target-side tests cover selector visibility, connection locking, and status rendering.
  describe('NodeTargetHandle', () => {
    it('should toggle the target add trigger', () => {
      renderTargetHandle()

      const handle = screen.getByTestId('handle-target-handle')
      const addNodeButton = getAddNodeButton()

      expect(addNodeButton).toHaveClass('custom-selector')
      expect(addNodeButton).toHaveClass('opacity-0')
      expect(addNodeButton).toHaveClass('pointer-events-none')

      fireEvent.click(addNodeButton)

      expect(addNodeButton).toHaveAttribute('data-popup-open')
      // Trigger stays pointer-events-none so it never steals mousedown from
      // the underlying React Flow handle (drag-to-connect must keep working).
      expect(addNodeButton).toHaveClass('pointer-events-none')

      fireEvent.click(handle)

      expect(addNodeButton).not.toHaveAttribute('data-popup-open')
    })

    it('should not render the target add trigger when the handle is already connected', () => {
      renderTargetHandle({
        _connectedTargetHandleIds: ['target-handle'],
      })

      fireEvent.click(screen.getByTestId('handle-target-handle'))

      expect(queryAddNodeButton()).not.toBeInTheDocument()
    })

    it('should hide the target handle for workflow entry nodes', () => {
      renderTargetHandle({ type: BlockEnum.TriggerPlugin })

      expect(screen.getByTestId('handle-target-handle')).toHaveClass('opacity-0')
    })

    it('should keep the target add trigger visible when the node is selected', () => {
      renderTargetHandle({
        selected: true,
      })

      expect(getAddNodeButton()).toHaveClass('opacity-100')
      expect(getAddNodeButton()).toHaveClass('pointer-events-none')
    })
  })

  // Source-side tests cover selector opening paths, previous-node selection, and status styling.
  describe('NodeSourceHandle', () => {
    it('should toggle the source add trigger', () => {
      renderSourceHandle()

      const handle = screen.getByTestId('handle-source-handle')
      const addNodeButton = getAddNodeButton()

      expect(addNodeButton).toHaveClass('opacity-0')

      fireEvent.click(addNodeButton)

      expect(addNodeButton).toHaveAttribute('data-popup-open')
      expect(addNodeButton).toHaveClass('pointer-events-none')

      fireEvent.click(handle)

      expect(addNodeButton).not.toHaveAttribute('data-popup-open')
    })

    it('should keep the source add trigger visible when the node is selected', () => {
      renderSourceHandle({
        selected: true,
      })

      const addNodeButton = getAddNodeButton()

      expect(addNodeButton).toHaveClass('custom-selector')
      expect(addNodeButton).toHaveClass('opacity-100')
      expect(addNodeButton).toHaveClass('pointer-events-none')
    })
  })

  // Auto-open tests cover workflow start-trigger variants, chat-mode bypass, and store fallback paths.
  describe('NodeSourceHandle auto-open', () => {
    it.each([
      BlockEnum.Start,
      BlockEnum.TriggerSchedule,
      BlockEnum.TriggerWebhook,
      BlockEnum.TriggerPlugin,
    ])('should auto-open immediately for %s nodes', (type) => {
      mockStoreState.shouldAutoOpenStartNodeSelector = true

      renderSourceHandle({ type })

      const addNodeButton = getAddNodeButton()

      expect(addNodeButton).toHaveAttribute('data-popup-open')
      expect(addNodeButton).toHaveClass('pointer-events-none')
      expect(mockSetShouldAutoOpenStartNodeSelector).toHaveBeenCalledWith(false)
      expect(mockSetHasSelectedStartNode).toHaveBeenCalledWith(false)
    })

    it('should skip source auto-open in chat mode and only reset the start selector flag', () => {
      mockHooksState.isChatMode = true
      mockStoreState.shouldAutoOpenStartNodeSelector = true

      renderSourceHandle({ type: BlockEnum.Start })

      expect(getAddNodeButton()).toHaveClass('opacity-0')
      expect(mockSetShouldAutoOpenStartNodeSelector).toHaveBeenCalledWith(false)
      expect(mockSetHasSelectedStartNode).not.toHaveBeenCalled()
    })

    it('should use the workflow store fallback when the selector setters are unavailable', () => {
      mockStoreState.shouldAutoOpenStartNodeSelector = true
      mockStoreState.setShouldAutoOpenStartNodeSelector = undefined
      mockStoreState.setHasSelectedStartNode = undefined

      renderSourceHandle({ type: BlockEnum.Start })

      expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({
        shouldAutoOpenStartNodeSelector: false,
      })
      expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({ hasSelectedStartNode: false })
    })

    it('should not auto-open when the node type is not a workflow entry node', () => {
      mockStoreState.shouldAutoOpenStartNodeSelector = true

      renderSourceHandle({ type: BlockEnum.Code })

      expect(getAddNodeButton()).toHaveClass('opacity-0')
      expect(mockSetShouldAutoOpenStartNodeSelector).not.toHaveBeenCalled()
      expect(mockSetHasSelectedStartNode).not.toHaveBeenCalled()
      expect(mockWorkflowStoreSetState).not.toHaveBeenCalled()
    })
  })
})
