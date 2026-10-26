import type { SchemaDefinitionItemResponse } from '@dify/contracts/api/console/spec/types.gen'
import type { ToolWithProvider } from '../../types'
import type { VarInInspect } from '@/types/workflow'
import { act } from '@testing-library/react'
import { useReactFlow } from 'reactflow'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowCanvasHook } from '../../__tests__/workflow-test-env'
import { BlockEnum, NodeRunningStatus, VarType } from '../../types'
import { useSetWorkflowVarsWithValue } from '../use-fetch-workflow-inspect-vars'

const mockFetchAllInspectVars = vi.hoisted(() => vi.fn())
const schemaTypeDefinitions: SchemaDefinitionItemResponse[] = [
  {
    name: 'simple',
    label: 'Simple',
    schema: {
      properties: {},
    },
  },
]

vi.mock('@/service/workflow', () => ({
  fetchAllInspectVars: (...args: unknown[]) => mockFetchAllInspectVars(...args),
}))

const createInspectVar = (overrides: Partial<VarInInspect> = {}): VarInInspect => ({
  id: 'var-1',
  type: 'node',
  name: 'answer',
  description: 'Answer',
  selector: ['node-1', 'answer'],
  value_type: VarType.string,
  value: 'hello',
  edited: false,
  visible: true,
  is_truncated: false,
  full_content: {
    size_bytes: 5,
    download_url: 'https://example.com/answer.txt',
  },
  ...overrides,
})

const nodes = [
  createNode({
    id: 'node-1',
    data: {
      type: BlockEnum.Code,
      title: 'Code',
      desc: '',
      outputs: { answer: { type: VarType.string } },
      _runningStatus: NodeRunningStatus.Succeeded,
    },
  }),
]

const variableQueryKeys = [
  consoleQuery.apps.byAppId.workflows.draft.conversationVariables.get,
  consoleQuery.apps.byAppId.workflows.draft.systemVariables.get,
].map((endpoint) => endpoint.queryKey({ input: { params: { app_id: 'app-1' } } }))

function setup(canvasNodes = nodes) {
  const { queryClient } = createConsoleQueryWrapper()
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(
    consoleQuery.spec.schemaDefinitions.get.queryKey(),
    schemaTypeDefinitions,
  )
  for (const key of variableQueryKeys)
    queryClient.setQueryData(key, {
      items: [{ ...createInspectVar(), value: 'cached', full_content: null }],
    })
  return {
    ...renderWorkflowCanvasHook(
      () => ({
        ...useSetWorkflowVarsWithValue(),
        getNodes: useReactFlow().getNodes,
      }),
      { nodes: canvasNodes, queryClient, initialStoreState: { dataSourceList: [] } },
    ),
    queryClient,
  }
}

describe('use-fetch-workflow-inspect-vars', () => {
  beforeEach(() => {
    mockFetchAllInspectVars.mockReset()
  })

  it('fetches inspect vars, invalidates cached values, and stores node vars with their real output metadata', async () => {
    mockFetchAllInspectVars.mockResolvedValue([
      createInspectVar(),
      createInspectVar({
        id: 'missing-node-var',
        selector: ['missing-node', 'answer'],
      }),
    ])

    const { result, store, queryClient } = setup()

    await act(async () => {
      await result.current.fetchInspectVars({})
    })

    for (const key of variableQueryKeys)
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
    expect(mockFetchAllInspectVars).toHaveBeenCalledWith({
      kind: 'app',
      appId: 'app-1',
      mode: 'workflow',
    })
    expect(result.current.getNodes()[0]!.data._runningStatus).toBeUndefined()
    expect(store.getState().nodesWithInspectVars).toEqual([
      expect.objectContaining({
        nodeId: 'node-1',
        nodeType: BlockEnum.Code,
        title: 'Code',
        vars: [
          expect.objectContaining({
            id: 'var-1',
            selector: ['node-1', 'answer'],
            schemaType: undefined,
            value: 'hello',
          }),
        ],
      }),
    ])
  })

  it('accepts passed-in vars and plugin metadata without refetching from the API', async () => {
    const passedInVars = [
      createInspectVar({
        id: 'var-2',
        value: 'passed-in',
      }),
    ]
    const passedInPluginInfo = {
      buildInTools: [],
      customTools: [],
      workflowTools: [],
      mcpTools: [],
      dataSourceList: [],
    }

    const { result, store } = setup()

    await act(async () => {
      await result.current.fetchInspectVars({
        passInVars: true,
        vars: passedInVars,
        passedInAllPluginInfoList: passedInPluginInfo,
        passedInSchemaTypeDefinitions: schemaTypeDefinitions,
      })
    })

    expect(mockFetchAllInspectVars).not.toHaveBeenCalled()
    expect(store.getState().nodesWithInspectVars[0]?.vars[0]).toMatchObject({
      id: 'var-2',
      value: 'passed-in',
      schemaType: undefined,
    })
  })
})

it('derives schema enrichment from the passed-in tool catalog and schema definition', async () => {
  const toolNodes = [
    createNode({
      id: 'node-1',
      data: {
        type: BlockEnum.Tool,
        provider_type: 'builtin',
        provider_id: 'provider-1',
        tool_name: 'answer-tool',
      },
    }),
  ]
  const localized = { en_US: 'Answer', zh_Hans: 'Answer' }
  const provider: ToolWithProvider = {
    id: 'provider-1',
    name: 'provider',
    type: 'builtin',
    author: 'Dify',
    description: localized,
    label: localized,
    icon: '',
    team_credentials: {},
    is_team_authorization: true,
    allow_delete: false,
    labels: [],
    tools: [
      {
        name: 'answer-tool',
        author: 'Dify',
        label: localized,
        description: localized,
        parameters: [],
        labels: [],
        output_schema: {
          type: 'object',
          properties: { answer: { type: 'object', properties: { text: { type: 'string' } } } },
        },
      },
    ],
  }
  const { result, store } = setup(toolNodes)
  await act(async () =>
    result.current.fetchInspectVars({
      passInVars: true,
      vars: [createInspectVar({ value_type: VarType.object, value: { text: 'hello' } })],
      passedInAllPluginInfoList: {
        buildInTools: [provider],
        customTools: [],
        workflowTools: [],
        mcpTools: [],
        dataSourceList: [],
      },
      passedInSchemaTypeDefinitions: [
        {
          name: 'answer-schema',
          label: 'Answer',
          schema: { type: 'object', properties: { text: { type: 'string' } } },
        },
      ],
    }),
  )
  expect(store.getState().nodesWithInspectVars[0]?.vars[0]).toMatchObject({
    name: 'answer',
    value: { text: 'hello' },
    schemaType: 'answer-schema',
  })
})
