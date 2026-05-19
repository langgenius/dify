'use client'

import type { AgentToolResult } from './types'
import type { Edge, Node } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'

type WorkflowAgentContextParams = {
  candidateNode?: Node
  controlMode: string
  edges: Edge[]
  isListening: boolean
  nodes: Node[]
  pathname: string
  pendingSingleRun?: {
    action: string
    nodeId: string
  }
  pluginCatalog?: WorkflowPluginCatalog
  selectedNodeId?: string
}

export type WorkflowDraftLike = {
  conversation_variables?: unknown[]
  environment_variables?: unknown[]
  features?: unknown
  graph: {
    edges: Edge[]
    nodes: Node[]
    viewport?: unknown
  }
  hash?: string
  id?: string
  updated_at?: number | string
  version?: string
}

type WorkflowGraphIssue = {
  code: string
  message: string
  node_ids?: string[]
  severity: 'error' | 'warning' | 'info'
}

type WorkflowPluginCatalog = {
  buildInTools?: unknown[]
  customTools?: unknown[]
  dataSourceList?: unknown[]
  mcpTools?: unknown[]
  triggerPlugins?: unknown[]
  workflowTools?: unknown[]
}

const ENTRY_NODE_TYPES = new Set<string>([
  BlockEnum.Start,
  BlockEnum.TriggerSchedule,
  BlockEnum.TriggerWebhook,
  BlockEnum.TriggerPlugin,
  BlockEnum.DataSource,
])

const TERMINAL_NODE_TYPES = new Set<string>([
  BlockEnum.End,
  BlockEnum.Answer,
])

const CONTROL_NODE_TYPES = new Set<string>([
  BlockEnum.IfElse,
  BlockEnum.QuestionClassifier,
  BlockEnum.Iteration,
  BlockEnum.Loop,
])

export const compactNodeData = (node: Node) => {
  const {
    data,
  } = node
  const dynamicData = data as Record<string, unknown>
  const toolLabel = dynamicData.tool_label ?? dynamicData.tool_name
  const providerName = dynamicData.provider_name

  return {
    id: node.id,
    title: data.title,
    type: data.type,
    description: data.desc,
    selected: Boolean(data.selected || node.selected),
    position: node.position,
    connected_source_handles: data._connectedSourceHandleIds,
    connected_target_handles: data._connectedTargetHandleIds,
    provider: typeof providerName === 'string' ? providerName : undefined,
    tool: typeof toolLabel === 'string' ? toolLabel : undefined,
    variable: 'variable' in data ? data.variable : undefined,
    variables: 'variables' in data ? data.variables : undefined,
  }
}

export const compactEdgeData = (edge: Edge) => ({
  id: edge.id,
  source: edge.source,
  source_handle: edge.sourceHandle,
  source_type: edge.data?.sourceType,
  target: edge.target,
  target_handle: edge.targetHandle,
  target_type: edge.data?.targetType,
})

const summarizeNode = (node: Node) => ({
  id: node.id,
  title: node.data.title,
  type: node.data.type,
})

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const getLocalizedText = (value: unknown, fallback = '') => {
  if (typeof value === 'string')
    return value

  if (!isRecord(value))
    return fallback

  const preferred = [
    value.en_US,
    value.zh_Hans,
    value.ja_JP,
    value.pt_BR,
  ].find(item => typeof item === 'string' && item.length > 0)

  return typeof preferred === 'string' ? preferred : fallback
}

const toRecordArray = (value: unknown): Record<string, unknown>[] => {
  return Array.isArray(value)
    ? value.filter(isRecord)
    : []
}

const compactCatalogParameter = (parameter: Record<string, unknown>) => {
  const name = typeof parameter.name === 'string' ? parameter.name : ''

  return {
    default: parameter.default,
    label: getLocalizedText(parameter.label, name),
    name,
    required: Boolean(parameter.required),
    type: typeof parameter.type === 'string' ? parameter.type : undefined,
  }
}

const compactCatalogTool = (tool: Record<string, unknown>) => {
  const parameters = toRecordArray(tool.parameters).map(compactCatalogParameter)

  return {
    description: getLocalizedText(tool.description, ''),
    label: getLocalizedText(tool.label, typeof tool.name === 'string' ? tool.name : ''),
    name: tool.name,
    parameters,
    required_parameters: parameters.filter(parameter => parameter.required).map(parameter => parameter.name),
  }
}

const compactCatalogToolProvider = (provider: Record<string, unknown>) => ({
  id: provider.id,
  label: getLocalizedText(provider.label, typeof provider.name === 'string' ? provider.name : ''),
  name: provider.name,
  plugin_id: provider.plugin_id,
  plugin_unique_identifier: provider.plugin_unique_identifier,
  tool_count: toRecordArray(provider.tools).length,
  tools: toRecordArray(provider.tools).map(compactCatalogTool),
  type: provider.type,
})

const compactCatalogTriggerProvider = (provider: Record<string, unknown>) => ({
  events: toRecordArray(provider.events).map((event) => {
    const identity = isRecord(event.identity) ? event.identity : {}
    const outputSchema = isRecord(event.output_schema) ? event.output_schema : {}
    const properties = isRecord(outputSchema.properties) ? outputSchema.properties : {}

    return {
      label: getLocalizedText(identity.label, typeof event.name === 'string' ? event.name : ''),
      name: event.name,
      output_schema_keys: Object.keys(properties),
      parameters: toRecordArray(event.parameters).map(compactCatalogParameter),
    }
  }),
  id: provider.id,
  label: getLocalizedText(provider.label, typeof provider.name === 'string' ? provider.name : ''),
  name: provider.name,
  plugin_id: provider.plugin_id,
  plugin_unique_identifier: provider.plugin_unique_identifier,
  type: provider.type,
})

const summarizePluginCatalog = (catalog?: WorkflowPluginCatalog) => {
  const buildInTools = toRecordArray(catalog?.buildInTools)
  const customTools = toRecordArray(catalog?.customTools)
  const workflowTools = toRecordArray(catalog?.workflowTools)
  const mcpTools = toRecordArray(catalog?.mcpTools)
  const triggerPlugins = toRecordArray(catalog?.triggerPlugins)

  return {
    data_sources: {
      count: Array.isArray(catalog?.dataSourceList) ? catalog.dataSourceList.length : 0,
    },
    tools: {
      builtin: buildInTools.map(compactCatalogToolProvider),
      custom: customTools.map(compactCatalogToolProvider),
      mcp: mcpTools.map(compactCatalogToolProvider),
      workflow: workflowTools.map(compactCatalogToolProvider),
    },
    triggers: triggerPlugins.map(compactCatalogTriggerProvider),
  }
}

const buildAdjacency = (nodes: Node[], edges: Edge[]) => {
  const nodeIds = new Set(nodes.map(node => node.id))
  const adjacency = new Map<string, string[]>()

  nodes.forEach((node) => {
    adjacency.set(node.id, [])
  })
  edges.forEach((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target))
      return

    adjacency.get(edge.source)?.push(edge.target)
  })

  return adjacency
}

const getReachableNodeIds = (entryNodes: Node[], adjacency: Map<string, string[]>) => {
  const reachable = new Set<string>()
  const queue = entryNodes.map(node => node.id)

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || reachable.has(current))
      continue

    reachable.add(current)
    adjacency.get(current)?.forEach((target) => {
      if (!reachable.has(target))
        queue.push(target)
    })
  }

  return reachable
}

const getStartVariables = (nodes: Node[]) => {
  return nodes
    .filter(node => ENTRY_NODE_TYPES.has(node.data.type))
    .flatMap((node) => {
      const variables = (node.data as Record<string, unknown>).variables
      return Array.isArray(variables)
        ? variables.map(variable => ({
            node_id: node.id,
            node_title: node.data.title,
            variable,
          }))
        : []
    })
}

const collectWorkflowGraphIssues = (nodes: Node[], edges: Edge[]): WorkflowGraphIssue[] => {
  const issues: WorkflowGraphIssue[] = []
  const nodeIds = new Set(nodes.map(node => node.id))
  const entryNodes = nodes.filter(node => ENTRY_NODE_TYPES.has(node.data.type))
  const terminalNodes = nodes.filter(node => TERMINAL_NODE_TYPES.has(node.data.type))
  const danglingEdges = edges.filter(edge => !nodeIds.has(edge.source) || !nodeIds.has(edge.target))

  if (nodes.length === 0) {
    issues.push({
      code: 'empty_graph',
      message: 'The workflow graph has no nodes.',
      severity: 'error',
    })
    return issues
  }

  if (entryNodes.length === 0) {
    issues.push({
      code: 'missing_entry_node',
      message: 'The workflow graph has no Start, Trigger, or Data Source entry node.',
      severity: 'error',
    })
  }

  if (terminalNodes.length === 0) {
    issues.push({
      code: 'missing_terminal_node',
      message: 'The workflow graph has no End or Answer terminal node.',
      severity: 'warning',
    })
  }

  if (danglingEdges.length > 0) {
    issues.push({
      code: 'dangling_edges',
      message: 'Some edges reference missing source or target nodes.',
      node_ids: Array.from(new Set(danglingEdges.flatMap(edge => [edge.source, edge.target]))),
      severity: 'error',
    })
  }

  const adjacency = buildAdjacency(nodes, edges)
  const reachable = getReachableNodeIds(entryNodes, adjacency)
  const unreachableNodes = entryNodes.length > 0
    ? nodes.filter(node => !reachable.has(node.id))
    : []

  if (unreachableNodes.length > 0) {
    issues.push({
      code: 'unreachable_nodes',
      message: 'Some nodes cannot be reached from any entry node.',
      node_ids: unreachableNodes.map(node => node.id),
      severity: 'warning',
    })
  }

  const orphanControlNodes = nodes.filter((node) => {
    if (!CONTROL_NODE_TYPES.has(node.data.type))
      return false

    return !edges.some(edge => edge.source === node.id)
  })

  if (orphanControlNodes.length > 0) {
    issues.push({
      code: 'control_nodes_without_outputs',
      message: 'Some branching, loop, or iteration nodes do not have outgoing edges.',
      node_ids: orphanControlNodes.map(node => node.id),
      severity: 'warning',
    })
  }

  return issues
}

export const getWorkflowConstructionGuide = (): AgentToolResult => ({
  graph_contract: {
    nodes: 'React Flow nodes. Each node must have id, type, position, and data.type/title/desc plus node-specific config.',
    edges: 'React Flow edges. Each edge must connect source -> target and should include sourceType and targetType in data.',
    draft_hash: 'Use the draft hash from dify_get_workflow_draft when syncing to avoid overwriting newer user edits.',
  },
  build_strategy: [
    'Start from the intended business process and map each decision, external call, LLM step, tool call, human approval, and final output to a node.',
    'Fetch default node configs before constructing node data so generated graphs match Dify backend validation.',
    'For complex workflow creation, prefer importing DSL or syncing a full draft graph, then use browser actions for targeted UI checks and small edits.',
    'After every structural edit, validate the graph, run the draft with representative inputs, inspect node executions, then publish.',
  ],
  node_types: {
    entry: [
      { type: BlockEnum.Start, use: 'Manual workflow input variables.' },
      { type: BlockEnum.TriggerSchedule, use: 'Time-based workflow entry.' },
      { type: BlockEnum.TriggerWebhook, use: 'HTTP webhook entry.' },
      { type: BlockEnum.TriggerPlugin, use: 'Plugin-provided trigger entry.' },
    ],
    reasoning_and_generation: [
      { type: BlockEnum.LLM, use: 'Prompt an LLM with variables, memory, model settings, and structured output.' },
      { type: BlockEnum.Agent, use: 'Run an agent strategy with tools and multi-step reasoning.' },
      { type: BlockEnum.QuestionClassifier, use: 'Classify input into branches.' },
    ],
    data_and_tools: [
      { type: BlockEnum.KnowledgeRetrieval, use: 'Retrieve records from knowledge datasets.' },
      { type: BlockEnum.Tool, use: 'Invoke built-in, custom, workflow, or MCP tools.' },
      { type: BlockEnum.HttpRequest, use: 'Call external HTTP APIs.' },
      { type: BlockEnum.DocExtractor, use: 'Extract content from files.' },
    ],
    control_flow: [
      { type: BlockEnum.IfElse, use: 'Branch by conditions.' },
      { type: BlockEnum.Iteration, use: 'Process list items.' },
      { type: BlockEnum.Loop, use: 'Repeat until an exit condition.' },
      { type: BlockEnum.LoopEnd, use: 'Exit a loop branch.' },
      { type: BlockEnum.HumanInput, use: 'Pause for human approval or form input.' },
    ],
    transform: [
      { type: BlockEnum.Code, use: 'Run Python/JavaScript transformations.' },
      { type: BlockEnum.TemplateTransform, use: 'Render text from variables.' },
      { type: BlockEnum.VariableAssigner, use: 'Assign or update variables.' },
      { type: BlockEnum.VariableAggregator, use: 'Merge variables from branches.' },
      { type: BlockEnum.ParameterExtractor, use: 'Extract structured fields from text.' },
      { type: BlockEnum.ListFilter, use: 'Filter or slice lists.' },
    ],
    terminal: [
      { type: BlockEnum.End, use: 'Return final workflow outputs.' },
      { type: BlockEnum.Answer, use: 'Return chatflow answer content.' },
    ],
  },
  debug_cycle: [
    'dify_get_workflow_node_default_config',
    'dify_search_marketplace_plugins',
    'dify_list_installed_plugin_capabilities',
    'dify_get_trigger_provider_detail',
    'dify_create_trigger_subscription_builder',
    'dify_get_trigger_subscription_builder_logs',
    'dify_validate_workflow_graph',
    'dify_run_workflow_draft',
    'dify_get_workflow_runs',
    'dify_get_workflow_run_detail',
    'dify_get_workflow_run_node_executions',
    'dify_sync_workflow_draft or dify_import_app_dsl',
    'dify_publish_workflow',
  ],
})

export const summarizeWorkflowGraph = (graph: WorkflowDraftLike['graph']): AgentToolResult => {
  const nodes = graph.nodes
  const edges = graph.edges
  const issues = collectWorkflowGraphIssues(nodes, edges)
  const nodeTypeCounts = nodes.reduce<Record<string, number>>((counts, node) => {
    counts[node.data.type] = (counts[node.data.type] ?? 0) + 1
    return counts
  }, {})
  const entryNodes = nodes.filter(node => ENTRY_NODE_TYPES.has(node.data.type))
  const terminalNodes = nodes.filter(node => TERMINAL_NODE_TYPES.has(node.data.type))

  return {
    edge_count: edges.length,
    edges: edges.map(compactEdgeData),
    entry_nodes: entryNodes.map(summarizeNode),
    error_count: issues.filter(issue => issue.severity === 'error').length,
    issues,
    node_count: nodes.length,
    node_type_counts: nodeTypeCounts,
    nodes: nodes.map(compactNodeData),
    start_variables: getStartVariables(nodes),
    terminal_nodes: terminalNodes.map(summarizeNode),
    valid: issues.every(issue => issue.severity !== 'error'),
    warning_count: issues.filter(issue => issue.severity === 'warning').length,
  }
}

export const summarizeWorkflowDraftForAgent = (draft: WorkflowDraftLike): AgentToolResult => ({
  draft: {
    hash: draft.hash,
    id: draft.id,
    updated_at: draft.updated_at,
    version: draft.version,
  },
  graph: summarizeWorkflowGraph(draft.graph),
  variables: {
    conversation_variable_count: draft.conversation_variables?.length ?? 0,
    environment_variable_count: draft.environment_variables?.length ?? 0,
  },
})

export const buildWorkflowAgentContext = ({
  candidateNode,
  controlMode,
  edges,
  isListening,
  nodes,
  pathname,
  pendingSingleRun,
  pluginCatalog,
  selectedNodeId,
}: WorkflowAgentContextParams): AgentToolResult => {
  const selectedNode = nodes.find(node => node.id === selectedNodeId || node.selected || node.data.selected)

  return {
    page_type: 'workflow-builder',
    pathname,
    graph: summarizeWorkflowGraph({ edges, nodes }),
    plugin_catalog: summarizePluginCatalog(pluginCatalog),
    state: {
      candidate_node: candidateNode ? compactNodeData(candidateNode) : null,
      control_mode: controlMode,
      is_listening: isListening,
      pending_single_run: pendingSingleRun ?? null,
      selected_node: selectedNode ? compactNodeData(selectedNode) : null,
    },
    orchestration: {
      browser_action_workflow: [
        'Use dify_get_page_context to discover current visible add-node, node-panel, menu, form, and run/debug action IDs.',
        'Use dify_perform_browser_action to click or fill those controls.',
        'Use this workflow context after each operation to confirm graph state and selected node state.',
      ],
      safe_editing_notes: [
        'For small visual edits, use Dify UI actions so validation, collaboration, undo history, and draft sync remain correct.',
        'For full workflow construction, import DSL or sync a full draft graph, then validate and test the result.',
        'If a node or panel control is missing from dom.actions, click the node or open the relevant panel first, then refresh page context.',
      ],
    },
  }
}
