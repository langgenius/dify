import type { NodeProps } from 'reactflow'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { render, waitFor } from '@testing-library/react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import {
  useAvailableBlocks,
  useIsChatMode,
  useNodesInteractions,
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
import { BlockEnum } from '@/app/components/workflow/types'
import LoopStartNode, { LoopStartNodeDumb } from '../index'

vi.mock('@/app/components/workflow/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/workflow/hooks')>()
  return {
    ...actual,
    useAvailableBlocks: vi.fn(),
    useNodesInteractions: vi.fn(),
    useNodesReadOnly: vi.fn(),
    useIsChatMode: vi.fn(),
  }
})

const mockUseAvailableBlocks = vi.mocked(useAvailableBlocks)
const mockUseNodesInteractions = vi.mocked(useNodesInteractions)
const mockUseNodesReadOnly = vi.mocked(useNodesReadOnly)
const mockUseIsChatMode = vi.mocked(useIsChatMode)

const createAvailableBlocksResult = (): ReturnType<typeof useAvailableBlocks> => ({
  getAvailableBlocks: vi.fn(() => ({
    availablePrevBlocks: [],
    availableNextBlocks: [],
  })),
  availablePrevBlocks: [],
  availableNextBlocks: [],
})

const FlowNode = (props: NodeProps<CommonNodeType>) => (
  <LoopStartNode {...props} />
)

const renderFlowNode = () =>
  renderWorkflowFlowComponent(<div />, {
    nodes: [createNode({
      id: 'loop-start-node',
      type: 'loopStartNode',
      data: {
        title: 'Loop Start',
        desc: '',
        type: BlockEnum.LoopStart,
      },
    })],
    edges: [],
    reactFlowProps: {
      nodeTypes: { loopStartNode: FlowNode },
    },
    canvasStyle: {
      width: 400,
      height: 300,
    },
  })

describe('LoopStartNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAvailableBlocks.mockReturnValue(createAvailableBlocksResult())
    mockUseNodesInteractions.mockReturnValue({
      handleNodeAdd: vi.fn(),
    } as unknown as ReturnType<typeof useNodesInteractions>)
    mockUseNodesReadOnly.mockReturnValue({
      getNodesReadOnly: () => false,
    } as unknown as ReturnType<typeof useNodesReadOnly>)
    mockUseIsChatMode.mockReturnValue(false)
  })

  // The loop start marker should match iteration start behavior in both real and dumb render paths.
  describe('Rendering', () => {
    it('should render the source handle in the ReactFlow context', async () => {
      const { container } = renderFlowNode()

      await waitFor(() => {
        expect(container.querySelector('[data-handleid="source"]')).toBeInTheDocument()
      })
    })

    it('should render the dumb variant without any source handle', () => {
      const { container } = render(<LoopStartNodeDumb />)

      expect(container.querySelector('[data-handleid="source"]')).not.toBeInTheDocument()
    })
  })
})
