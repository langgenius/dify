import type { Edge, Node } from '@/app/components/workflow/types'
import { screen } from '@testing-library/react'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { useAvailableBlocks } from '../../../../../hooks/use-available-blocks'
import { useNodesInteractions } from '../../../../../hooks/use-nodes-interactions'
import { useToolIcon } from '../../../../../hooks/use-tool-icon'
import { useNodesReadOnly } from '../../../../../hooks/use-workflow'
import NextStep from '../index'

vi.mock('../../../../../hooks/use-available-blocks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../hooks/use-available-blocks')>()

  return {
    ...actual,
    useAvailableBlocks: vi.fn(),
  }
})

vi.mock('../../../../../hooks/use-nodes-interactions', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../../hooks/use-nodes-interactions')>()

  return {
    ...actual,
    useNodesInteractions: vi.fn(),
  }
})

vi.mock('../../../../../hooks/use-tool-icon', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../hooks/use-tool-icon')>()

  return {
    ...actual,
    useToolIcon: vi.fn(),
  }
})

vi.mock('../../../../../hooks/use-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../hooks/use-workflow')>()

  return {
    ...actual,
    useNodesReadOnly: vi.fn(),
  }
})

const mockUseAvailableBlocks = vi.mocked(useAvailableBlocks)
const mockUseNodesInteractions = vi.mocked(useNodesInteractions)
const mockUseNodesReadOnly = vi.mocked(useNodesReadOnly)
const mockUseToolIcon = vi.mocked(useToolIcon)

const createAvailableBlocksResult = (): ReturnType<typeof useAvailableBlocks> => ({
  getAvailableBlocks: vi.fn(() => ({
    availablePrevBlocks: [],
    availableNextBlocks: [],
  })),
  availablePrevBlocks: [],
  availableNextBlocks: [],
})

const renderComponent = (selectedNode: Node, nodes: Node[], edges: Edge[] = []) =>
  renderWorkflowFlowComponent(<NextStep selectedNode={selectedNode} />, {
    nodes,
    edges,
    canvasStyle: {
      width: 600,
      height: 400,
    },
  })

describe('NextStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAvailableBlocks.mockReturnValue(createAvailableBlocksResult())
    mockUseNodesInteractions.mockReturnValue({
      handleNodeSelect: vi.fn(),
      handleNodeAdd: vi.fn(),
    } as unknown as ReturnType<typeof useNodesInteractions>)
    mockUseNodesReadOnly.mockReturnValue({
      nodesReadOnly: true,
    } as ReturnType<typeof useNodesReadOnly>)
    mockUseToolIcon.mockReturnValue('')
  })

  // NextStep should summarize linear next nodes and failure branches from the real ReactFlow graph.
  describe('Rendering', () => {
    it('should render connected next nodes and the parallel add action for the default source handle', () => {
      const selectedNode = createNode({
        id: 'selected-node',
        data: {
          type: BlockEnum.Code,
          title: 'Selected Node',
        },
      })
      const nextNode = createNode({
        id: 'next-node',
        data: {
          type: BlockEnum.Answer,
          title: 'Next Node',
        },
      })
      const edge = createEdge({
        source: 'selected-node',
        target: 'next-node',
        sourceHandle: 'source',
      })

      renderComponent(selectedNode, [selectedNode, nextNode], [edge])

      expect(screen.getByText('Next Node')).toBeInTheDocument()
      expect(screen.getByText('workflow.common.addParallelNode')).toBeInTheDocument()
    })

    it('should render configured branch names when target branches are present', () => {
      const selectedNode = createNode({
        id: 'selected-node',
        data: {
          type: BlockEnum.Code,
          title: 'Selected Node',
          _targetBranches: [
            {
              id: 'branch-a',
              name: 'Approved',
            },
          ],
        },
      })
      const nextNode = createNode({
        id: 'next-node',
        data: {
          type: BlockEnum.Answer,
          title: 'Branch Node',
        },
      })
      const edge = createEdge({
        source: 'selected-node',
        target: 'next-node',
        sourceHandle: 'branch-a',
      })

      renderComponent(selectedNode, [selectedNode, nextNode], [edge])

      expect(screen.getByText('Approved')).toBeInTheDocument()
      expect(screen.getByText('Branch Node')).toBeInTheDocument()
      expect(screen.getByText('workflow.common.addParallelNode')).toBeInTheDocument()
    })

    it('should number question-classifier branches even when no target node is connected', () => {
      const selectedNode = createNode({
        id: 'selected-node',
        data: {
          type: BlockEnum.QuestionClassifier,
          title: 'Classifier',
          _targetBranches: [
            {
              id: 'branch-b',
              name: 'Original branch name',
            },
          ],
        },
      })
      const danglingEdge = createEdge({
        source: 'selected-node',
        target: 'missing-node',
        sourceHandle: 'branch-b',
      })

      renderComponent(selectedNode, [selectedNode], [danglingEdge])

      expect(screen.getByText('workflow.nodes.questionClassifiers.class 1')).toBeInTheDocument()
      expect(screen.getByText('workflow.panel.selectNextStep')).toBeInTheDocument()
    })

    it('should render the failure branch when the node has error handling enabled', () => {
      const selectedNode = createNode({
        id: 'selected-node',
        data: {
          type: BlockEnum.Code,
          title: 'Selected Node',
          error_strategy: ErrorHandleTypeEnum.failBranch,
        },
      })
      const failNode = createNode({
        id: 'fail-node',
        data: {
          type: BlockEnum.Answer,
          title: 'Failure Node',
        },
      })
      const failEdge = createEdge({
        source: 'selected-node',
        target: 'fail-node',
        sourceHandle: ErrorHandleTypeEnum.failBranch,
      })

      renderComponent(selectedNode, [selectedNode, failNode], [failEdge])

      expect(screen.getByText('workflow.common.onFailure')).toBeInTheDocument()
      expect(screen.getByText('Failure Node')).toBeInTheDocument()
      expect(screen.getByText('workflow.common.addFailureBranch')).toBeInTheDocument()
    })
  })
})
