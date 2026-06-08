import type { AnswerNodeType } from '../types'
import { screen } from '@testing-library/react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderNodeComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { useWorkflow } from '@/app/components/workflow/hooks'
import { BlockEnum } from '@/app/components/workflow/types'
import Node from '../node'

vi.mock('@/app/components/workflow/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/workflow/hooks')>()
  return {
    ...actual,
    useWorkflow: vi.fn(),
  }
})

const mockUseWorkflow = vi.mocked(useWorkflow)

const createNodeData = (overrides: Partial<AnswerNodeType> = {}): AnswerNodeType => ({
  title: 'Answer',
  desc: '',
  type: BlockEnum.Answer,
  variables: [],
  answer: 'Plain answer',
  ...overrides,
})

describe('AnswerNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseWorkflow.mockReturnValue({
      getBeforeNodesInSameBranchIncludeParent: () => [],
    } as unknown as ReturnType<typeof useWorkflow>)
  })

  // The node should render the localized panel title and plain answer text.
  describe('Rendering', () => {
    it('should render the answer title and text content', () => {
      renderNodeComponent(Node, createNodeData())

      expect(screen.getByText('workflow.nodes.answer.answer')).toBeInTheDocument()
      expect(screen.getByText('Plain answer')).toBeInTheDocument()
    })

    it('should render referenced variables inside the readonly content', () => {
      mockUseWorkflow.mockReturnValue({
        getBeforeNodesInSameBranchIncludeParent: () => [
          createNode({
            id: 'source-node',
            data: {
              type: BlockEnum.Code,
              title: 'Source Node',
            },
          }),
        ],
      } as unknown as ReturnType<typeof useWorkflow>)

      renderNodeComponent(Node, createNodeData({
        answer: 'Hello {{#source-node.name#}}',
      }))

      expect(screen.getByText('Hello')).toBeInTheDocument()
      expect(screen.getByText('Source Node')).toBeInTheDocument()
      expect(screen.getByText('name')).toBeInTheDocument()
    })
  })
})
