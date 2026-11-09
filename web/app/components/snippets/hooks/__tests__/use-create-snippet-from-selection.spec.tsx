import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
import type { Edge, EnvironmentVariable } from '@/app/components/workflow/types'
import type { SnippetCanvasData } from '@/models/snippet'
import type { consoleClient } from '@/service/console'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNode as createWorkflowNode } from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { PipelineInputVarType } from '@/models/pipeline'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { useCreateSnippetFromSelection } from '../use-create-snippet-from-selection'

const SNIPPET_INPUT_FIELD_NODE_ID = 'start'
const api = vi.hoisted(() => ({
  create: vi.fn<typeof consoleClient.workspaces.current.customizedSnippets.post>(),
  save: vi.fn<typeof consoleClient.snippets.bySnippetId.workflows.draft.post>(),
  push: vi.fn(),
}))
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: api.push }) }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.customizedSnippets.post': api.create,
      'snippets.bySnippetId.workflows.draft.post': api.save,
    }),
  }
})

function renderSelection(params: Parameters<typeof useCreateSnippetFromSelection>[0]) {
  function Selection() {
    const { handleOpenCreateSnippet, createSnippetDialog } = useCreateSnippetFromSelection(params)
    return (
      <>
        <button type="button" onClick={handleOpenCreateSnippet}>
          Create from selection
        </button>
        {createSnippetDialog}
      </>
    )
  }
  renderWithConsoleQuery(<Selection />, { workspacePermissionKeys: ['snippets.create_and_modify'] })
  return userEvent.setup()
}

vi.mock('@/app/notifications', () => ({
  toast: { error: vi.fn() },
}))

const submitDialog = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(
    screen.getByRole('textbox', { name: 'workflow.snippet.nameLabel' }),
    'Reusable selection',
  )
  await user.click(screen.getByRole('button', { name: 'workflow.snippet.confirm' }))
  await waitFor(() => expect(api.push).toHaveBeenCalledWith('/snippets/snippet-1/orchestrate'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(api.create).toHaveBeenCalledOnce()
  const submitted = api.create.mock.calls[0]![0].body
  expect(api.save).toHaveBeenCalledExactlyOnceWith({
    params: { snippet_id: 'snippet-1' },
    body: { graph: submitted.graph, input_fields: submitted.input_fields },
  })
  return { ...submitted, graph: submitted.graph as SnippetCanvasData }
}

const createNode = (
  id: string,
  data: NonNullable<Parameters<typeof createWorkflowNode>[0]>['data'],
) => createWorkflowNode({ id, width: 200, height: 100, data })

const llmEnvironmentVariable: EnvironmentVariable = {
  id: 'model-env',
  name: 'MODEL_NAME',
  value: {
    provider: 'new-provider',
    name: 'new-model',
    mode: 'chat',
    completion_params: { temperature: 0.8 },
  },
  value_type: 'llm',
  description: '',
}

describe('useCreateSnippetFromSelection', () => {
  beforeEach(() => {
    api.create.mockImplementation(async ({ body }) => ({
      id: 'snippet-1',
      name: body.name,
      type: body.type ?? 'group',
      description: body.description ?? null,
      graph: body.graph ?? {},
      input_fields: body.input_fields ?? [],
      created_at: 1,
      created_by: null,
      updated_at: 1,
      updated_by: null,
      is_published: false,
      icon_info: null,
      tags: [],
      use_count: 0,
      version: 1,
    }))
    api.save.mockResolvedValue({ result: 'success', hash: 'saved', updated_at: 1 })
  })

  it('should convert environment, conversation, and system variables into snippet input fields', async () => {
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
        model: { provider: 'old-provider', name: 'old-model', mode: 'chat', completion_params: {} },
        model_selector: ['env', 'MODEL_NAME'],
      }),
    ]
    const edges: Edge[] = []
    const onClose = vi.fn()

    const user = renderSelection({
      edges,
      environmentVariables: [llmEnvironmentVariable],
      selectedNodes,
      onClose,
    })

    await user.click(screen.getByRole('button', { name: 'Create from selection' }))

    const submitted = await submitDialog(user)

    expect(submitted.input_fields).toEqual([
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
    ])
    const nodeData = submitted.graph?.nodes[0]?.data as Record<string, unknown> | undefined

    expect(nodeData?.prompt).toBe(
      [
        `{{#${SNIPPET_INPUT_FIELD_NODE_ID}.API_KEY#}}`,
        `{{#${SNIPPET_INPUT_FIELD_NODE_ID}.user_name#}}`,
        `{{#${SNIPPET_INPUT_FIELD_NODE_ID}.user_id#}}`,
        '{{#rag.query#}}',
        `{{#${SNIPPET_INPUT_FIELD_NODE_ID}.result#}}`,
      ].join(' '),
    )
    expect(nodeData?.model_selector).toBeUndefined()
    expect(nodeData?.model).toEqual({
      provider: 'new-provider',
      name: 'new-model',
      mode: 'chat',
      completion_params: { temperature: 0.8 },
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('should preserve legacy non-environment model selectors', async () => {
    const selectedNodes = [
      createNode('llm', {
        type: BlockEnum.LLM,
        model: {
          provider: 'static-provider',
          name: 'static-model',
          mode: 'chat',
          completion_params: {},
        },
        model_selector: ['start', 'MODEL_NAME'],
      }),
    ]
    const user = renderSelection({
      edges: [],
      environmentVariables: [],
      selectedNodes,
      onClose: vi.fn(),
    })

    await user.click(screen.getByRole('button', { name: 'Create from selection' }))

    const submitted = await submitDialog(user)
    expect(submitted.input_fields).toEqual([])
    expect((submitted.graph?.nodes[0]?.data as LLMNodeType).model_selector).toEqual([
      'start',
      'MODEL_NAME',
    ])
  })

  it('should reject an unresolved LLM environment model when creating a snippet', async () => {
    const selectedNodes = [
      createNode('llm', {
        type: BlockEnum.LLM,
        model: {
          provider: 'stale-provider',
          name: 'stale-model',
          mode: 'chat',
          completion_params: {},
        },
        model_selector: [],
      }),
    ]
    const onClose = vi.fn()
    const user = renderSelection({
      edges: [],
      environmentVariables: [],
      selectedNodes,
      onClose,
    })

    await user.click(screen.getByRole('button', { name: 'Create from selection' }))

    expect(toast.error).toHaveBeenCalledWith(
      'workflow.errorMsg.fieldRequired:{"field":"workflow.errorMsg.fields.model"}',
    )
    expect(api.create).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('should convert system variables used by if-else and variable aggregator nodes', async () => {
    const selectedNodes = [
      createNode('llm', {
        type: BlockEnum.LLM,
        title: 'LLM',
      }),
      createNode('if-else', {
        type: BlockEnum.IfElse,
        cases: [
          {
            case_id: 'case-1',
            conditions: [
              {
                id: 'condition-1',
                variable_selector: ['sys', 'query'],
                comparison_operator: 'contains',
                value: 'hello',
              },
            ],
          },
        ],
      }),
      createNode('variable-aggregator', {
        type: BlockEnum.VariableAggregator,
        variables: [
          ['sys', 'files'],
          ['llm', 'text'],
        ],
        advanced_settings: {
          group_enabled: true,
          groups: [
            {
              groupId: 'group-1',
              group_name: 'Group1',
              variables: [['sys', 'workflow_id']],
            },
          ],
        },
      }),
    ]
    const onClose = vi.fn()

    const user = renderSelection({
      edges: [],
      environmentVariables: [],
      selectedNodes,
      onClose,
    })

    await user.click(screen.getByRole('button', { name: 'Create from selection' }))

    const submitted = await submitDialog(user)

    expect(submitted.input_fields).toEqual([
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

    const ifElseNode = submitted.graph?.nodes.find((node) => node.id === 'if-else')
    const aggregatorNode = submitted.graph?.nodes.find((node) => node.id === 'variable-aggregator')
    const ifElseData = ifElseNode?.data as Record<string, unknown>
    const aggregatorData = aggregatorNode?.data as {
      variables?: string[][]
      advanced_settings?: { groups?: Array<{ variables?: string[][] }> }
    }

    expect(ifElseData.cases).toEqual([
      {
        case_id: 'case-1',
        conditions: [
          {
            id: 'condition-1',
            variable_selector: [SNIPPET_INPUT_FIELD_NODE_ID, 'query'],
            comparison_operator: 'contains',
            value: 'hello',
          },
        ],
      },
    ])
    expect(aggregatorData.variables).toEqual([
      [SNIPPET_INPUT_FIELD_NODE_ID, 'files'],
      ['llm', 'text'],
    ])
    expect(aggregatorData.advanced_settings?.groups?.[0]?.variables).toEqual([
      [SNIPPET_INPUT_FIELD_NODE_ID, 'workflow_id'],
    ])
  })

  it('should keep #context# prompt placeholders when creating a snippet from workflow selection', async () => {
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

    const user = renderSelection({
      edges: [],
      environmentVariables: [],
      selectedNodes,
      onClose,
    })

    await user.click(screen.getByRole('button', { name: 'Create from selection' }))

    const submitted = await submitDialog(user)
    const nodeData = submitted.graph?.nodes[0]?.data as {
      context?: {
        enabled: boolean
        variable_selector: string[]
      }
      prompt?: string
    }

    expect(submitted.input_fields).toEqual([
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
