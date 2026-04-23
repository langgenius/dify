import type { ReactNode } from 'react'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'
import { NodeSourceHandle, NodeTargetHandle } from '../node-handle'

type MockHooksState = {
  availablePrevBlocks: BlockEnum[]
  availableNextBlocks: BlockEnum[]
  isChatMode: boolean
  isReadOnly: boolean
}

type MockStoreState = {
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

type BlockSelectorProps = {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSelect?: (type: BlockEnum, pluginDefaultValue?: { pluginId: string }) => void
  triggerClassName?: (open: boolean) => string
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
}))

vi.mock('@/app/components/workflow/block-selector', () => ({
  default: ({ open = false, onOpenChange, onSelect, triggerClassName }: BlockSelectorProps) => (
    <div>
      <button
        type="button"
        className={triggerClassName?.(open)}
        onClick={(e) => {
          e.stopPropagation()
          onOpenChange?.(!open)
        }}
      >
        add-node
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onSelect?.(BlockEnum.Answer, { pluginId: 'plugin-1' })
        }}
      >
        select-node
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useAvailableBlocks: () => ({
    availablePrevBlocks: mockHooksState.availablePrevBlocks,
    availableNextBlocks: mockHooksState.availableNextBlocks,
  }),
  useIsChatMode: () => mockHooksState.isChatMode,
  useNodesInteractions: () => ({
    handleNodeAdd: mockHandleNodeAdd,
  }),
  useNodesReadOnly: () => ({
    getNodesReadOnly: () => mockHooksState.isReadOnly,
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(selector: (state: MockStoreState) => T) => selector(mockStoreState),
  useWorkflowStore: () => ({
    setState: mockWorkflowStoreSetState,
  }),
}))

const createNodeData = (overrides: Partial<CommonNodeType> = {}): CommonNodeType => ({
  type: BlockEnum.Code,
  title: 'Node',
  desc: '',
  selected: false,
  ...overrides,
})

const getAddNodeButton = () => screen.getByRole('button', { name: 'add-node' })
const queryAddNodeButton = () => screen.queryByRole('button', { name: 'add-node' })
const getSelectNodeButton = () => screen.getByRole('button', { name: 'select-node' })

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
    it('should toggle the target add trigger and select the next node', () => {
      renderTargetHandle()

      const handle = screen.getByTestId('handle-target-handle')
      const addNodeButton = getAddNodeButton()

      expect(addNodeButton).toHaveClass('custom-selector')
      expect(addNodeButton).toHaveClass('opacity-0')
      expect(addNodeButton).toHaveClass('pointer-events-none')

      fireEvent.click(addNodeButton)

      expect(addNodeButton).toHaveClass('opacity-100')
      // Trigger stays pointer-events-none so it never steals mousedown from
      // the underlying React Flow handle (drag-to-connect must keep working).
      expect(addNodeButton).toHaveClass('pointer-events-none')

      fireEvent.click(handle)

      expect(addNodeButton).toHaveClass('opacity-0')

      fireEvent.click(getSelectNodeButton())

      expect(mockHandleNodeAdd).toHaveBeenCalledWith(
        {
          nodeType: BlockEnum.Answer,
          pluginDefaultValue: { pluginId: 'plugin-1' },
        },
        {
          nextNodeId: 'target-node',
          nextNodeTargetHandle: 'target-handle',
        },
      )
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

    it.each([
      ['succeeded', NodeRunningStatus.Succeeded, 'after:bg-workflow-link-line-success-handle'],
      ['failed', NodeRunningStatus.Failed, 'after:bg-workflow-link-line-error-handle'],
      ['exception', NodeRunningStatus.Exception, 'after:bg-workflow-link-line-failure-handle'],
    ])('should render the target %s status class', (_label, runningStatus, expectedClass) => {
      renderTargetHandle({
        _runningStatus: runningStatus,
      })

      expect(screen.getByTestId('handle-target-handle')).toHaveClass(expectedClass)
      expect(screen.getByTestId('handle-target-handle')).toHaveClass('custom-target-handle')
    })
  })

  // Source-side tests cover selector opening paths, previous-node selection, and status styling.
  describe('NodeSourceHandle', () => {
    it('should toggle the source add trigger and select the previous node', () => {
      renderSourceHandle()

      const handle = screen.getByTestId('handle-source-handle')
      const addNodeButton = getAddNodeButton()

      expect(addNodeButton).toHaveClass('opacity-0')

      fireEvent.click(addNodeButton)

      expect(addNodeButton).toHaveClass('opacity-100')
      expect(addNodeButton).toHaveClass('pointer-events-none')

      fireEvent.click(getSelectNodeButton())

      expect(mockHandleNodeAdd).toHaveBeenCalledWith(
        {
          nodeType: BlockEnum.Answer,
          pluginDefaultValue: { pluginId: 'plugin-1' },
        },
        {
          prevNodeId: 'source-node',
          prevNodeSourceHandle: 'source-handle',
        },
      )

      fireEvent.click(handle)

      expect(addNodeButton).toHaveClass('opacity-0')
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

    it.each([
      ['succeeded', NodeRunningStatus.Succeeded, undefined, 'after:bg-workflow-link-line-success-handle'],
      ['failed', NodeRunningStatus.Failed, undefined, 'after:bg-workflow-link-line-error-handle'],
      ['exception', NodeRunningStatus.Exception, true, 'after:bg-workflow-link-line-failure-handle'],
    ])('should render the source %s status class', (_label, runningStatus, showExceptionStatus, expectedClass) => {
      renderSourceHandle(
        {
          _runningStatus: runningStatus,
        },
        {
          showExceptionStatus,
        },
      )

      expect(screen.getByTestId('handle-source-handle')).toHaveClass(expectedClass)
      expect(screen.getByTestId('handle-source-handle')).toHaveClass('custom-source-handle')
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

      expect(addNodeButton).toHaveClass('opacity-100')
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

      expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({ shouldAutoOpenStartNodeSelector: false })
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
