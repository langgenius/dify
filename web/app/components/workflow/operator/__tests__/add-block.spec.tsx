import type { ReactNode } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { FlowType } from '@/types/common'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import AddBlock from '../add-block'

type BlockSelectorMockProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  disabled: boolean
  onSelect: (type: BlockEnum, pluginDefaultValue?: Record<string, unknown>) => void
  placement: string
  offset: {
    mainAxis: number
    crossAxis: number
  }
  trigger: (open: boolean) => ReactNode
  popupClassName: string
  availableBlocksTypes: BlockEnum[]
  showStartTab: boolean
}

const {
  mockHandlePaneContextmenuCancel,
  mockWorkflowStoreSetState,
  mockGenerateNewNode,
  mockGetNodeCustomTypeByNodeDataType,
} = vi.hoisted(() => ({
  mockHandlePaneContextmenuCancel: vi.fn(),
  mockWorkflowStoreSetState: vi.fn(),
  mockGenerateNewNode: vi.fn(({ type, data }: { type: string, data: Record<string, unknown> }) => ({
    newNode: {
      id: 'generated-node',
      type,
      data,
    },
  })),
  mockGetNodeCustomTypeByNodeDataType: vi.fn((type: string) => `${type}-custom`),
}))

let latestBlockSelectorProps: BlockSelectorMockProps | null = null
let mockNodesReadOnly = false
let mockIsChatMode = false
let mockFlowType: FlowType = FlowType.appFlow

const mockAvailableNextBlocks = [BlockEnum.Answer, BlockEnum.Code]
const mockNodesMetaDataMap = {
  [BlockEnum.Answer]: {
    defaultValue: {
      title: 'Answer',
      desc: '',
      type: BlockEnum.Answer,
    },
  },
}

vi.mock('@/app/components/workflow/block-selector', () => ({
  default: (props: BlockSelectorMockProps) => {
    latestBlockSelectorProps = props
    return (
      <div data-testid="block-selector">
        {props.trigger(props.open)}
      </div>
    )
  },
}))

vi.mock('../../hooks', () => ({
  useAvailableBlocks: () => ({
    availableNextBlocks: mockAvailableNextBlocks,
  }),
  useIsChatMode: () => mockIsChatMode,
  useNodesMetaData: () => ({
    nodesMap: mockNodesMetaDataMap,
  }),
  useNodesReadOnly: () => ({
    nodesReadOnly: mockNodesReadOnly,
  }),
  usePanelInteractions: () => ({
    handlePaneContextmenuCancel: mockHandlePaneContextmenuCancel,
  }),
}))

vi.mock('../../hooks-store', () => ({
  useHooksStore: (selector: (state: { configsMap?: { flowType?: FlowType } }) => unknown) =>
    selector({ configsMap: { flowType: mockFlowType } }),
}))

vi.mock('../../store', () => ({
  useWorkflowStore: () => ({
    setState: mockWorkflowStoreSetState,
  }),
}))

vi.mock('../../utils', () => ({
  generateNewNode: mockGenerateNewNode,
  getNodeCustomTypeByNodeDataType: mockGetNodeCustomTypeByNodeDataType,
}))

vi.mock('../tip-popup', () => ({
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

const renderWithReactFlow = (nodes: Array<ReturnType<typeof createNode>>) =>
  renderWorkflowFlowComponent(<AddBlock />, { nodes, edges: [] })

describe('AddBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestBlockSelectorProps = null
    mockNodesReadOnly = false
    mockIsChatMode = false
    mockFlowType = FlowType.appFlow
  })

  // Rendering and selector configuration.
  describe('Rendering', () => {
    it('should pass the selector props for a writable app workflow', async () => {
      renderWithReactFlow([])

      await waitFor(() => expect(latestBlockSelectorProps).not.toBeNull())

      expect(screen.getByTestId('block-selector')).toBeInTheDocument()
      expect(latestBlockSelectorProps).toMatchObject({
        disabled: false,
        availableBlocksTypes: mockAvailableNextBlocks,
        showStartTab: true,
        placement: 'right-start',
        popupClassName: 'min-w-[256px]!',
      })
      expect(latestBlockSelectorProps?.offset).toEqual({
        mainAxis: 4,
        crossAxis: -8,
      })
    })

    it('should hide the start tab for chat mode and rag pipeline flows', async () => {
      mockIsChatMode = true
      const { unmount } = renderWithReactFlow([])

      await waitFor(() => expect(latestBlockSelectorProps).not.toBeNull())

      expect(latestBlockSelectorProps?.showStartTab).toBe(false)

      mockIsChatMode = false
      mockFlowType = FlowType.ragPipeline
      unmount()
      renderWithReactFlow([])

      expect(latestBlockSelectorProps?.showStartTab).toBe(false)
    })
  })

  // User interactions that bridge selector state and workflow state.
  describe('User Interactions', () => {
    it('should cancel the pane context menu when the selector closes', async () => {
      renderWithReactFlow([])

      await waitFor(() => expect(latestBlockSelectorProps).not.toBeNull())

      act(() => {
        latestBlockSelectorProps?.onOpenChange(false)
      })

      expect(mockHandlePaneContextmenuCancel).toHaveBeenCalledTimes(1)
    })

    it('should create a candidate node with an incremented title when a block is selected', async () => {
      renderWithReactFlow([
        createNode({ id: 'node-1', position: { x: 0, y: 0 }, data: { type: BlockEnum.Answer } }),
        createNode({ id: 'node-2', position: { x: 80, y: 0 }, data: { type: BlockEnum.Answer } }),
      ])

      await waitFor(() => expect(latestBlockSelectorProps).not.toBeNull())

      act(() => {
        latestBlockSelectorProps?.onSelect(BlockEnum.Answer, { pluginId: 'plugin-1' })
      })

      expect(mockGetNodeCustomTypeByNodeDataType).toHaveBeenCalledWith(BlockEnum.Answer)
      expect(mockGenerateNewNode).toHaveBeenCalledWith({
        type: 'answer-custom',
        data: {
          title: 'Answer 3',
          desc: '',
          type: BlockEnum.Answer,
          pluginId: 'plugin-1',
          _isCandidate: true,
        },
        position: {
          x: 0,
          y: 0,
        },
      })
      expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({
        candidateNode: {
          id: 'generated-node',
          type: 'answer-custom',
          data: {
            title: 'Answer 3',
            desc: '',
            type: BlockEnum.Answer,
            pluginId: 'plugin-1',
            _isCandidate: true,
          },
        },
      })
    })
  })
})
