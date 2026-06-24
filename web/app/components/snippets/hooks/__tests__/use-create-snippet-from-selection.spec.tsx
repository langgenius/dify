import type { ReactElement } from 'react'
import type { Edge, Node } from '@/app/components/workflow/types'
import type { SnippetCanvasData, SnippetInputField } from '@/models/snippet'
import { act, renderHook } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { PipelineInputVarType } from '@/models/pipeline'
import { useCreateSnippetFromSelection } from '../use-create-snippet-from-selection'

const SNIPPET_INPUT_FIELD_NODE_ID = 'start'
const mockHandleOpenCreateSnippetDialog = vi.fn()
const mockHandleCloseCreateSnippetDialog = vi.fn()
const mockHandleCreateSnippet = vi.fn()

vi.mock('../use-create-snippet', () => ({
  useCreateSnippet: () => ({
    createSnippetMutation: {
      isPending: false,
    },
    handleCloseCreateSnippetDialog: mockHandleCloseCreateSnippetDialog,
    handleCreateSnippet: mockHandleCreateSnippet,
    handleOpenCreateSnippetDialog: mockHandleOpenCreateSnippetDialog,
    isCreateSnippetDialogOpen: true,
    isCreatingSnippet: false,
  }),
}))

type DialogProps = {
  selectedGraph?: SnippetCanvasData
  inputFields?: SnippetInputField[]
}

const createNode = (
  id: string,
  data: Record<string, unknown>,
): Node => ({
  id,
  type: 'custom',
  position: { x: 0, y: 0 },
  width: 200,
  height: 100,
  data,
} as unknown as Node)

describe('useCreateSnippetFromSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should convert environment, conversation, and system variables into snippet input fields', () => {
    const selectedNodes = [
      createNode('llm', {
        type: BlockEnum.LLM,
        prompt: [
          '{{#env.API_KEY#}}',
          '{{#conversation.user_name#}}',
          '{{#sys.user_id#}}',
          '{{#rag.query#}}',
          '{{#source.result#}}',
        ].join(' '),
        model_selector: ['env', 'MODEL_NAME'],
      }),
    ]
    const edges: Edge[] = []
    const onClose = vi.fn()

    const { result } = renderHook(() => useCreateSnippetFromSelection({
      edges,
      selectedNodes,
      onClose,
    }))

    act(() => {
      result.current.handleOpenCreateSnippet()
    })

    const dialogProps = (result.current.createSnippetDialog as ReactElement<DialogProps>).props

    expect(dialogProps.inputFields).toEqual([
      {
        label: 'API_KEY',
        variable: 'API_KEY',
        type: PipelineInputVarType.textInput,
        required: true,
      },
      {
        label: 'user_name',
        variable: 'user_name',
        type: PipelineInputVarType.textInput,
        required: true,
      },
      {
        label: 'user_id',
        variable: 'user_id',
        type: PipelineInputVarType.textInput,
        required: true,
      },
      {
        label: 'result',
        variable: 'result',
        type: PipelineInputVarType.textInput,
        required: true,
      },
      {
        label: 'MODEL_NAME',
        variable: 'MODEL_NAME',
        type: PipelineInputVarType.textInput,
        required: true,
      },
    ])
    const nodeData = dialogProps.selectedGraph?.nodes[0]?.data as Record<string, unknown> | undefined

    expect(nodeData?.prompt).toBe([
      `{{#${SNIPPET_INPUT_FIELD_NODE_ID}.API_KEY#}}`,
      `{{#${SNIPPET_INPUT_FIELD_NODE_ID}.user_name#}}`,
      `{{#${SNIPPET_INPUT_FIELD_NODE_ID}.user_id#}}`,
      '{{#rag.query#}}',
      `{{#${SNIPPET_INPUT_FIELD_NODE_ID}.result#}}`,
    ].join(' '))
    expect(nodeData?.model_selector).toEqual([
      SNIPPET_INPUT_FIELD_NODE_ID,
      'MODEL_NAME',
    ])
    expect(onClose).toHaveBeenCalled()
  })

  it('should convert system variables used by if-else and variable aggregator nodes', () => {
    const selectedNodes = [
      createNode('llm', {
        type: BlockEnum.LLM,
        title: 'LLM',
      }),
      createNode('if-else', {
        type: BlockEnum.IfElse,
        cases: [{
          case_id: 'case-1',
          conditions: [{
            id: 'condition-1',
            variable_selector: ['sys', 'query'],
            comparison_operator: 'contains',
            value: 'hello',
          }],
        }],
      }),
      createNode('variable-aggregator', {
        type: BlockEnum.VariableAggregator,
        variables: [
          ['sys', 'files'],
          ['llm', 'text'],
        ],
        advanced_settings: {
          group_enabled: true,
          groups: [{
            groupId: 'group-1',
            group_name: 'Group1',
            variables: [
              ['sys', 'workflow_id'],
            ],
          }],
        },
      }),
    ]
    const onClose = vi.fn()

    const { result } = renderHook(() => useCreateSnippetFromSelection({
      edges: [],
      selectedNodes,
      onClose,
    }))

    act(() => {
      result.current.handleOpenCreateSnippet()
    })

    const dialogProps = (result.current.createSnippetDialog as ReactElement<DialogProps>).props

    expect(dialogProps.inputFields).toEqual([
      {
        label: 'query',
        variable: 'query',
        type: PipelineInputVarType.textInput,
        required: true,
      },
      {
        label: 'files',
        variable: 'files',
        type: PipelineInputVarType.multiFiles,
        required: true,
      },
      {
        label: 'workflow_id',
        variable: 'workflow_id',
        type: PipelineInputVarType.textInput,
        required: true,
      },
    ])

    const ifElseNode = dialogProps.selectedGraph?.nodes.find(node => node.id === 'if-else')
    const aggregatorNode = dialogProps.selectedGraph?.nodes.find(node => node.id === 'variable-aggregator')
    const ifElseData = ifElseNode?.data as Record<string, unknown>
    const aggregatorData = aggregatorNode?.data as {
      variables?: string[][]
      advanced_settings?: { groups?: Array<{ variables?: string[][] }> }
    }

    expect(ifElseData.cases).toEqual([{
      case_id: 'case-1',
      conditions: [{
        id: 'condition-1',
        variable_selector: [SNIPPET_INPUT_FIELD_NODE_ID, 'query'],
        comparison_operator: 'contains',
        value: 'hello',
      }],
    }])
    expect(aggregatorData.variables).toEqual([
      [SNIPPET_INPUT_FIELD_NODE_ID, 'files'],
      ['llm', 'text'],
    ])
    expect(aggregatorData.advanced_settings?.groups?.[0]?.variables).toEqual([
      [SNIPPET_INPUT_FIELD_NODE_ID, 'workflow_id'],
    ])
  })

  it('should keep #context# prompt placeholders when creating a snippet from workflow selection', () => {
    const selectedNodes = [
      createNode('llm', {
        type: BlockEnum.LLM,
        context: {
          enabled: true,
          variable_selector: ['code', 'result'],
        },
        prompt: '{{#context#}} {{#code.summary#}}',
      }),
    ]
    const onClose = vi.fn()

    const { result } = renderHook(() => useCreateSnippetFromSelection({
      edges: [],
      selectedNodes,
      onClose,
    }))

    act(() => {
      result.current.handleOpenCreateSnippet()
    })

    const dialogProps = (result.current.createSnippetDialog as ReactElement<DialogProps>).props
    const nodeData = dialogProps.selectedGraph?.nodes[0]?.data as {
      context?: {
        enabled: boolean
        variable_selector: string[]
      }
      prompt?: string
    }

    expect(dialogProps.inputFields).toEqual([
      {
        label: 'result',
        variable: 'result',
        type: PipelineInputVarType.textInput,
        required: true,
      },
      {
        label: 'summary',
        variable: 'summary',
        type: PipelineInputVarType.textInput,
        required: true,
      },
    ])
    expect(nodeData.context).toEqual({
      enabled: true,
      variable_selector: [SNIPPET_INPUT_FIELD_NODE_ID, 'result'],
    })
    expect(nodeData.prompt).toBe(`{{#context#}} {{#${SNIPPET_INPUT_FIELD_NODE_ID}.summary#}}`)
  })
})
