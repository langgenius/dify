import type { ReactNode } from 'react'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { NodeSourceHandle, NodeTargetHandle } from '../node-handle'

const {
  mockHandleNodeAdd,
  mockSetShouldAutoOpenStartNodeSelector,
  mockSetHasSelectedStartNode,
  mockWorkflowStoreSetState,
} = vi.hoisted(() => ({
  mockHandleNodeAdd: vi.fn(),
  mockSetShouldAutoOpenStartNodeSelector: vi.fn(),
  mockSetHasSelectedStartNode: vi.fn(),
  mockWorkflowStoreSetState: vi.fn(),
}))

type HandleProps = {
  id?: string
  className?: string
  children?: ReactNode
  onClick?: () => void
}

type BlockSelectorProps = {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  triggerClassName?: (open: boolean) => string
}

vi.mock('reactflow', () => ({
  Handle: ({ id, className, children, onClick }: HandleProps) => (
    <div data-handleid={id} className={className} onClick={onClick}>
      {children}
    </div>
  ),
  Position: {
    Left: 'left',
    Right: 'right',
  },
}))

vi.mock('@/app/components/workflow/block-selector', () => ({
  default: ({ open = false, onOpenChange, triggerClassName }: BlockSelectorProps) => (
    <button
      type="button"
      data-testid="block-selector-trigger"
      className={triggerClassName?.(open)}
      onClick={() => onOpenChange?.(!open)}
    >
      add-node
    </button>
  ),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useAvailableBlocks: () => ({
    availablePrevBlocks: [BlockEnum.Code],
    availableNextBlocks: [BlockEnum.Code],
  }),
  useIsChatMode: () => false,
  useNodesInteractions: () => ({
    handleNodeAdd: mockHandleNodeAdd,
  }),
  useNodesReadOnly: () => ({
    getNodesReadOnly: () => false,
  }),
}))

type MockStoreState = {
  shouldAutoOpenStartNodeSelector: boolean
  setShouldAutoOpenStartNodeSelector: (open: boolean) => void
  setHasSelectedStartNode: (selected: boolean) => void
}

const mockStoreState: MockStoreState = {
  shouldAutoOpenStartNodeSelector: false,
  setShouldAutoOpenStartNodeSelector: mockSetShouldAutoOpenStartNodeSelector,
  setHasSelectedStartNode: mockSetHasSelectedStartNode,
}

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

describe('node-handle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreState.shouldAutoOpenStartNodeSelector = false
  })

  // The add-node trigger must stay mounted so closing the selector does not lose its anchor element.
  describe('Persistent Add Trigger', () => {
    it('should keep the target-side add trigger mounted with opacity-based hiding', () => {
      render(
        <NodeTargetHandle
          id="node-1"
          data={createNodeData()}
          handleId="target-1"
        />,
      )

      const trigger = screen.getByTestId('block-selector-trigger')

      expect(trigger).toHaveClass('absolute')
      expect(trigger).toHaveClass('opacity-0')
      expect(trigger).toHaveClass('pointer-events-none')
      expect(trigger).toHaveClass('group-hover:opacity-100')
      expect(trigger).toHaveClass('group-hover:pointer-events-auto')
      expect(trigger).not.toHaveClass('hidden')
      expect(trigger.className).not.toContain('group-hover:flex')
    })

    it('should show the target-side add trigger when the node is selected', () => {
      render(
        <NodeTargetHandle
          id="node-2"
          data={createNodeData({ selected: true })}
          handleId="target-2"
        />,
      )

      const trigger = screen.getByTestId('block-selector-trigger')

      expect(trigger).toHaveClass('opacity-100')
      expect(trigger).toHaveClass('pointer-events-auto')
    })

    it('should show the source-side add trigger after opening the selector', () => {
      render(
        <NodeSourceHandle
          id="node-3"
          data={createNodeData()}
          handleId="source-1"
        />,
      )

      const handle = screen.getByTestId('block-selector-trigger').parentElement
      if (!handle)
        throw new Error('missing source handle element')

      fireEvent.click(handle)

      const trigger = screen.getByTestId('block-selector-trigger')
      expect(trigger).toHaveClass('opacity-100')
      expect(trigger).toHaveClass('pointer-events-auto')
    })
  })
})
