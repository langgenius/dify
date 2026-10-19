import type { AgentSoulDifyToolConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { ToolProviderListResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { PluginsFromMarketplaceByInfoResponse } from '@dify/contracts/marketplace'
import type { ReactNode } from 'react'
import type { AvailableNodesMetaData } from '../../hooks-store/store'
import type { CodeNodeType } from '../../nodes/code/types'
import type { CommonEdgeType, CommonNodeType, Edge, Node } from '../../types'
import type { ChecklistItem } from '../use-checklist'
import { zWorkflowAgentComposerResponse } from '@dify/contracts/api/console/apps/zod.gen'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import ReactFlow, { ReactFlowProvider, useEdges, useNodes } from 'reactflow'
import { CollectionType } from '@/app/components/tools/types'
import { toast } from '@/app/notifications'
import { AppToastHost } from '@/app/notifications/host'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createMarketplacePluginFixture } from '@/test/fixtures/plugin'
import {
  createEdge,
  createNode,
  createStartNode,
  resetFixtureCounters,
} from '../../__tests__/fixtures'
import { createTestWorkflowStore } from '../../__tests__/workflow-test-env'
import { WorkflowContext } from '../../context'
import DatasetsDetailProvider from '../../datasets-detail-store/provider'
import { EditorResourceScope } from '../../editor-resource/provider'
import { HooksStoreContext } from '../../hooks-store/provider'
import { createHooksStore } from '../../hooks-store/store'
import { useWorkflowNodeCatalog } from '../../node-catalog'
import { CodeLanguage } from '../../nodes/code/types'
import llmDefault from '../../nodes/llm/default'
import { useStore } from '../../store'
import { BlockEnum, PromptRole, VarType } from '../../types'
import { useChecklist, useChecklistBeforePublish, useWorkflowRunValidation } from '../use-checklist'

const marketplace = vi.hoisted(() =>
  vi.fn<
    (url: string, options: unknown) => Promise<{ data: PluginsFromMarketplaceByInfoResponse }>
  >(),
)
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  postMarketplace: marketplace,
}))

function createChecklistQueryClient(builtInTools: ToolProviderListResponse = []) {
  const { queryClient } = createConsoleQueryWrapper()
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, { builtInTools, customTools: [], workflowTools: [], mcpTools: [] })
  queryClient.setQueryData(consoleQuery.workspaces.current.agentProviders.get.queryKey(), [])
  queryClient.setQueryData(consoleQuery.workspaces.current.triggers.get.queryKey({ input: {} }), [])
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  return queryClient
}

type Graph = { nodes: Node[]; edges: Edge[] }
type ChecklistOptions = { queryClient?: ReturnType<typeof createChecklistQueryClient> }

function CatalogProvider({ children }: { children: ReactNode }) {
  const catalog = useWorkflowNodeCatalog()
  // The production catalog is mode-specific; the store types its map as every BlockEnum.
  const nodesMap = catalog.nodesMap as NonNullable<AvailableNodesMetaData['nodesMap']>
  const [store] = useState(() =>
    createHooksStore({
      availableNodesMetaData: {
        nodes: catalog.nodes.map((node) => nodesMap[node.metaData.type]),
        nodesMap,
      },
    }),
  )
  return <HooksStoreContext value={store}>{children}</HooksStoreContext>
}

function createChecklistWrapper({ nodes, edges }: Graph, options: ChecklistOptions = {}) {
  const queryClient = options.queryClient ?? createChecklistQueryClient()
  const { wrapper: QueryProvider } = createConsoleQueryWrapper({ queryClient })
  const store = createTestWorkflowStore({ nodes })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryProvider>
      <EditorResourceScope resource={{ kind: 'app', appId: 'app-1', mode: 'workflow' }}>
        <WorkflowContext value={store}>
          <CatalogProvider>
            <DatasetsDetailProvider nodes={nodes}>
              <ReactFlowProvider>
                <ReactFlow nodes={nodes} edges={edges} />
                {children}
                <AppToastHost timeout={0} />
              </ReactFlowProvider>
            </DatasetsDetailProvider>
          </CatalogProvider>
        </WorkflowContext>
      </EditorResourceScope>
    </QueryProvider>
  )
  return { wrapper, store }
}

function renderChecklist(nodes: Node[], edges: Edge[], options: ChecklistOptions = {}) {
  const { wrapper, store } = createChecklistWrapper({ nodes, edges }, options)
  return {
    ...renderHook(
      () => {
        const graphNodes = useNodes<CommonNodeType>()
        const graphEdges = useEdges<CommonEdgeType>()
        return useChecklist(graphNodes, graphEdges)
      },
      { wrapper },
    ),
    store,
  }
}

beforeEach(() => {
  resetFixtureCounters()
  marketplace.mockReset().mockImplementation((url: string) => {
    throw new Error(`Unexpected marketplace request: ${url}`)
  })
})
afterEach(() => {
  act(() => toast.dismiss())
})

function createInputNode() {
  return createStartNode({ id: 'start', data: { variables: [] } })
}

function createCodeNode() {
  const data = {
    type: BlockEnum.Code,
    title: 'Code',
    desc: '',
    code_language: CodeLanguage.python3,
    code: 'def main():\n    return {"result": 1}',
    variables: [],
    outputs: { result: { type: VarType.number, children: null } },
  } satisfies CodeNodeType
  return createNode({ id: 'code', data })
}

function buildConnectedGraph() {
  const startNode = createInputNode()
  const codeNode = createCodeNode()
  const endNode = createNode({
    id: 'end',
    data: {
      type: BlockEnum.End,
      title: 'End',
      outputs: [{ variable: 'result', value_selector: ['code', 'result'] }],
    },
  })
  const nodes = [startNode, codeNode, endNode]
  const edges = [
    createEdge({ source: 'start', target: 'code' }),
    createEdge({ source: 'code', target: 'end' }),
  ]
  return { nodes, edges }
}

function buildLegacyAgentGraph() {
  const startNode = createInputNode()
  const agentNode = createNode({
    id: 'legacy-agent',
    data: {
      type: BlockEnum.Agent,
      title: 'Legacy Agent',
      agent_strategy_provider_name: 'provider',
      agent_strategy_name: 'strategy',
    },
  })

  return {
    nodes: [startNode, agentNode],
    edges: [createEdge({ source: 'start', target: 'legacy-agent' })],
  }
}

function buildInlineAgentGraph({
  difyTools = [],
  hasModel = true,
  hasMissingFile = false,
  hasMissingSkill = false,
}: {
  difyTools?: AgentSoulDifyToolConfig[]
  hasModel?: boolean
  hasMissingFile?: boolean
  hasMissingSkill?: boolean
}) {
  const queryClient = createChecklistQueryClient()
  const appId = 'app-1'
  const nodeId = 'inline-agent-node'
  queryClient.setQueryData(consoleQuery.workspaces.current.agentProviders.get.queryKey(), [])
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey({
      input: {
        params: {
          app_id: appId,
          node_id: nodeId,
        },
      },
    }),
    zWorkflowAgentComposerResponse.parse({
      agent_soul: {
        model: hasModel
          ? {
              model_provider: 'langgenius/openai/openai',
              model: 'gpt-4o-mini',
              plugin_id: 'langgenius/openai',
            }
          : undefined,
        config_files: [
          { file_kind: 'upload_file', name: 'available.pdf' },
          ...(hasMissingFile
            ? [{ file_kind: 'upload_file', is_missing: true, name: 'missing.pdf' }]
            : []),
        ],
        config_skills: [
          { name: 'Available Skill' },
          ...(hasMissingSkill ? [{ is_missing: true, name: 'Missing Skill' }] : []),
        ],
        tools: {
          dify_tools: difyTools,
        },
      },
      node_job: {},
      save_options: [],
      soul_lock: { locked: false },
      variant: 'workflow',
    }),
  )

  const startNode = createInputNode()
  const agentNode = createNode({
    id: nodeId,
    data: {
      type: BlockEnum.AgentV2,
      title: 'Inline Agent',
      agent_node_kind: 'dify_agent',
      version: '2',
      agent_binding: {
        binding_type: 'inline_agent',
        agent_id: 'inline-agent-id',
        current_snapshot_id: 'snapshot-id',
      },
    },
  })

  return {
    edges: [createEdge({ source: 'start', target: nodeId })],
    nodeId,
    nodes: [startNode, agentNode],
    options: {
      queryClient,
    },
  }
}

const credentialRequiredProvider = createToolProviderFixture({
  id: 'google',
  name: 'google',
  label: { en_US: 'Google Tools' },
  team_credentials: {
    api_key: {
      label: { en_US: 'API Key' },
      required: true,
      type: 'secret-input',
      variable: 'api_key',
    },
  },
  is_team_authorization: false,
})

describe('useChecklist', () => {
  it('should return empty list when all nodes are valid and connected', async () => {
    const { nodes, edges } = buildConnectedGraph()

    const { result } = renderChecklist(nodes, edges)

    await waitFor(() => expect(result.current).toEqual([]))
  })

  it('should detect disconnected nodes', () => {
    const startNode = createInputNode()
    const codeNode = createCodeNode()
    const isolatedLlm = createNode({
      id: 'llm',
      data: { ...llmDefault.defaultValue, type: BlockEnum.LLM, title: 'LLM' },
    })

    const edges = [createEdge({ source: 'start', target: 'code' })]

    const { result } = renderChecklist([startNode, codeNode, isolatedLlm], edges)

    const warning = result.current.find((item: ChecklistItem) => item.id === 'llm')
    expect(warning).toBeDefined()
    expect(warning!.unConnected).toBe(true)
  })

  it('reports a missing model from the real LLM validator', () => {
    const startNode = createInputNode()
    const llmNode = createNode({
      id: 'llm',
      data: { ...llmDefault.defaultValue, type: BlockEnum.LLM, title: 'LLM' },
    })

    const edges = [createEdge({ source: 'start', target: 'llm' })]

    const { result } = renderChecklist([startNode, llmNode], edges)

    const warning = result.current.find((item: ChecklistItem) => item.id === 'llm')
    expect(warning).toBeDefined()
    expect(warning!.errorMessages).toContain(
      'workflow.errorMsg.fieldRequired:{"field":"workflow.errorMsg.fields.model"}',
    )
  })

  it('reports an unavailable strategy for legacy Agent nodes', async () => {
    const { nodes, edges } = buildLegacyAgentGraph()

    const { result } = renderChecklist(nodes, edges)

    await waitFor(() =>
      expect(result.current).toEqual([
        expect.objectContaining({
          id: 'legacy-agent',
          errorMessages: ['workflow.nodes.agent.checkList.strategyNotSelected'],
        }),
      ]),
    )
  })

  it.each([
    {
      errorMessage: 'agentV2.agentDetail.configure.files.missing',
      hasMissingFile: true,
      hasMissingSkill: false,
      referenceType: 'file',
    },
    {
      errorMessage: 'agentV2.agentDetail.configure.skills.missing',
      hasMissingFile: false,
      hasMissingSkill: true,
      referenceType: 'skill',
    },
  ])('should report a missing $referenceType reference from inline agents', async (scenario) => {
    const { edges, nodeId, nodes, options } = buildInlineAgentGraph(scenario)
    const { result } = renderChecklist(nodes, edges, options)

    await waitFor(() => {
      expect(result.current).toEqual([
        expect.objectContaining({
          id: nodeId,
          errorMessages: [scenario.errorMessage],
          openInlineAgentPanel: true,
        }),
      ])
    })
  })

  it('should report a missing model from inline agents and open their configuration panel', async () => {
    const { edges, nodeId, nodes, options } = buildInlineAgentGraph({ hasModel: false })
    const { result } = renderChecklist(nodes, edges, options)

    await waitFor(() => {
      expect(result.current).toEqual([
        expect.objectContaining({
          id: nodeId,
          errorMessages: ['workflow.nodes.agent.modelNotSelected'],
          openInlineAgentPanel: true,
        }),
      ])
    })
  })

  it('should not report available file and skill references from inline agents', () => {
    const { edges, nodes, options } = buildInlineAgentGraph({
      hasMissingFile: false,
      hasMissingSkill: false,
    })
    const { result } = renderChecklist(nodes, edges, options)

    expect(result.current).toEqual([])
  })

  it('should report uninstalled tools from inline agents and open their configuration panel', async () => {
    marketplace.mockResolvedValue({
      data: {
        list: [
          {
            plugin: createMarketplacePluginFixture({
              org: 'langgenius',
              name: 'jina_tool',
              plugin_id: 'langgenius/jina_tool',
              label: { en_US: 'Jina' },
            }),
            version: {
              plugin_name: 'jina_tool',
              plugin_org: 'langgenius',
              unique_identifier: 'langgenius/jina_tool:1.0.0',
            },
          },
        ],
      },
    })
    const { edges, nodeId, nodes, options } = buildInlineAgentGraph({
      difyTools: [
        {
          credential_type: 'unauthorized',
          plugin_id: 'langgenius/jina_tool',
          provider: 'langgenius/jina_tool/jina',
          provider_id: 'langgenius/jina_tool/jina',
          provider_type: 'plugin',
          tool_name: 'search',
        },
      ],
    })
    const { result } = renderChecklist(nodes, edges, options)

    await waitFor(() => {
      expect(result.current).toEqual([
        expect.objectContaining({
          id: nodeId,
          errorMessages: ['workflow.nodes.agent.toolNotInstallTooltip:{"tool":"Jina"}'],
          openInlineAgentPanel: true,
        }),
      ])
    })
  })

  it('should report unauthorized tools from inline agents and open their configuration panel', async () => {
    const { edges, nodeId, nodes, options } = buildInlineAgentGraph({
      difyTools: [
        {
          credential_type: 'unauthorized',
          provider: 'google',
          provider_id: 'google',
          provider_type: 'builtin',
          tool_name: 'search',
        },
      ],
    })
    seedToolProviders(options.queryClient, { builtInTools: [credentialRequiredProvider] })
    const { result } = renderChecklist(nodes, edges, options)

    await waitFor(() => {
      expect(result.current).toEqual([
        expect.objectContaining({
          id: nodeId,
          errorMessages: ['workflow.nodes.agent.toolNotAuthorizedTooltip:{"tool":"Google Tools"}'],
          openInlineAgentPanel: true,
        }),
      ])
    })
  })

  it('should report missing start node in workflow mode', () => {
    const codeNode = createCodeNode()

    const { result } = renderChecklist([codeNode], [])

    const startRequired = result.current.find(
      (item: ChecklistItem) => item.id === 'start-node-required',
    )
    expect(startRequired).toBeDefined()
    expect(startRequired!.canNavigate).toBe(false)
  })

  it('should not report the global missing start node item when a start placeholder is present', () => {
    const placeholderNode = createNode({
      id: 'start-placeholder',
      data: { type: BlockEnum.StartPlaceholder, title: 'Workflow start' },
    })

    const { result } = renderChecklist([placeholderNode], [])

    expect(
      result.current.find((item: ChecklistItem) => item.id === 'start-node-required'),
    ).toBeUndefined()
    expect(result.current).toEqual([
      expect.objectContaining({
        id: 'start-placeholder',
        type: BlockEnum.StartPlaceholder,
        unConnected: false,
        errorMessages: ['workflow.nodes.startPlaceholder.validationRequired'],
      }),
    ])
  })

  it('should detect plugin not installed', async () => {
    const startNode = createInputNode()
    const toolNode = createNode({
      id: 'tool',
      data: {
        type: BlockEnum.Tool,
        tool_parameters: {},
        title: 'My Tool',
        provider_type: CollectionType.builtIn,
        provider_id: 'missing-provider',
        plugin_unique_identifier: 'plugin/tool@0.0.1',
      },
    })

    const edges = [createEdge({ source: 'start', target: 'tool' })]

    const { result } = renderChecklist([startNode, toolNode], edges)

    await waitFor(() =>
      expect(result.current.find((item: ChecklistItem) => item.id === 'tool')).toBeDefined(),
    )
    const warning = result.current.find((item: ChecklistItem) => item.id === 'tool')
    expect(warning).toBeDefined()
    expect(warning!.canNavigate).toBe(false)
    expect(warning!.disableGoTo).toBe(true)
    expect(warning!.isPluginMissing).toBe(true)
    expect(warning!.pluginUniqueIdentifier).toBe('plugin/tool@0.0.1')
    expect(warning!.errorMessages).toContain('workflow.nodes.common.pluginNotInstalled')
  })

  it('should not flag start nodes as unconnected', () => {
    const startNode = createInputNode()
    const codeNode = createCodeNode()

    const { result } = renderChecklist([startNode, codeNode], [])

    const startWarning = result.current.find((item: ChecklistItem) => item.id === 'start')
    expect(startWarning).toBeUndefined()
  })

  it('should report configure model errors when an llm model provider plugin is missing', () => {
    const startNode = createInputNode()
    const llmNode = createNode({
      id: 'llm',
      data: {
        ...llmDefault.defaultValue,
        type: BlockEnum.LLM,
        title: 'LLM',
        model: {
          provider: 'langgenius/openai/openai',
          name: 'gpt-4o-mini',
          mode: 'chat',
          completion_params: {},
        },
      },
    })

    const edges = [createEdge({ source: 'start', target: 'llm' })]

    const { result } = renderChecklist([startNode, llmNode], edges)

    const warning = result.current.find((item: ChecklistItem) => item.id === 'llm')
    expect(warning).toBeDefined()
    expect(warning!.errorMessages).toContain('workflow.errorMsg.configureModel')
    expect(warning!.canNavigate).toBe(true)
  })

  it('should accumulate validation and invalid variable errors for the same node', () => {
    const startNode = createInputNode()
    const llmNode = createNode({
      id: 'llm',
      data: {
        ...llmDefault.defaultValue,
        type: BlockEnum.LLM,
        title: 'LLM',
        prompt_template: [{ role: PromptRole.user, text: '{{#start.missingVar#}}' }],
      },
    })

    const edges = [createEdge({ source: 'start', target: 'llm' })]

    const { result } = renderChecklist([startNode, llmNode], edges)

    const warning = result.current.find((item: ChecklistItem) => item.id === 'llm')
    expect(warning).toBeDefined()
    expect(warning!.errorMessages).toEqual([
      'workflow.errorMsg.fieldRequired:{"field":"workflow.errorMsg.fields.model"}',
      'workflow.errorMsg.invalidVariable',
    ])
  })

  it('should detect duplicate output variables across end nodes', () => {
    const startNode = createInputNode()
    const firstEndNode = createNode({
      id: 'end-1',
      data: {
        type: BlockEnum.End,
        title: 'Output 1',
        outputs: [{ variable: 'workflow_id', value_selector: ['sys', 'workflow_id'] }],
      },
    })
    const secondEndNode = createNode({
      id: 'end-2',
      data: {
        type: BlockEnum.End,
        title: 'Output 2',
        outputs: [{ variable: 'workflow_id', value_selector: ['sys', 'workflow_id'] }],
      },
    })

    const edges = [
      createEdge({ source: 'start', target: 'end-1' }),
      createEdge({ source: 'start', target: 'end-2' }),
    ]

    const { result } = renderChecklist([startNode, firstEndNode, secondEndNode], edges)

    const firstWarning = result.current.find((item: ChecklistItem) => item.id === 'end-1')
    const secondWarning = result.current.find((item: ChecklistItem) => item.id === 'end-2')

    expect(
      firstWarning?.errorMessages.some((message) => message.includes('duplicateOutputVariable')),
    ).toBe(true)
    expect(
      secondWarning?.errorMessages.some((message) => message.includes('duplicateOutputVariable')),
    ).toBe(true)
  })

  it('publishes checklist errors to a sibling store consumer', async () => {
    const { nodes } = buildConnectedGraph()
    function Operator() {
      const checklistItems = useStore((state) => state.checklistItems)
      return (
        <output aria-label="Workflow warnings">
          {checklistItems.map((item) => item.title).join(', ')}
        </output>
      )
    }
    function WorkflowChecklist() {
      useChecklist(nodes, [])
      return null
    }
    const { wrapper } = createChecklistWrapper({ nodes, edges: [] })
    render(
      <>
        <Operator />
        <WorkflowChecklist />
      </>,
      { wrapper },
    )
    expect(await screen.findByRole('status', { name: 'Workflow warnings' })).toHaveTextContent(
      'Code, End',
    )
  })
})

describe('useChecklistBeforePublish', () => {
  it('rejects an invalid legacy Agent using the real catalog and graph', async () => {
    const graph = buildLegacyAgentGraph()
    const { wrapper } = createChecklistWrapper(graph)
    const { result } = renderHook(() => useChecklistBeforePublish(), { wrapper })
    await act(async () => {
      expect(await result.current.handleCheckBeforePublish()).toBe(false)
    })
  })
})

describe('useWorkflowRunValidation', () => {
  it('blocks a run with disconnected nodes and explains why', async () => {
    const { nodes } = buildConnectedGraph()
    const { wrapper } = createChecklistWrapper({ nodes, edges: [] })
    const { result } = renderHook(() => useWorkflowRunValidation(), { wrapper })
    expect(result.current.hasValidationErrors).toBe(true)
    expect(result.current.warningNodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ unConnected: true })]),
    )
    act(() => {
      expect(result.current.validateBeforeRun()).toBe(false)
    })
    expect(await screen.findByText('workflow.panel.checklistTip')).toBeVisible()
  })

  it('allows a connected graph with valid configuration and resolved output variables', () => {
    const { wrapper } = createChecklistWrapper(buildConnectedGraph())
    const { result } = renderHook(() => useWorkflowRunValidation(), { wrapper })
    expect(result.current.hasValidationErrors).toBe(false)
    expect(result.current.warningNodes).toEqual([])
    expect(result.current.validateBeforeRun()).toBe(true)
    expect(screen.queryByText('workflow.panel.checklistTip')).not.toBeInTheDocument()
  })
})
