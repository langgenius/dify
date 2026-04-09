import type { EvaluationMetric } from '../../../types'
import type { EndNodeType } from '@/app/components/workflow/nodes/end/types'
import type { StartNodeType } from '@/app/components/workflow/nodes/start/types'
import type { Node } from '@/app/components/workflow/types'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import CustomMetricEditorCard from '..'
import { useEvaluationStore } from '../../../store'

const mockUseAppWorkflow = vi.hoisted(() => vi.fn())
const mockUseAvailableEvaluationWorkflows = vi.hoisted(() => vi.fn())
const mockUseInfiniteScroll = vi.hoisted(() => vi.fn())

vi.mock('@/service/use-workflow', () => ({
  useAppWorkflow: (...args: unknown[]) => mockUseAppWorkflow(...args),
}))

vi.mock('@/service/use-evaluation', () => ({
  useAvailableEvaluationWorkflows: (...args: unknown[]) => mockUseAvailableEvaluationWorkflows(...args),
}))

vi.mock('ahooks', () => ({
  useInfiniteScroll: (...args: unknown[]) => mockUseInfiniteScroll(...args),
}))

const createStartNode = (): Node<StartNodeType> => ({
  id: 'start-node',
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    type: BlockEnum.Start,
    title: 'Start',
    desc: '',
    variables: [],
  },
})

const createEndNode = (
  outputs: EndNodeType['outputs'],
): Node<EndNodeType> => ({
  id: 'end-node',
  type: 'custom',
  position: { x: 100, y: 0 },
  data: {
    type: BlockEnum.End,
    title: 'End',
    desc: '',
    outputs,
  },
})

const createWorkflow = (
  nodes: Node[],
): FetchWorkflowDraftResponse => ({
  id: 'workflow-1',
  graph: {
    nodes,
    edges: [],
  },
  features: {},
  created_at: 1710000000,
  created_by: {
    id: 'user-1',
    name: 'User One',
    email: 'user-one@example.com',
  },
  hash: 'hash-1',
  updated_at: 1710000001,
  updated_by: {
    id: 'user-2',
    name: 'User Two',
    email: 'user-two@example.com',
  },
  tool_published: true,
  environment_variables: [],
  conversation_variables: [],
  version: '1',
  marked_name: 'Evaluation Workflow',
  marked_comment: 'Published',
})

const createMetric = (): EvaluationMetric => ({
  id: 'metric-1',
  optionId: 'custom-1',
  kind: 'custom-workflow',
  label: 'Custom Evaluator',
  description: 'Map workflow variables to your evaluation inputs.',
  customConfig: {
    workflowId: 'workflow-1',
    workflowAppId: 'app-1',
    workflowName: 'Evaluation Workflow',
    mappings: [{
      id: 'mapping-1',
      sourceFieldId: null,
      targetVariableId: null,
    }],
  },
})

describe('CustomMetricEditorCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useEvaluationStore.setState({ resources: {} })

    mockUseInfiniteScroll.mockImplementation(() => undefined)
    mockUseAvailableEvaluationWorkflows.mockReturnValue({
      data: {
        pages: [{
          items: [],
          page: 1,
          limit: 20,
          has_more: false,
        }],
      },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetching: false,
      isFetchingNextPage: false,
      isLoading: false,
    })
  })

  // Verify end-node outputs are shown after a workflow is selected.
  describe('Outputs', () => {
    it('should render the selected workflow outputs from the end node', () => {
      mockUseAppWorkflow.mockReturnValue({
        data: createWorkflow([
          createStartNode(),
          createEndNode([
            { variable: 'answer_score', value_selector: ['end', 'answer_score'], value_type: VarType.number },
            { variable: 'reason', value_selector: ['end', 'reason'], value_type: VarType.string },
          ]),
        ]),
      })

      render(
        <CustomMetricEditorCard
          resourceType="apps"
          resourceId="app-1"
          metric={createMetric()}
        />,
      )

      expect(screen.getByText('evaluation.metrics.custom.outputTitle')).toBeInTheDocument()
      expect(screen.getByText('answer_score')).toBeInTheDocument()
      expect(screen.getByText('number')).toBeInTheDocument()
      expect(screen.getByText('reason')).toBeInTheDocument()
      expect(screen.getByText('string')).toBeInTheDocument()
    })

    it('should hide the output section when the selected workflow has no end outputs', () => {
      mockUseAppWorkflow.mockReturnValue({
        data: createWorkflow([
          createStartNode(),
          createEndNode([]),
        ]),
      })

      render(
        <CustomMetricEditorCard
          resourceType="apps"
          resourceId="app-1"
          metric={createMetric()}
        />,
      )

      expect(screen.queryByText('evaluation.metrics.custom.outputTitle')).not.toBeInTheDocument()
    })
  })
})
