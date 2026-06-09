import type { EndNodeType } from '../types'
import { screen } from '@testing-library/react'
import { createNode, createStartNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderNodeComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import {
  useIsChatMode,
  useWorkflow,
  useWorkflowVariables,
} from '@/app/components/workflow/hooks'
import { BlockEnum } from '@/app/components/workflow/types'
import Node from '../node'

vi.mock('@/app/components/workflow/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/workflow/hooks')>()
  return {
    ...actual,
    useWorkflow: vi.fn(),
    useWorkflowVariables: vi.fn(),
    useIsChatMode: vi.fn(),
  }
})

const mockUseWorkflow = vi.mocked(useWorkflow)
const mockUseWorkflowVariables = vi.mocked(useWorkflowVariables)
const mockUseIsChatMode = vi.mocked(useIsChatMode)

const createNodeData = (overrides: Partial<EndNodeType> = {}): EndNodeType => ({
  title: 'End',
  desc: '',
  type: BlockEnum.End,
  outputs: [{
    variable: 'answer',
    value_selector: ['source-node', 'answer'],
  }],
  ...overrides,
})

describe('EndNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseWorkflow.mockReturnValue({
      getBeforeNodesInSameBranch: () => [
        createStartNode(),
        createNode({
          id: 'source-node',
          data: {
            type: BlockEnum.Code,
            title: 'Source Node',
          },
        }),
      ],
    } as unknown as ReturnType<typeof useWorkflow>)
    mockUseWorkflowVariables.mockReturnValue({
      getNodeAvailableVars: () => [],
      getCurrentVariableType: () => 'string',
    } as unknown as ReturnType<typeof useWorkflowVariables>)
    mockUseIsChatMode.mockReturnValue(false)
  })

  // The node should surface only resolved outputs and ignore empty selectors.
  describe('Rendering', () => {
    it('should render resolved output labels for referenced nodes', () => {
      renderNodeComponent(Node, createNodeData())

      expect(screen.getByText('Source Node')).toBeInTheDocument()
      expect(screen.getByText('answer')).toBeInTheDocument()
      expect(screen.getByText('String')).toBeInTheDocument()
    })

    it('should fall back to the start node when the selector node cannot be found', () => {
      renderNodeComponent(Node, createNodeData({
        outputs: [{
          variable: 'answer',
          value_selector: ['missing-node', 'answer'],
        }],
      }))

      expect(screen.getByText('Start')).toBeInTheDocument()
      expect(screen.getByText('answer')).toBeInTheDocument()
    })

    it('should render nothing when every output selector is empty', () => {
      const { container } = renderNodeComponent(Node, createNodeData({
        outputs: [{
          variable: 'answer',
          value_selector: [],
        }],
      }))

      expect(container).toBeEmptyDOMElement()
    })
  })
})
