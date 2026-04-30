import type { EvaluationMetric } from '../../../types'
import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import type { EndNodeType } from '@/app/components/workflow/nodes/end/types'
import type { StartNodeType } from '@/app/components/workflow/nodes/start/types'
import type { Node } from '@/app/components/workflow/types'
import type { SnippetWorkflow } from '@/types/snippet'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import CustomMetricEditorCard from '..'
import { useEvaluationStore } from '../../../store'

const mockUseAppWorkflow = vi.hoisted(() => vi.fn())
const mockUseAppDetail = vi.hoisted(() => vi.fn())
const mockUseSnippetPublishedWorkflow = vi.hoisted(() => vi.fn())
const mockUseAvailableEvaluationWorkflows = vi.hoisted(() => vi.fn())
const mockUseInfiniteScroll = vi.hoisted(() => vi.fn())
const mockPublishedGraphVariablePicker = vi.hoisted(() => vi.fn())

vi.mock('@/service/use-workflow', () => ({
  useAppWorkflow: (...args: unknown[]) => mockUseAppWorkflow(...args),
}))

vi.mock('@/service/use-apps', () => ({
  useAppDetail: (...args: unknown[]) => mockUseAppDetail(...args),
}))

vi.mock('@/service/use-snippet-workflows', () => ({
  useSnippetPublishedWorkflow: (...args: unknown[]) => mockUseSnippetPublishedWorkflow(...args),
}))

vi.mock('@/service/use-evaluation', () => ({
  useAvailableEvaluationWorkflows: (...args: unknown[]) => mockUseAvailableEvaluationWorkflows(...args),
}))

vi.mock('ahooks', () => ({
  useInfiniteScroll: (...args: unknown[]) => mockUseInfiniteScroll(...args),
}))

vi.mock('../published-graph-variable-picker', () => ({
  default: (props: Record<string, unknown>) => {
    mockPublishedGraphVariablePicker(props)
    return <div data-testid="published-graph-variable-picker" />
  },
}))

const createStartNode = (): Node<StartNodeType> => ({
  id: 'start-node',
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    type: BlockEnum.Start,
    title: 'Start',
    desc: '',
    variables: [
      {
        variable: 'user_question',
        label: 'User Question',
        type: InputVarType.textInput,
        required: true,
      },
      {
        variable: 'retrieved_context',
        label: 'Retrieved Context',
        type: InputVarType.textInput,
        required: true,
      },
    ],
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

const createCodeNode = (
  id: string,
  title: string,
  outputs: Record<string, { type: VarType }>,
): Node<CodeNodeType> => ({
  id,
  type: 'custom',
  position: { x: 100, y: 0 },
  data: {
    type: BlockEnum.Code,
    title,
    desc: '',
    code: '',
    code_language: CodeLanguage.python3,
    outputs: Object.fromEntries(
      Object.entries(outputs).map(([key, value]) => [
        key,
        {
          type: value.type,
          children: null,
        },
      ]),
    ),
    variables: [],
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

const createSnippetWorkflow = (
  nodes: Node[],
): SnippetWorkflow => ({
  id: 'snippet-workflow-1',
  graph: {
    nodes,
    edges: [],
  },
  features: {},
  hash: 'snippet-hash-1',
  created_at: 1710000000,
  updated_at: 1710000001,
})

const createMetric = (): EvaluationMetric => ({
  id: 'metric-1',
  optionId: 'custom-1',
  kind: 'custom-workflow',
  label: 'Custom Evaluator',
  description: 'Map workflow variables to your evaluation inputs.',
  valueType: 'number',
  customConfig: {
    workflowId: 'workflow-1',
    workflowAppId: 'workflow-app-1',
    workflowName: 'Evaluation Workflow',
    mappings: [{
      id: 'mapping-1',
      inputVariableId: 'user_question',
      outputVariableId: 'current-node.answer',
    }, {
      id: 'mapping-2',
      inputVariableId: 'retrieved_context',
      outputVariableId: 'current-node.score',
    }],
    outputs: [],
  },
})

describe('CustomMetricEditorCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useEvaluationStore.setState({ resources: {} })
    mockPublishedGraphVariablePicker.mockReset()
    mockUseAppDetail.mockReturnValue({ data: undefined })

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
    mockUseSnippetPublishedWorkflow.mockReturnValue({ data: undefined })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Verify the selected evaluation workflow still drives the output summary section.
  describe('Outputs', () => {
    it('should render the selected workflow outputs from the end node', () => {
      const selectedWorkflow = createWorkflow([
        createStartNode(),
        createEndNode([
          { variable: 'answer_score', value_selector: ['end', 'answer_score'], value_type: VarType.number },
          { variable: 'reason', value_selector: ['end', 'reason'], value_type: VarType.string },
        ]),
      ])
      const currentAppWorkflow = createWorkflow([
        createCodeNode('current-node', 'Current Node', {
          answer: { type: VarType.string },
          score: { type: VarType.number },
        }),
      ])

      mockUseAppWorkflow.mockImplementation((appId: string) => {
        if (appId === 'workflow-app-1')
          return { data: selectedWorkflow }
        if (appId === 'app-under-test')
          return { data: currentAppWorkflow }

        return { data: undefined }
      })

      render(
        <CustomMetricEditorCard
          resourceType="apps"
          resourceId="app-under-test"
          metric={createMetric()}
        />,
      )

      expect(screen.getByText('evaluation.metrics.custom.outputTitle')).toBeInTheDocument()
      expect(screen.getAllByText('answer_score').length).toBeGreaterThan(0)
      expect(screen.getAllByText('number').length).toBeGreaterThan(0)
      expect(screen.getAllByText('reason').length).toBeGreaterThan(0)
      expect(screen.getAllByText('string').length).toBeGreaterThan(0)
    })

    it('should hide the output section when the selected workflow has no end outputs', () => {
      const selectedWorkflow = createWorkflow([
        createStartNode(),
        createEndNode([]),
      ])
      const currentAppWorkflow = createWorkflow([
        createCodeNode('current-node', 'Current Node', {
          answer: { type: VarType.string },
        }),
      ])

      mockUseAppWorkflow.mockImplementation((appId: string) => {
        if (appId === 'workflow-app-1')
          return { data: selectedWorkflow }
        if (appId === 'app-under-test')
          return { data: currentAppWorkflow }

        return { data: undefined }
      })

      render(
        <CustomMetricEditorCard
          resourceType="apps"
          resourceId="app-under-test"
          metric={createMetric()}
        />,
      )

      expect(screen.queryByText('evaluation.metrics.custom.outputTitle')).not.toBeInTheDocument()
    })
  })

  // Verify mapping rows use workflow start variables on the left and current published graph variables on the right.
  describe('Variable Mapping', () => {
    it('should preserve saved mappings and outputs while the selected workflow is loading', () => {
      const baseMetric = createMetric()
      const metric = {
        ...baseMetric,
        customConfig: {
          ...baseMetric.customConfig!,
          outputs: [{ id: 'score', valueType: 'number' }],
        },
      }
      const syncMappingsSpy = vi.spyOn(useEvaluationStore.getState(), 'syncCustomMetricMappings')
      const syncOutputsSpy = vi.spyOn(useEvaluationStore.getState(), 'syncCustomMetricOutputs')

      mockUseAppWorkflow.mockReturnValue({ data: undefined })

      render(
        <CustomMetricEditorCard
          resourceType="apps"
          resourceId="app-under-test"
          metric={metric}
        />,
      )

      expect(screen.getByText('Evaluation Workflow')).toBeInTheDocument()
      expect(syncMappingsSpy).not.toHaveBeenCalled()
      expect(syncOutputsSpy).not.toHaveBeenCalled()
    })

    it('should show the selected workflow app name from app detail when the config only has workflow id', () => {
      const selectedWorkflow = {
        ...createWorkflow([createStartNode()]),
        marked_name: '',
      }
      const baseMetric = createMetric()
      const metric = {
        ...baseMetric,
        customConfig: {
          ...baseMetric.customConfig!,
          workflowName: null,
        },
      }

      mockUseAppDetail.mockReturnValue({
        data: {
          id: 'workflow-app-1',
          name: 'Review Workflow App',
        },
      })
      mockUseAppWorkflow.mockImplementation((appId: string) => {
        if (appId === 'workflow-app-1')
          return { data: selectedWorkflow }

        return { data: undefined }
      })

      render(
        <CustomMetricEditorCard
          resourceType="apps"
          resourceId="app-under-test"
          metric={metric}
        />,
      )

      expect(mockUseAppDetail).toHaveBeenCalledWith('workflow-app-1')
      expect(screen.getByText('Review Workflow App')).toBeInTheDocument()
      expect(screen.queryByText('workflow-1')).not.toBeInTheDocument()
    })

    it('should pass the current app published graph and saved selector values to the picker', () => {
      const selectedWorkflow = createWorkflow([
        createStartNode(),
        createEndNode([
          { variable: 'answer_score', value_selector: ['end', 'answer_score'], value_type: VarType.number },
          { variable: 'reason', value_selector: ['end', 'reason'], value_type: VarType.string },
        ]),
      ])
      const currentAppWorkflow = createWorkflow([
        createStartNode(),
        createCodeNode('current-node', 'Current Node', {
          answer: { type: VarType.string },
          score: { type: VarType.number },
        }),
      ])

      mockUseAppWorkflow.mockImplementation((appId: string) => {
        if (appId === 'workflow-app-1')
          return { data: selectedWorkflow }
        if (appId === 'app-under-test')
          return { data: currentAppWorkflow }

        return { data: undefined }
      })

      render(
        <CustomMetricEditorCard
          resourceType="apps"
          resourceId="app-under-test"
          metric={createMetric()}
        />,
      )

      expect(screen.getByText('user_question')).toBeInTheDocument()
      expect(screen.getByText('retrieved_context')).toBeInTheDocument()
      expect(screen.getAllByText('string')).toHaveLength(3)
      expect(mockPublishedGraphVariablePicker).toHaveBeenCalledTimes(2)
      expect(mockPublishedGraphVariablePicker.mock.calls[0][0]).toMatchObject({
        nodes: currentAppWorkflow.graph.nodes,
        edges: currentAppWorkflow.graph.edges,
        value: 'current-node.answer',
      })
      expect(mockPublishedGraphVariablePicker.mock.calls[1][0]).toMatchObject({
        nodes: currentAppWorkflow.graph.nodes,
        edges: currentAppWorkflow.graph.edges,
        value: 'current-node.score',
      })
    })

    it('should use the current snippet published graph when editing a snippet evaluation', () => {
      const selectedWorkflow = createWorkflow([
        createStartNode(),
        createEndNode([
          { variable: 'reason', value_selector: ['end', 'reason'], value_type: VarType.string },
        ]),
      ])
      const currentSnippetWorkflow = createSnippetWorkflow([
        createCodeNode('snippet-node', 'Snippet Node', {
          result: { type: VarType.string },
        }),
      ])

      mockUseAppWorkflow.mockImplementation((appId: string) => {
        if (appId === 'workflow-app-1')
          return { data: selectedWorkflow }

        return { data: undefined }
      })
      mockUseSnippetPublishedWorkflow.mockReturnValue({
        data: currentSnippetWorkflow,
      })

      render(
        <CustomMetricEditorCard
          resourceType="snippets"
          resourceId="snippet-under-test"
          metric={createMetric()}
        />,
      )

      expect(mockPublishedGraphVariablePicker).toHaveBeenCalledTimes(2)
      expect(mockPublishedGraphVariablePicker.mock.calls[0][0]).toMatchObject({
        nodes: currentSnippetWorkflow.graph.nodes,
        edges: currentSnippetWorkflow.graph.edges,
      })
    })
  })
})
