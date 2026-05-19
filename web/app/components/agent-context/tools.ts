'use client'

import type { AgentTool, AgentToolInput, AgentToolResult } from './types'
import type { WorkflowDraftLike } from './workflow'
import Cookies from 'js-cookie'
import { API_PREFIX, APP_VERSION, CSRF_COOKIE_NAME, CSRF_HEADER_NAME, IS_MARKETPLACE, MARKETPLACE_API_PREFIX } from '@/config'
import { DSLImportMode, DSLImportStatus } from '@/models/app'
import { createApp, exportAppConfig, importDSL, importDSLConfirm } from '@/service/apps'
import { post } from '@/service/base'
import { fetchWorkflowDraft } from '@/service/workflow'
import { AppModeEnum } from '@/types/app'
import { getCurrentRouteContext, getFrontendCapabilities } from './capabilities'
import { getDomSnapshot, performBrowserAction } from './dom'
import { getRegisteredPageContexts } from './runtime'
import { getWorkflowConstructionGuide, summarizeWorkflowDraftForAgent, summarizeWorkflowGraph } from './workflow'
import { buildWorkflowRecipePlan, getWorkflowRecipeForAgent, listWorkflowRecipes } from './workflow-recipes'

type WorkflowSyncPayload = {
  conversation_variables?: unknown[]
  environment_variables?: unknown[]
  features: Record<string, unknown>
  graph: Record<string, unknown>
  hash?: string
}

type WorkflowRunEvent = Record<string, unknown> & {
  data?: Record<string, unknown>
  event?: string
  task_id?: string
  workflow_run_id?: string
}

type WorkflowRunSummary = {
  event_count: number
  final_event: WorkflowRunEvent | null
  node_executions: WorkflowRunEvent[]
  status: string | null
  task_id: string | null
  text: string
  workflow_run_id: string | null
}

const TERMINAL_WORKFLOW_EVENTS = new Set([
  'workflow_finished',
  'workflow_paused',
  'error',
])

const getNumberInput = (input: AgentToolInput | undefined, key: string, fallback: number) => {
  const value = input?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

const getBooleanInput = (input: AgentToolInput | undefined, key: string, fallback: boolean) => {
  const value = input?.[key]
  return typeof value === 'boolean' ? value : fallback
}

const getStringInput = (input: AgentToolInput | undefined, key: string) => {
  const value = input?.[key]
  return typeof value === 'string' ? value : undefined
}

const getObjectInput = (input: AgentToolInput | undefined, key: string) => {
  const value = input?.[key]
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined

  return value as Record<string, unknown>
}

const getArrayInput = (input: AgentToolInput | undefined, key: string) => {
  const value = input?.[key]
  return Array.isArray(value) ? value : undefined
}

const getStringArrayInput = (input: AgentToolInput | undefined, key: string) => {
  const value = getArrayInput(input, key)
  return value?.filter((item): item is string => typeof item === 'string')
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const toRecordArray = (value: unknown): Record<string, unknown>[] => {
  return Array.isArray(value)
    ? value.filter(isRecord)
    : []
}

const getRecordValue = (record: Record<string, unknown>, key: string) => {
  const value = record[key]
  return isRecord(value) ? value : undefined
}

const getArrayValue = (record: Record<string, unknown>, key: string) => {
  const value = record[key]
  return Array.isArray(value) ? value : []
}

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

const isWorkflowGraph = (value: unknown): value is WorkflowDraftLike['graph'] => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false

  const graph = value as Record<string, unknown>
  return Array.isArray(graph.nodes) && Array.isArray(graph.edges)
}

const getCurrentAppId = (input?: AgentToolInput) => {
  return getStringInput(input, 'app_id') ?? getStringInput(input, 'appId') ?? getCurrentRouteContext().app_id
}

const requireCurrentAppId = (input?: AgentToolInput) => {
  const appId = getCurrentAppId(input)
  if (!appId)
    throw new Error('app_id is required when the current route is not an app page.')

  return appId
}

const isCompletedImportStatus = (status: DSLImportStatus) => {
  return status === DSLImportStatus.COMPLETED || status === DSLImportStatus.COMPLETED_WITH_WARNINGS
}

const toConsoleApiUrl = (path: string) => {
  return `${API_PREFIX}/${path.replace(/^\/+/, '')}`
}

const toMarketplaceApiUrl = (path: string) => {
  return `${MARKETPLACE_API_PREFIX}/${path.replace(/^\/+/, '')}`
}

const getConsoleApiHeaders = (hasBody: boolean) => {
  const headers = new Headers()

  if (hasBody)
    headers.set('Content-Type', 'application/json')

  const csrfToken = Cookies.get(CSRF_COOKIE_NAME())
  if (csrfToken)
    headers.set(CSRF_HEADER_NAME, csrfToken)

  return headers
}

const readJsonResponse = async (response: Response): Promise<Record<string, unknown>> => {
  const text = await response.text()
  let data: Record<string, unknown> = {}

  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>
    }
    catch {
      data = { text }
    }
  }

  if (!response.ok)
    throw new Error(`${response.status} ${String(data.message ?? data.text ?? response.statusText)}`)

  return data
}

const consoleApiJson = async (path: string, init?: RequestInit): Promise<Record<string, unknown>> => {
  const hasBody = Boolean(init?.body)
  const response = await fetch(toConsoleApiUrl(path), {
    credentials: 'include',
    ...init,
    headers: getConsoleApiHeaders(hasBody),
  })

  return readJsonResponse(response)
}

const consoleApiMaybe = async (path: string, init?: RequestInit): Promise<{ data?: unknown, error?: string, ok: boolean }> => {
  try {
    return {
      data: await consoleApiJson(path, init),
      ok: true,
    }
  }
  catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    }
  }
}

const marketplaceApiJson = async (path: string, init?: RequestInit): Promise<Record<string, unknown>> => {
  const headers = new Headers(init?.headers)
  if (init?.body)
    headers.set('Content-Type', 'application/json')

  headers.set('X-Dify-Version', !IS_MARKETPLACE ? APP_VERSION : '999.0.0')

  const response = await fetch(toMarketplaceApiUrl(path), {
    ...init,
    cache: 'no-store',
    headers,
  })

  return readJsonResponse(response)
}

const encodePathParam = (value: string) => encodeURIComponent(value)

const compactParameterSchema = (parameter: Record<string, unknown>) => {
  const name = typeof parameter.name === 'string' ? parameter.name : ''
  const label = getLocalizedText(parameter.label, name)
  const description = typeof parameter.llm_description === 'string' && parameter.llm_description
    ? parameter.llm_description
    : getLocalizedText(parameter.description ?? parameter.human_description, '')

  return {
    default: parameter.default,
    description,
    form: typeof parameter.form === 'string' ? parameter.form : undefined,
    input_schema: getRecordValue(parameter, 'input_schema'),
    label,
    max: parameter.max,
    min: parameter.min,
    multiple: typeof parameter.multiple === 'boolean' ? parameter.multiple : undefined,
    name,
    options: getArrayValue(parameter, 'options').filter(isRecord).map(option => ({
      label: getLocalizedText(option.label, typeof option.value === 'string' ? option.value : ''),
      value: option.value,
    })),
    required: Boolean(parameter.required),
    type: typeof parameter.type === 'string' ? parameter.type : undefined,
  }
}

const compactMarketplacePlugin = (plugin: Record<string, unknown>) => {
  const name = typeof plugin.name === 'string' ? plugin.name : ''
  const org = typeof plugin.org === 'string' ? plugin.org : undefined
  const pluginId = org && name ? `${org}/${name}` : name

  return {
    badges: getArrayValue(plugin, 'badges').filter((item): item is string => typeof item === 'string'),
    brief: getLocalizedText(plugin.brief, ''),
    category: plugin.category,
    install_count: plugin.install_count,
    label: getLocalizedText(plugin.label, name),
    latest_version: plugin.latest_version ?? plugin.version,
    name,
    org,
    plugin_id: pluginId,
    plugin_unique_identifier: plugin.plugin_unique_identifier,
    verified: plugin.verified,
  }
}

const compactInstalledPlugin = (plugin: Record<string, unknown>) => {
  const declaration = getRecordValue(plugin, 'declaration')
  const name = typeof plugin.name === 'string' ? plugin.name : declaration && typeof declaration.name === 'string' ? declaration.name : ''

  return {
    category: declaration?.category,
    id: plugin.id,
    installation_id: plugin.id,
    label: getLocalizedText(declaration?.label, name),
    latest_unique_identifier: plugin.latest_unique_identifier,
    latest_version: plugin.latest_version,
    name,
    plugin_id: plugin.plugin_id,
    plugin_unique_identifier: plugin.plugin_unique_identifier,
    source: plugin.source,
    version: plugin.version,
  }
}

const compactTool = (tool: Record<string, unknown>) => {
  const parameters = toRecordArray(tool.parameters).map(compactParameterSchema)

  return {
    description: getLocalizedText(tool.description, ''),
    label: getLocalizedText(tool.label, typeof tool.name === 'string' ? tool.name : ''),
    name: tool.name,
    output_schema_keys: Object.keys(getRecordValue(getRecordValue(tool, 'output_schema') ?? {}, 'properties') ?? {}),
    parameters,
    required_parameters: parameters.filter(parameter => parameter.required).map(parameter => parameter.name),
  }
}

const compactToolProvider = (provider: Record<string, unknown>) => {
  const tools = toRecordArray(provider.tools).map(compactTool)

  return {
    author: provider.author,
    id: provider.id,
    is_team_authorization: provider.is_team_authorization,
    label: getLocalizedText(provider.label, typeof provider.name === 'string' ? provider.name : ''),
    name: provider.name,
    plugin_id: provider.plugin_id,
    plugin_unique_identifier: provider.plugin_unique_identifier,
    tool_count: tools.length,
    tools,
    type: provider.type,
  }
}

const getProviderIdentifier = (provider: Record<string, unknown>) => {
  return typeof provider.id === 'string' && provider.id
    ? provider.id
    : typeof provider.name === 'string'
      ? provider.name
      : ''
}

const isPluginBackedToolProvider = (provider: Record<string, unknown>) => {
  return Boolean(
    (typeof provider.plugin_id === 'string' && provider.plugin_id)
    || (typeof provider.plugin_unique_identifier === 'string' && provider.plugin_unique_identifier),
  )
}

const sanitizeMcpNamePart = (value: unknown, fallback: string) => {
  const source = typeof value === 'string' && value ? value : fallback
  const normalized = source
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return normalized || fallback
}

const buildMcpPluginToolName = (provider: Record<string, unknown>, tool: Record<string, unknown>) => {
  const providerName = sanitizeMcpNamePart(getProviderIdentifier(provider), 'provider')
  const toolName = sanitizeMcpNamePart(tool.name, 'tool')

  return `dify_plugin__${providerName}__${toolName}`.slice(0, 128)
}

const primitiveOptionValues = (parameter: Record<string, unknown>) => {
  return getArrayValue(parameter, 'options')
    .filter(isRecord)
    .map(option => option.value)
    .filter((value): value is string | number | boolean => (
      typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
    ))
}

const getParameterDescription = (parameter: Record<string, unknown>) => {
  if (typeof parameter.llm_description === 'string' && parameter.llm_description)
    return parameter.llm_description

  return getLocalizedText(parameter.human_description ?? parameter.description, '')
}

const getParameterJsonSchema = (parameter: Record<string, unknown>): Record<string, unknown> => {
  const inputSchema = getRecordValue(parameter, 'input_schema')
  if (inputSchema)
    return inputSchema

  const rawType = typeof parameter.type === 'string' ? parameter.type : 'string'
  const description = getParameterDescription(parameter)
  const schema: Record<string, unknown> = {}

  switch (rawType) {
    case 'array':
    case 'files':
      schema.type = 'array'
      schema.items = rawType === 'files'
        ? { type: 'object', additionalProperties: true }
        : {}
      break
    case 'boolean':
    case 'checkbox':
      schema.type = 'boolean'
      break
    case 'file':
      schema.type = 'object'
      schema.additionalProperties = true
      break
    case 'json':
    case 'json_object':
    case 'object':
      schema.type = 'object'
      schema.additionalProperties = true
      break
    case 'number':
      schema.type = 'number'
      break
    default:
      schema.type = 'string'
  }

  if (description)
    schema.description = description
  if (parameter.default !== undefined)
    schema.default = parameter.default
  if (typeof parameter.min === 'number')
    schema.minimum = parameter.min
  if (typeof parameter.max === 'number')
    schema.maximum = parameter.max

  const optionValues = primitiveOptionValues(parameter)
  if (optionValues.length)
    schema.enum = optionValues

  if (parameter.multiple === true && schema.type !== 'array') {
    return {
      description: schema.description,
      items: {
        ...schema,
        default: undefined,
      },
      type: 'array',
    }
  }

  return schema
}

const buildMcpInputSchema = (parameters: Record<string, unknown>[]) => {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  parameters.forEach((parameter) => {
    const name = typeof parameter.name === 'string' ? parameter.name : ''
    if (!name)
      return

    properties[name] = getParameterJsonSchema(parameter)
    if (parameter.required === true)
      required.push(name)
  })

  return {
    additionalProperties: false,
    properties,
    required,
    type: 'object',
  }
}

const compactMcpAdaptedPluginTool = (provider: Record<string, unknown>, tool: Record<string, unknown>) => {
  const providerId = getProviderIdentifier(provider)
  const toolName = typeof tool.name === 'string' ? tool.name : ''
  const parameters = toRecordArray(tool.parameters)
  const outputSchema = getRecordValue(tool, 'output_schema') ?? {}
  const providerName = typeof provider.name === 'string' ? provider.name : providerId
  const providerLabel = getLocalizedText(provider.label, providerName)
  const toolLabel = getLocalizedText(tool.label, toolName)
  const toolDescription = getLocalizedText(tool.description, '')

  return {
    description: toolDescription,
    dify: {
      credential_endpoint: `/workspaces/current/tool-provider/builtin/${providerId}/credential/info`,
      plugin_id: provider.plugin_id,
      plugin_unique_identifier: provider.plugin_unique_identifier,
      provider_id: providerId,
      provider_label: providerLabel,
      provider_name: providerName,
      provider_type: 'builtin',
      schema_contract: {
        input_schema_source: 'declared_by_current_installed_plugin_provider',
        output_schema_source: 'declared_by_current_installed_plugin_provider',
        stability: 'version_scoped_snapshot',
        warning: 'Plugin schemas can change after install, upgrade, credential changes, dynamic option refreshes, or provider-side runtime changes. Treat this as a discovery snapshot, then validate by running the workflow node.',
      },
      tool_label: toolLabel,
      tool_name: toolName,
      tool_parameters_schema: parameters.map(compactParameterSchema),
      workflow_node: {
        block_type: 'tool',
        data: {
          desc: toolDescription,
          plugin_id: provider.plugin_id,
          plugin_unique_identifier: provider.plugin_unique_identifier,
          provider_id: providerId,
          provider_name: providerName,
          provider_type: 'builtin',
          title: toolLabel || toolName,
          tool_configurations: {},
          tool_label: toolLabel,
          tool_name: toolName,
          tool_node_version: '2',
          tool_parameters: {},
          type: 'tool',
        },
      },
    },
    inputSchema: buildMcpInputSchema(parameters),
    name: buildMcpPluginToolName(provider, tool),
    outputSchema,
    title: toolLabel,
  }
}

const compactTriggerEvent = (event: Record<string, unknown>) => {
  const identity = getRecordValue(event, 'identity')
  const outputSchema = getRecordValue(event, 'output_schema') ?? {}

  return {
    description: getLocalizedText(event.description, ''),
    label: getLocalizedText(identity?.label, typeof event.name === 'string' ? event.name : ''),
    name: event.name,
    output_schema_keys: Object.keys(getRecordValue(outputSchema, 'properties') ?? {}),
    parameters: toRecordArray(event.parameters).map(compactParameterSchema),
    required_outputs: getArrayValue(outputSchema, 'required'),
  }
}

const compactTriggerProvider = (provider: Record<string, unknown>) => {
  const subscriptionConstructor = getRecordValue(provider, 'subscription_constructor')
  const oauthSchema = getRecordValue(subscriptionConstructor ?? {}, 'oauth_schema')
  const events = toRecordArray(provider.events).map(compactTriggerEvent)

  return {
    author: provider.author,
    events,
    id: provider.id,
    label: getLocalizedText(provider.label, typeof provider.name === 'string' ? provider.name : ''),
    name: provider.name,
    plugin_id: provider.plugin_id,
    plugin_unique_identifier: provider.plugin_unique_identifier,
    supported_creation_methods: getArrayValue(provider, 'supported_creation_methods'),
    subscription_constructor: subscriptionConstructor
      ? {
          credential_fields: toRecordArray(subscriptionConstructor.credentials_schema).map(compactParameterSchema),
          oauth_available: Boolean(
            toRecordArray(oauthSchema?.client_schema).length
            || toRecordArray(oauthSchema?.credentials_schema).length,
          ),
          parameter_fields: toRecordArray(subscriptionConstructor.parameters).map(compactParameterSchema),
        }
      : null,
    subscription_schema: toRecordArray(provider.subscription_schema).map(compactParameterSchema),
    trigger_count: events.length,
    type: provider.type,
  }
}

const parseWorkflowRunEvents = (events: WorkflowRunEvent[]): WorkflowRunSummary => {
  const finalEvent = [...events].reverse().find(event => TERMINAL_WORKFLOW_EVENTS.has(String(event.event))) ?? null
  const text = events
    .filter(event => event.event === 'text_chunk' || event.event === 'text_replace')
    .map(event => event.data?.text)
    .filter((chunk): chunk is string => typeof chunk === 'string')
    .join('')
  const workflowFinishedData = finalEvent?.data
  const status = typeof workflowFinishedData?.status === 'string'
    ? workflowFinishedData.status
    : typeof finalEvent?.event === 'string'
      ? finalEvent.event
      : null

  return {
    event_count: events.length,
    final_event: finalEvent,
    node_executions: events.filter(event => event.event === 'node_finished'),
    status,
    task_id: finalEvent?.task_id ?? events.find(event => typeof event.task_id === 'string')?.task_id ?? null,
    text,
    workflow_run_id: finalEvent?.workflow_run_id ?? events.find(event => typeof event.workflow_run_id === 'string')?.workflow_run_id ?? null,
  }
}

const readWorkflowSse = async (response: Response) => {
  if (!response.ok)
    throw new Error(`${response.status} ${response.statusText}`)

  const reader = response.body?.getReader()
  if (!reader) {
    const data = await readJsonResponse(response)
    return {
      events: [],
      response: data,
      summary: parseWorkflowRunEvents([]),
    }
  }

  const decoder = new TextDecoder('utf-8')
  const events: WorkflowRunEvent[] = []
  let buffer = ''

  const parseLine = (line: string) => {
    if (!line.startsWith('data: '))
      return

    const payload = line.slice(6).trim()
    if (!payload)
      return

    events.push(JSON.parse(payload) as WorkflowRunEvent)
  }

  while (true) {
    const result = await reader.read()
    if (result.done)
      break

    buffer += decoder.decode(result.value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    lines.forEach(parseLine)
  }

  buffer.split('\n').forEach(parseLine)

  return {
    events,
    summary: parseWorkflowRunEvents(events),
  }
}

const runWorkflowSse = async (path: string, body: Record<string, unknown>) => {
  const response = await fetch(toConsoleApiUrl(path), {
    body: JSON.stringify(body),
    credentials: 'include',
    headers: getConsoleApiHeaders(true),
    method: 'POST',
  })

  return readWorkflowSse(response)
}

const navigate = (input?: AgentToolInput): AgentToolResult => {
  const targetPath = getStringInput(input, 'path')
  if (!targetPath)
    throw new Error('path is required.')

  const targetUrl = new URL(targetPath, window.location.origin)
  if (targetUrl.origin !== window.location.origin)
    throw new Error('Only same-origin Dify navigation is allowed.')

  window.location.assign(`${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`)

  return {
    ok: true,
    target: `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`,
  }
}

const getPageContext = (input?: AgentToolInput): AgentToolResult => {
  const actionLimit = getNumberInput(input, 'action_limit', 80)
  const textLimit = getNumberInput(input, 'text_limit', 40)

  return {
    application: {
      name: 'Dify',
      purpose: 'LLM application development platform for apps, workflows, RAG datasets, tools, plugins, model providers, and published app experiences.',
    },
    route: getCurrentRouteContext(),
    dom: getDomSnapshot({
      actionLimit,
      textLimit,
    }),
    page_contexts: getRegisteredPageContexts(),
    usage: {
      next_step: 'Use dom.actions action_id values with dify_perform_browser_action. Action IDs are stable for equivalent DOM refreshes, but refresh this context after navigation, opening popovers, or changing workflow state.',
      no_screenshot_required: true,
    },
  }
}

const getWorkflowContext = (): AgentToolResult => {
  const workflowContext = getRegisteredPageContexts().find(context => context.id === 'workflow')

  return {
    route: getCurrentRouteContext(),
    workflow: workflowContext?.value ?? null,
    fallback: workflowContext
      ? null
      : {
          reason: 'No workflow context is registered on the current page.',
          guidance: 'Navigate to an app workflow page, then call dify_get_workflow_context again.',
        },
  }
}

const importAppDsl = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const yamlContent = getStringInput(input, 'yaml_content')
  if (!yamlContent)
    throw new Error('yaml_content is required.')

  let result = await importDSL({
    app_id: getStringInput(input, 'app_id'),
    description: getStringInput(input, 'description'),
    mode: DSLImportMode.YAML_CONTENT,
    name: getStringInput(input, 'name'),
    yaml_content: yamlContent,
  })

  if (result.status === DSLImportStatus.PENDING && getBooleanInput(input, 'auto_confirm_version_mismatch', true)) {
    result = await importDSLConfirm({
      import_id: result.id,
    })
  }

  const ok = isCompletedImportStatus(result.status)
  const navigateToWorkflow = getBooleanInput(input, 'navigate_to_workflow', true)
  const appUrl = result.app_id ? `/app/${result.app_id}/workflow` : null

  if (ok && appUrl && navigateToWorkflow)
    window.location.assign(appUrl)

  return {
    ok,
    app_id: result.app_id ?? null,
    app_mode: result.app_mode,
    app_url: appUrl,
    error: result.error || null,
    import_id: result.id,
    leaked_dependencies: result.leaked_dependencies,
    status: result.status,
  }
}

const getWorkflowDraft = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const appId = requireCurrentAppId(input)
  const draft = await fetchWorkflowDraft(`/apps/${appId}/workflows/draft`)

  return {
    ok: true,
    app_id: appId,
    analysis: summarizeWorkflowDraftForAgent(draft),
    draft,
    summary: {
      edge_count: draft.graph.edges.length,
      hash: draft.hash,
      node_count: draft.graph.nodes.length,
      updated_at: draft.updated_at,
      version: draft.version,
    },
  } as AgentToolResult
}

const validateWorkflowGraph = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const graph = getObjectInput(input, 'graph')
  if (isWorkflowGraph(graph)) {
    return {
      ok: true,
      graph: summarizeWorkflowGraph(graph),
      source: 'input',
    }
  }

  const appId = requireCurrentAppId(input)
  const draft = await fetchWorkflowDraft(`/apps/${appId}/workflows/draft`)

  return {
    ok: true,
    app_id: appId,
    analysis: summarizeWorkflowDraftForAgent(draft),
    source: 'draft',
  } as AgentToolResult
}

const getWorkflowNodeDefaultConfig = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const appId = requireCurrentAppId(input)
  const blockType = getStringInput(input, 'block_type') ?? getStringInput(input, 'type')
  if (!blockType)
    throw new Error('block_type is required.')

  const query = getObjectInput(input, 'query') ?? {}
  const params = new URLSearchParams({
    q: JSON.stringify(query),
  })
  const result = await consoleApiJson(`apps/${appId}/workflows/default-workflow-block-configs/${blockType}?${params.toString()}`)

  return {
    ok: true,
    app_id: appId,
    block_type: blockType,
    config: result,
  }
}

const runWorkflowDraft = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const appId = requireCurrentAppId(input)
  const appMode = getStringInput(input, 'app_mode')
  const inputs = getObjectInput(input, 'inputs') ?? {}
  const files = getArrayInput(input, 'files')
  const body: Record<string, unknown> = {
    inputs,
  }

  if (files)
    body.files = files

  const query = getStringInput(input, 'query')
  if (query !== undefined)
    body.query = query

  const conversationId = getStringInput(input, 'conversation_id')
  if (conversationId)
    body.conversation_id = conversationId

  const parentMessageId = getStringInput(input, 'parent_message_id')
  if (parentMessageId)
    body.parent_message_id = parentMessageId

  const path = appMode === 'advanced-chat'
    ? `apps/${appId}/advanced-chat/workflows/draft/run`
    : `apps/${appId}/workflows/draft/run`
  const result = await runWorkflowSse(path, body)

  return {
    ok: result.summary.status !== 'error',
    app_id: appId,
    events: result.events,
    summary: result.summary,
  }
}

const runWorkflowNode = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const appId = requireCurrentAppId(input)
  const nodeId = getStringInput(input, 'node_id')
  if (!nodeId)
    throw new Error('node_id is required.')

  const body: Record<string, unknown> = {
    inputs: getObjectInput(input, 'inputs') ?? {},
  }
  const query = getStringInput(input, 'query')
  if (query !== undefined)
    body.query = query

  const files = getArrayInput(input, 'files')
  if (files)
    body.files = files

  const result = await consoleApiJson(`apps/${appId}/workflows/draft/nodes/${nodeId}/run`, {
    body: JSON.stringify(body),
    method: 'POST',
  })

  return {
    ok: true,
    app_id: appId,
    node_id: nodeId,
    result,
  }
}

const getWorkflowRuns = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const appId = requireCurrentAppId(input)
  const params = new URLSearchParams()
  params.set('limit', String(getNumberInput(input, 'limit', 20)))

  const lastId = getStringInput(input, 'last_id')
  if (lastId)
    params.set('last_id', lastId)

  const status = getStringInput(input, 'status')
  if (status)
    params.set('status', status)

  const triggeredFrom = getStringInput(input, 'triggered_from')
  if (triggeredFrom)
    params.set('triggered_from', triggeredFrom)

  const result = await consoleApiJson(`apps/${appId}/workflow-runs?${params.toString()}`)

  return {
    ok: true,
    app_id: appId,
    ...result,
  }
}

const getWorkflowRunDetail = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const appId = requireCurrentAppId(input)
  const runId = getStringInput(input, 'run_id') ?? getStringInput(input, 'workflow_run_id')
  if (!runId)
    throw new Error('run_id is required.')

  const result = await consoleApiJson(`apps/${appId}/workflow-runs/${runId}`)

  return {
    ok: true,
    app_id: appId,
    run_id: runId,
    detail: result,
  }
}

const getWorkflowRunNodeExecutions = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const appId = requireCurrentAppId(input)
  const runId = getStringInput(input, 'run_id') ?? getStringInput(input, 'workflow_run_id')
  if (!runId)
    throw new Error('run_id is required.')

  const result = await consoleApiJson(`apps/${appId}/workflow-runs/${runId}/node-executions`)

  return {
    ok: true,
    app_id: appId,
    run_id: runId,
    ...result,
  }
}

const stopWorkflowRun = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const appId = requireCurrentAppId(input)
  const taskId = getStringInput(input, 'task_id')
  if (!taskId)
    throw new Error('task_id is required.')

  const result = await consoleApiJson(`apps/${appId}/workflow-runs/tasks/${taskId}/stop`, {
    body: '{}',
    method: 'POST',
  })

  return {
    ok: result.result === 'success',
    app_id: appId,
    task_id: taskId,
    ...result,
  }
}

const syncWorkflowDraftForAgent = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const appId = requireCurrentAppId(input)
  const graph = getObjectInput(input, 'graph')
  if (!graph)
    throw new Error('graph is required.')
  const preflightValidation = isWorkflowGraph(graph) ? summarizeWorkflowGraph(graph) : null

  const payload: WorkflowSyncPayload = {
    conversation_variables: getArrayInput(input, 'conversation_variables') ?? [],
    environment_variables: getArrayInput(input, 'environment_variables') ?? [],
    features: getObjectInput(input, 'features') ?? {},
    graph,
  }

  const hash = getStringInput(input, 'hash')
  if (hash)
    payload.hash = hash

  const result = await post<{ hash: string, result: string, updated_at: number | string }>(
    `apps/${appId}/workflows/draft`,
    { body: payload },
    { silent: true },
  )

  return {
    ok: result.result === 'success',
    app_id: appId,
    hash: result.hash,
    preflight_validation: preflightValidation,
    result: result.result,
    updated_at: result.updated_at,
  }
}

const publishWorkflow = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const appId = requireCurrentAppId(input)
  const markedName = (getStringInput(input, 'marked_name') ?? getStringInput(input, 'title') ?? '').slice(0, 20)
  const markedComment = (getStringInput(input, 'marked_comment') ?? getStringInput(input, 'release_notes') ?? '').slice(0, 100)
  const result = await post<{ created_at: number, result: string }>(`apps/${appId}/workflows/publish`, {
    body: {
      marked_comment: markedComment,
      marked_name: markedName,
    },
  })

  return {
    ok: result.result === 'success',
    app_id: appId,
    created_at: result.created_at,
    result: result.result,
  }
}

const exportAppDsl = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const appId = requireCurrentAppId(input)
  const includeSecret = getBooleanInput(input, 'include_secret', false)
  const workflowId = getStringInput(input, 'workflow_id')
  const result = await exportAppConfig({
    appID: appId,
    include: includeSecret,
    workflowID: workflowId,
  })

  return {
    ok: true,
    app_id: appId,
    yaml_content: result.data,
  }
}

const createWorkflowAppForAgent = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const name = (getStringInput(input, 'name') ?? 'Untitled workflow').slice(0, 80)
  const description = getStringInput(input, 'description')
  const app = await createApp({
    description,
    icon: getStringInput(input, 'icon') ?? '🤖',
    icon_background: getStringInput(input, 'icon_background') ?? '#D5F5F6',
    icon_type: 'emoji',
    mode: AppModeEnum.WORKFLOW,
    name,
  })

  const appUrl = `/app/${app.id}/workflow`
  if (getBooleanInput(input, 'navigate_to_workflow', true))
    window.location.assign(appUrl)

  return {
    ok: true,
    app,
    app_id: app.id,
    app_url: appUrl,
  } as AgentToolResult
}

const searchMarketplacePlugins = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const page = getNumberInput(input, 'page', 1)
  const pageSize = getNumberInput(input, 'page_size', 10)
  const body: Record<string, unknown> = {
    page,
    page_size: pageSize,
    query: getStringInput(input, 'query') ?? '',
    type: getStringInput(input, 'type') ?? 'plugin',
  }

  const category = getStringInput(input, 'category')
  if (category)
    body.category = category

  const tags = getStringArrayInput(input, 'tags')
  if (tags?.length)
    body.tags = tags

  const exclude = getStringArrayInput(input, 'exclude')
  if (exclude?.length)
    body.exclude = exclude

  const result = await marketplaceApiJson('/plugins/search/advanced', {
    body: JSON.stringify(body),
    method: 'POST',
  })
  const data = getRecordValue(result, 'data') ?? result
  const plugins = toRecordArray(data.plugins).map(compactMarketplacePlugin)

  return {
    ok: true,
    page: data.page ?? page,
    page_size: data.page_size ?? pageSize,
    plugins,
    query: body,
    total: data.total ?? plugins.length,
  } as AgentToolResult
}

const getPluginReadme = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const pluginUniqueIdentifier = getStringInput(input, 'plugin_unique_identifier') ?? getStringInput(input, 'unique_identifier')
  if (!pluginUniqueIdentifier)
    throw new Error('plugin_unique_identifier is required.')

  const params = new URLSearchParams({
    plugin_unique_identifier: pluginUniqueIdentifier,
  })
  const language = getStringInput(input, 'language')
  if (language)
    params.set('language', language)

  const result = await consoleApiJson(`/workspaces/current/plugin/readme?${params.toString()}`)

  return {
    ok: true,
    plugin_unique_identifier: pluginUniqueIdentifier,
    readme: result.readme ?? '',
  } as AgentToolResult
}

const installMarketplacePlugins = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const identifiers = getStringArrayInput(input, 'plugin_unique_identifiers')
    ?? getStringArrayInput(input, 'unique_identifiers')
    ?? (getStringInput(input, 'plugin_unique_identifier') ? [getStringInput(input, 'plugin_unique_identifier')!] : undefined)

  if (!identifiers?.length)
    throw new Error('plugin_unique_identifiers is required.')

  const result = await consoleApiJson('/workspaces/current/plugin/install/marketplace', {
    body: JSON.stringify({
      plugin_unique_identifiers: identifiers,
    }),
    method: 'POST',
  })

  return {
    ok: result.all_installed === true || typeof result.task_id === 'string',
    next_steps: [
      'If task_id is returned, call dify_get_plugin_task_detail until the task succeeds or fails.',
      'Call dify_list_installed_plugin_capabilities to refresh the installed plugin catalog.',
      'Call dify_list_mcp_adapted_plugin_tools to discover the newly installed tool schemas for this workspace/plugin version.',
    ],
    plugin_unique_identifiers: identifiers,
    ...result,
  } as AgentToolResult
}

const getPluginInstallTasks = async (): Promise<AgentToolResult> => {
  const result = await consoleApiJson('/workspaces/current/plugin/tasks?page=1&page_size=100')

  return {
    ok: true,
    ...result,
  } as AgentToolResult
}

const getPluginTaskDetail = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const taskId = getStringInput(input, 'task_id')
  if (!taskId)
    throw new Error('task_id is required.')

  const result = await consoleApiJson(`/workspaces/current/plugin/tasks/${encodePathParam(taskId)}`)

  return {
    ok: true,
    task_id: taskId,
    ...result,
  } as AgentToolResult
}

const uninstallPluginForAgent = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  let installationId = getStringInput(input, 'plugin_installation_id') ?? getStringInput(input, 'installation_id')
  const pluginUniqueIdentifier = getStringInput(input, 'plugin_unique_identifier') ?? getStringInput(input, 'unique_identifier')
  const pluginId = getStringInput(input, 'plugin_id')

  if (!installationId) {
    const installedPlugins = await consoleApiJson('/workspaces/current/plugin/list?page=1&page_size=100')
    const plugins = toRecordArray(installedPlugins.plugins)
    const matchedPlugin = plugins.find((plugin) => {
      if (pluginUniqueIdentifier && plugin.plugin_unique_identifier === pluginUniqueIdentifier)
        return true
      if (pluginId && plugin.plugin_id === pluginId)
        return true
      return false
    })

    installationId = typeof matchedPlugin?.id === 'string' ? matchedPlugin.id : undefined
  }

  if (!installationId)
    throw new Error('plugin_installation_id is required. You can also provide plugin_unique_identifier or plugin_id when the plugin is installed and discoverable.')

  const result = await consoleApiJson('/workspaces/current/plugin/uninstall', {
    body: JSON.stringify({
      plugin_installation_id: installationId,
    }),
    method: 'POST',
  })

  return {
    ok: result.success === true,
    plugin_installation_id: installationId,
    post_uninstall_next_steps: [
      'Call dify_list_installed_plugin_capabilities to refresh the installed plugin catalog.',
      'Call dify_list_mcp_adapted_plugin_tools to confirm removed tool schemas are no longer available.',
      'Validate any workflows that referenced this plugin; affected tool or trigger nodes may need replacement.',
    ],
    ...result,
  } as AgentToolResult
}

const listInstalledPluginCapabilities = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const appId = getCurrentAppId(input)
  const [
    installedPlugins,
    triggerProviders,
    builtInTools,
    customTools,
    workflowTools,
    mcpTools,
    appTriggers,
  ] = await Promise.all([
    consoleApiMaybe('/workspaces/current/plugin/list?page=1&page_size=100'),
    consoleApiMaybe('/workspaces/current/triggers'),
    consoleApiMaybe('/workspaces/current/tools/builtin'),
    consoleApiMaybe('/workspaces/current/tools/api'),
    consoleApiMaybe('/workspaces/current/tools/workflow'),
    consoleApiMaybe('/workspaces/current/tools/mcp'),
    appId ? consoleApiMaybe(`/apps/${appId}/triggers`) : Promise.resolve({ data: null, ok: true }),
  ])
  const installedPluginData = isRecord(installedPlugins.data) ? installedPlugins.data : {}
  const appTriggerData = isRecord(appTriggers.data) ? appTriggers.data : {}

  return {
    app_id: appId ?? null,
    catalog: {
      app_triggers: toRecordArray(appTriggerData.data),
      installed_plugins: {
        plugins: toRecordArray(installedPluginData.plugins).map(compactInstalledPlugin),
        total: installedPluginData.total ?? toRecordArray(installedPluginData.plugins).length,
      },
      tools: {
        builtin: toRecordArray(builtInTools.data).map(compactToolProvider),
        custom: toRecordArray(customTools.data).map(compactToolProvider),
        mcp: toRecordArray(mcpTools.data).map(compactToolProvider),
        workflow: toRecordArray(workflowTools.data).map(compactToolProvider),
      },
      triggers: toRecordArray(triggerProviders.data).map(compactTriggerProvider),
    },
    ok: true,
    request_status: {
      app_triggers: appTriggers,
      builtin_tools: builtInTools,
      custom_tools: customTools,
      installed_plugins: installedPlugins,
      mcp_tools: mcpTools,
      trigger_providers: triggerProviders,
      workflow_tools: workflowTools,
    },
  } as AgentToolResult
}

const listMcpAdaptedPluginTools = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const providerFilter = getStringInput(input, 'provider') ?? getStringInput(input, 'provider_id') ?? getStringInput(input, 'provider_name')
  const pluginIdFilter = getStringInput(input, 'plugin_id')
  const pluginUniqueIdentifierFilter = getStringInput(input, 'plugin_unique_identifier') ?? getStringInput(input, 'unique_identifier')
  const toolNameFilter = getStringInput(input, 'tool_name')
  const includeCredentialInfo = getBooleanInput(input, 'include_credential_info', false)
  const data = await consoleApiJson('/workspaces/current/tools/builtin')
  const providers = toRecordArray(data)
    .filter(isPluginBackedToolProvider)
    .filter((provider) => {
      const providerId = getProviderIdentifier(provider)

      if (providerFilter && providerFilter !== providerId && providerFilter !== provider.name)
        return false
      if (pluginIdFilter && pluginIdFilter !== provider.plugin_id)
        return false
      if (pluginUniqueIdentifierFilter && pluginUniqueIdentifierFilter !== provider.plugin_unique_identifier)
        return false

      return true
    })

  const credentialInfoByProvider = new Map<string, { data?: unknown, error?: string, ok: boolean }>()
  if (includeCredentialInfo) {
    const credentialEntries = await Promise.all(providers.map(async (provider) => {
      const providerId = getProviderIdentifier(provider)
      return [
        providerId,
        await consoleApiMaybe(`/workspaces/current/tool-provider/builtin/${encodePathParam(providerId)}/credential/info`),
      ] as const
    }))

    credentialEntries.forEach(([providerId, result]) => credentialInfoByProvider.set(providerId, result))
  }

  const adaptedProviders = providers.map((provider) => {
    const providerId = getProviderIdentifier(provider)
    const tools = toRecordArray(provider.tools)
      .filter(tool => !toolNameFilter || tool.name === toolNameFilter)
      .map(tool => compactMcpAdaptedPluginTool(provider, tool))
    const credentialInfo = credentialInfoByProvider.get(providerId)

    return {
      credential_info: credentialInfo?.ok && isRecord(credentialInfo.data)
        ? {
            authorized: toRecordArray(credentialInfo.data.credentials).length > 0,
            credentials: toRecordArray(credentialInfo.data.credentials),
            is_oauth_custom_client_enabled: credentialInfo.data.is_oauth_custom_client_enabled,
            supported_credential_types: getArrayValue(credentialInfo.data, 'supported_credential_types'),
          }
        : undefined,
      credential_info_error: credentialInfo && !credentialInfo.ok ? credentialInfo.error : undefined,
      id: providerId,
      label: getLocalizedText(provider.label, typeof provider.name === 'string' ? provider.name : providerId),
      name: provider.name,
      plugin_id: provider.plugin_id,
      plugin_unique_identifier: provider.plugin_unique_identifier,
      tool_count: tools.length,
      tools,
      type: 'builtin',
    }
  }).filter(provider => provider.tool_count > 0)
  const tools = adaptedProviders.flatMap(provider => provider.tools)

  return {
    ok: true,
    execution_model: {
      direct_console_invoke: false,
      guidance: 'Dify does not expose a generic console endpoint for directly invoking installed Marketplace plugin tools. Insert the returned dify.workflow_node data as a workflow tool node, sync the draft, then execute with dify_run_workflow_node or dify_run_workflow_draft.',
      runtime_path: 'workflow_tool_node',
    },
    filters: {
      plugin_id: pluginIdFilter ?? null,
      plugin_unique_identifier: pluginUniqueIdentifierFilter ?? null,
      provider: providerFilter ?? null,
      tool_name: toolNameFilter ?? null,
    },
    protocol: 'mcp',
    provider_count: adaptedProviders.length,
    providers: adaptedProviders,
    schema_contract: {
      dynamic_options_tool: 'dify_get_plugin_dynamic_options',
      input_schema_meaning: 'Best-effort JSON Schema converted from the currently installed provider tool parameters returned by Dify.',
      output_schema_meaning: 'Declared plugin output schema when available; runtime output can still vary and must be validated with node/draft execution.',
      stability: 'snapshot_of_current_workspace_plugin_installation',
      version_scope: 'Use plugin_unique_identifier to understand which plugin package/version/hash produced the schema.',
    },
    source: {
      credential_endpoint_template: '/workspaces/current/tool-provider/builtin/{provider}/credential/info',
      list_endpoint: '/workspaces/current/tools/builtin',
      marketplace_plugin_detection: 'provider.plugin_id || provider.plugin_unique_identifier',
    },
    tool_count: tools.length,
    tools,
  } as AgentToolResult
}

const getPluginToolCredentialInfo = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const provider = getStringInput(input, 'provider') ?? getStringInput(input, 'provider_id') ?? getStringInput(input, 'provider_name')
  if (!provider)
    throw new Error('provider is required.')

  const result = await consoleApiJson(`/workspaces/current/tool-provider/builtin/${encodePathParam(provider)}/credential/info`)
  const credentials = toRecordArray(result.credentials)

  return {
    authorized: credentials.length > 0,
    credentials,
    ok: true,
    provider,
    ...result,
  } as AgentToolResult
}

const buildPluginToolWorkflowNode = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const mcpToolName = getStringInput(input, 'mcp_tool_name')
  let resolvedTool: Record<string, unknown> | undefined

  if (mcpToolName) {
    const catalog = await listMcpAdaptedPluginTools()
    const tools = isRecord(catalog) ? toRecordArray(catalog.tools) : []
    resolvedTool = tools.find(tool => tool.name === mcpToolName)
  }

  const difyTool = resolvedTool ? getRecordValue(resolvedTool, 'dify') : undefined
  const providerId = getStringInput(input, 'provider_id') ?? getStringInput(input, 'provider') ?? (typeof difyTool?.provider_id === 'string' ? difyTool.provider_id : undefined)
  const toolName = getStringInput(input, 'tool_name') ?? (typeof difyTool?.tool_name === 'string' ? difyTool.tool_name : undefined)

  if (!providerId)
    throw new Error('provider_id is required.')
  if (!toolName)
    throw new Error('tool_name is required.')

  const providerType = getStringInput(input, 'provider_type') ?? 'builtin'
  const providerName = getStringInput(input, 'provider_name') ?? (typeof difyTool?.provider_name === 'string' ? difyTool.provider_name : providerId)
  const toolLabel = getStringInput(input, 'tool_label') ?? (typeof difyTool?.tool_label === 'string' ? difyTool.tool_label : toolName)
  const description = getStringInput(input, 'description') ?? getStringInput(input, 'desc') ?? (typeof resolvedTool?.description === 'string' ? resolvedTool.description : '')
  const constantParameters = getObjectInput(input, 'constant_parameters') ?? getObjectInput(input, 'parameters')
  const toolParameters = getObjectInput(input, 'tool_parameters') ?? (constantParameters
    ? Object.fromEntries(Object.entries(constantParameters).map(([key, value]) => [
        key,
        {
          type: 'constant',
          value,
        },
      ]))
    : {})
  const nodeData = {
    desc: description,
    plugin_id: getStringInput(input, 'plugin_id') ?? (typeof difyTool?.plugin_id === 'string' ? difyTool.plugin_id : undefined),
    plugin_unique_identifier: getStringInput(input, 'plugin_unique_identifier') ?? (typeof difyTool?.plugin_unique_identifier === 'string' ? difyTool.plugin_unique_identifier : undefined),
    provider_id: providerId,
    provider_name: providerName,
    provider_type: providerType,
    title: getStringInput(input, 'title') ?? toolLabel,
    tool_configurations: getObjectInput(input, 'tool_configurations') ?? {},
    tool_label: toolLabel,
    tool_name: toolName,
    tool_node_version: '2',
    tool_parameters: toolParameters,
    type: 'tool',
  }

  return {
    ok: true,
    execution_model: {
      next_steps: [
        'Insert this node into a workflow graph and connect it to upstream/downstream nodes.',
        'Call dify_sync_workflow_draft with the updated graph.',
        'Call dify_run_workflow_node for targeted debugging or dify_run_workflow_draft for end-to-end validation.',
      ],
      runtime_path: 'workflow_tool_node',
    },
    mcp_tool_name: mcpToolName ?? buildMcpPluginToolName(
      {
        id: providerId,
        name: providerName,
      },
      {
        name: toolName,
      },
    ),
    node: {
      data: nodeData,
      id: getStringInput(input, 'node_id') ?? `tool-${sanitizeMcpNamePart(providerId, 'provider')}-${sanitizeMcpNamePart(toolName, 'tool')}`.slice(0, 120),
      position: getObjectInput(input, 'position') ?? { x: 420, y: 120 },
      type: 'custom',
    },
    node_data: nodeData,
  } as AgentToolResult
}

const getTriggerProviderDetail = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const provider = getStringInput(input, 'provider') ?? getStringInput(input, 'provider_id') ?? getStringInput(input, 'provider_name')
  if (!provider)
    throw new Error('provider is required.')

  const providerPath = encodePathParam(provider)
  const [info, subscriptions] = await Promise.all([
    consoleApiMaybe(`/workspaces/current/trigger-provider/${providerPath}/info`),
    consoleApiMaybe(`/workspaces/current/trigger-provider/${providerPath}/subscriptions/list`),
  ])

  return {
    info: info.ok && isRecord(info.data) ? compactTriggerProvider(info.data) : null,
    ok: info.ok || subscriptions.ok,
    provider,
    raw: {
      info,
      subscriptions,
    },
    subscriptions: toRecordArray(subscriptions.data),
  } as AgentToolResult
}

const createTriggerSubscriptionBuilder = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const provider = getStringInput(input, 'provider') ?? getStringInput(input, 'provider_id') ?? getStringInput(input, 'provider_name')
  if (!provider)
    throw new Error('provider is required.')

  const body: Record<string, unknown> = {}
  const credentialType = getStringInput(input, 'credential_type')
  if (credentialType)
    body.credential_type = credentialType

  const result = await consoleApiJson(`/workspaces/current/trigger-provider/${encodePathParam(provider)}/subscriptions/builder/create`, {
    body: JSON.stringify(body),
    method: 'POST',
  })

  return {
    ok: true,
    provider,
    ...result,
  } as AgentToolResult
}

const updateTriggerSubscriptionBuilder = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const provider = getStringInput(input, 'provider') ?? getStringInput(input, 'provider_id') ?? getStringInput(input, 'provider_name')
  const subscriptionBuilderId = getStringInput(input, 'subscription_builder_id') ?? getStringInput(input, 'subscriptionBuilderId')
  if (!provider)
    throw new Error('provider is required.')
  if (!subscriptionBuilderId)
    throw new Error('subscription_builder_id is required.')

  const body: Record<string, unknown> = {}
  const name = getStringInput(input, 'name')
  if (name)
    body.name = name

  const properties = getObjectInput(input, 'properties')
  if (properties)
    body.properties = properties

  const parameters = getObjectInput(input, 'parameters')
  if (parameters)
    body.parameters = parameters

  const credentials = getObjectInput(input, 'credentials')
  if (credentials)
    body.credentials = credentials

  const result = await consoleApiJson(
    `/workspaces/current/trigger-provider/${encodePathParam(provider)}/subscriptions/builder/update/${encodePathParam(subscriptionBuilderId)}`,
    {
      body: JSON.stringify(body),
      method: 'POST',
    },
  )

  return {
    ok: true,
    provider,
    subscription_builder_id: subscriptionBuilderId,
    ...result,
  } as AgentToolResult
}

const verifyTriggerSubscriptionBuilder = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const provider = getStringInput(input, 'provider') ?? getStringInput(input, 'provider_id') ?? getStringInput(input, 'provider_name')
  const subscriptionBuilderId = getStringInput(input, 'subscription_builder_id') ?? getStringInput(input, 'subscriptionBuilderId')
  if (!provider)
    throw new Error('provider is required.')
  if (!subscriptionBuilderId)
    throw new Error('subscription_builder_id is required.')

  const result = await consoleApiJson(
    `/workspaces/current/trigger-provider/${encodePathParam(provider)}/subscriptions/builder/verify-and-update/${encodePathParam(subscriptionBuilderId)}`,
    {
      body: JSON.stringify({
        credentials: getObjectInput(input, 'credentials') ?? {},
      }),
      method: 'POST',
    },
  )

  return {
    ok: result.verified === true,
    provider,
    subscription_builder_id: subscriptionBuilderId,
    ...result,
  } as AgentToolResult
}

const buildTriggerSubscription = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const provider = getStringInput(input, 'provider') ?? getStringInput(input, 'provider_id') ?? getStringInput(input, 'provider_name')
  const subscriptionBuilderId = getStringInput(input, 'subscription_builder_id') ?? getStringInput(input, 'subscriptionBuilderId')
  if (!provider)
    throw new Error('provider is required.')
  if (!subscriptionBuilderId)
    throw new Error('subscription_builder_id is required.')

  const body: Record<string, unknown> = {}
  const name = getStringInput(input, 'name')
  if (name)
    body.name = name

  const parameters = getObjectInput(input, 'parameters')
  if (parameters)
    body.parameters = parameters

  const result = await consoleApiJson(
    `/workspaces/current/trigger-provider/${encodePathParam(provider)}/subscriptions/builder/build/${encodePathParam(subscriptionBuilderId)}`,
    {
      body: JSON.stringify(body),
      method: 'POST',
    },
  )

  return {
    ok: true,
    provider,
    subscription_builder_id: subscriptionBuilderId,
    ...result,
  } as AgentToolResult
}

const getTriggerSubscriptionBuilderLogs = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const provider = getStringInput(input, 'provider') ?? getStringInput(input, 'provider_id') ?? getStringInput(input, 'provider_name')
  const subscriptionBuilderId = getStringInput(input, 'subscription_builder_id') ?? getStringInput(input, 'subscriptionBuilderId')
  if (!provider)
    throw new Error('provider is required.')
  if (!subscriptionBuilderId)
    throw new Error('subscription_builder_id is required.')

  const result = await consoleApiJson(
    `/workspaces/current/trigger-provider/${encodePathParam(provider)}/subscriptions/builder/logs/${encodePathParam(subscriptionBuilderId)}`,
  )

  return {
    ok: true,
    provider,
    subscription_builder_id: subscriptionBuilderId,
    ...result,
  } as AgentToolResult
}

const getPluginDynamicOptions = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const requiredKeys = ['plugin_id', 'provider', 'action', 'parameter']
  requiredKeys.forEach((key) => {
    if (!getStringInput(input, key))
      throw new Error(`${key} is required.`)
  })

  const params = new URLSearchParams()
  requiredKeys.forEach((key) => {
    params.set(key, getStringInput(input, key)!)
  })

  const providerType = getStringInput(input, 'provider_type')
  if (providerType)
    params.set('provider_type', providerType)

  const extra = getObjectInput(input, 'extra')
  if (extra) {
    Object.entries(extra).forEach(([key, value]) => {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
        params.set(key, String(value))
    })
  }

  const result = await consoleApiJson(`/workspaces/current/plugin/parameters/dynamic-options?${params.toString()}`)

  return {
    ok: true,
    ...result,
  } as AgentToolResult
}

const getAppTriggers = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const appId = requireCurrentAppId(input)
  const result = await consoleApiJson(`/apps/${appId}/triggers`)

  return {
    ok: true,
    app_id: appId,
    ...result,
  } as AgentToolResult
}

const setAppTriggerEnabled = async (input?: AgentToolInput): Promise<AgentToolResult> => {
  const appId = requireCurrentAppId(input)
  const triggerId = getStringInput(input, 'trigger_id')
  if (!triggerId)
    throw new Error('trigger_id is required.')

  const result = await consoleApiJson(`/apps/${appId}/trigger-enable`, {
    body: JSON.stringify({
      enable_trigger: getBooleanInput(input, 'enable_trigger', true),
      trigger_id: triggerId,
    }),
    method: 'POST',
  })

  return {
    ok: true,
    app_id: appId,
    ...result,
  } as AgentToolResult
}

const getWorkflowOrchestrationGuide = (): AgentToolResult => ({
  purpose: 'Use Dify as a workflow orchestrator and validator. Agents should discover capabilities, construct or import workflow drafts, validate graph shape, run representative cases, inspect node traces, iterate, and publish without relying on screenshots.',
  transport_model: {
    browser_webmcp: 'Use the same tool contract through navigator.modelContext when the browser or agent host supports WebMCP.',
    browser_fallback: 'Use window.__DIFY_AGENT_CONTEXT__ or navigator.modelContextTesting from an authenticated Dify page when WebMCP is unavailable.',
    server_mcp_ready: 'The tool contract is intentionally API-shaped so the same operations can be mirrored by a server-side MCP that calls authenticated Dify console APIs directly.',
  },
  orchestrator_roles: [
    'Capability source: route context, visible UI actions, workflow graph context, plugin/tool/trigger catalogs, and Marketplace search.',
    'Schema source: node default configs, workflow construction guide, plugin parameter schemas, trigger event output schemas, and app DSL import/export.',
    'Builder: create workflow apps, sync full draft graphs, import DSL, and perform targeted browser actions for UI-only edits.',
    'Validator: preflight graph validation, draft run execution, node-level run debugging, run detail inspection, trigger subscription verification, and publish-time backend validation.',
    'Publisher: publish workflow versions and manage generated app trigger records.',
  ],
  recommended_loop: [
    'Call dify_explain_workflow_schema once to understand the Dify workflow graph contract and available node types.',
    'Call dify_search_marketplace_plugins, dify_list_installed_plugin_capabilities, and dify_list_mcp_adapted_plugin_tools before choosing plugin trigger or tool nodes.',
    'Install missing plugins with dify_install_marketplace_plugins, wait with dify_get_plugin_task_detail, then rediscover schemas with dify_list_mcp_adapted_plugin_tools.',
    'Call dify_get_workflow_node_default_config before generating node data for each block type.',
    'Call dify_get_workflow_context to understand graph nodes and edges.',
    'Call dify_validate_workflow_graph before and after structural edits.',
    'Call dify_get_page_context to list visible actions, controls, fields, dialogs, and candidate workflow UI.',
    'Use dify_perform_browser_action with action_id values to click add-node controls, choose block types, open node panels, fill fields, and run/debug the workflow.',
    'Run representative cases with dify_run_workflow_draft, then inspect dify_get_workflow_run_node_executions for failing or surprising nodes.',
  ],
  orchestration_notes: [
    'For large workflow construction or migration, prefer dify_import_app_dsl or dify_sync_workflow_draft with explicit graph JSON/YAML, then verify with dify_get_workflow_draft.',
    'For plugin workflows, use installed capability catalogs and MCP-adapted plugin tool definitions to select provider_id, provider_type, plugin_id, plugin_unique_identifier, event_name, tool_name, parameter schemas, and output schema.',
    'Use trigger subscription tools to build, verify, and inspect provider subscriptions before enabling a published app trigger.',
    'Marketplace plugin tools do not have a generic direct console invoke endpoint; execute them through Dify workflow tool nodes and validate with node or draft runs.',
    'Use dify_run_workflow_node for targeted node debugging when the upstream inputs are known.',
    'If a desired action is not visible, navigate or click the relevant tab/menu first, then refresh page context.',
    'For destructive or workspace-wide operations, ask the user before confirming dialogs.',
  ],
  key_workflow_capabilities: [
    'Add and connect workflow nodes.',
    'Configure Start variables, LLM prompts, tools, knowledge retrieval, HTTP calls, code, condition branches, loops, iterations, human input, and End outputs.',
    'Discover, install, inspect, and debug Marketplace plugin triggers and tools.',
    'Inspect validation checklist and run/debug output.',
    'Publish or save workflow changes through existing Dify controls.',
  ],
})

export const buildDifyAgentTools = (): AgentTool[] => [
  {
    name: 'dify_get_page_context',
    title: 'Get Dify page context',
    description: 'Returns structured Dify page context, current route capability, visible text, dialogs, and browser-operable action IDs. Use this instead of screenshots.',
    inputSchema: {
      type: 'object',
      properties: {
        action_limit: {
          type: 'number',
          description: 'Maximum number of visible interactive elements to return.',
        },
        text_limit: {
          type: 'number',
          description: 'Maximum number of visible text blocks to return.',
        },
      },
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: getPageContext,
  },
  {
    name: 'dify_list_frontend_capabilities',
    title: 'List Dify frontend capabilities',
    description: 'Lists Dify frontend capability areas, route patterns, and agent guidance for understanding what the product UI can do.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: () => ({
      capabilities: getFrontendCapabilities(),
      current_route: getCurrentRouteContext(),
    }),
  },
  {
    name: 'dify_perform_browser_action',
    title: 'Perform Dify browser action',
    description: 'Performs a browser UI action using a stable action_id from dify_get_page_context. Supports click, toggle, fill, select, focus, and press.',
    inputSchema: {
      type: 'object',
      properties: {
        action_id: {
          type: 'string',
          description: 'The action_id returned by dify_get_page_context.',
        },
        action: {
          type: 'string',
          description: 'Action to perform.',
          enum: ['click', 'toggle', 'fill', 'select', 'focus', 'press'],
        },
        value: {
          type: 'string',
          description: 'Value for fill or select actions.',
        },
        key: {
          type: 'string',
          description: 'Keyboard key for press actions.',
        },
      },
      required: ['action_id', 'action'],
    },
    execute: performBrowserAction,
  },
  {
    name: 'dify_navigate',
    title: 'Navigate within Dify',
    description: 'Navigates to a same-origin Dify path. Use this to move between Dify pages without relying on visual menus.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Same-origin path such as /apps, /tools, or /app/{appId}/workflow.',
        },
      },
      required: ['path'],
    },
    execute: navigate,
  },
  {
    name: 'dify_get_workflow_context',
    title: 'Get Dify workflow context',
    description: 'Returns workflow graph context when the workflow builder is mounted, including node and edge summaries for browser-based orchestration.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: getWorkflowContext,
  },
  {
    name: 'dify_explain_workflow_schema',
    title: 'Explain Dify workflow schema',
    description: 'Returns a compact workflow construction guide: graph contract, node type purposes, build strategy, and debug cycle for agents.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: getWorkflowConstructionGuide,
  },
  {
    name: 'dify_validate_workflow_graph',
    title: 'Validate workflow graph',
    description: 'Summarizes and validates a workflow graph or the current app draft: node types, entry nodes, terminal nodes, start variables, unreachable nodes, and dangling edges.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'Optional app ID. Defaults to the app ID in the current route when graph is omitted.',
        },
        graph: {
          type: 'object',
          description: 'Optional workflow graph containing nodes and edges. If omitted, the current draft is fetched.',
        },
      },
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: validateWorkflowGraph,
  },
  {
    name: 'dify_get_workflow_node_default_config',
    title: 'Get workflow node default config',
    description: 'Fetches the backend default config for a workflow block type. Use this before constructing or inserting a node so the graph shape matches Dify validation rules.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'Optional app ID. Defaults to the app ID in the current route.',
        },
        block_type: {
          type: 'string',
          description: 'Workflow block type, such as llm, code, http-request, tool, human-input, or end.',
        },
        type: {
          type: 'string',
          description: 'Alias for block_type.',
        },
        query: {
          type: 'object',
          description: 'Optional backend query payload for block types that need provider/tool context.',
        },
      },
      required: ['block_type'],
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: getWorkflowNodeDefaultConfig,
  },
  {
    name: 'dify_get_workflow_draft',
    title: 'Get workflow draft',
    description: 'Fetches the current app workflow draft through the authenticated Dify console API, including graph JSON and draft hash.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'Optional app ID. Defaults to the app ID in the current route.',
        },
      },
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: getWorkflowDraft,
  },
  {
    name: 'dify_sync_workflow_draft',
    title: 'Sync workflow draft',
    description: 'Writes a workflow graph draft through the authenticated Dify console API and returns preflight graph validation. Use this for non-visual workflow orchestration when the full graph is known.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'Optional app ID. Defaults to the app ID in the current route.',
        },
        graph: {
          type: 'object',
          description: 'Workflow graph containing nodes, edges, and optional viewport.',
        },
        features: {
          type: 'object',
          description: 'Workflow feature configuration. Defaults to an empty object.',
        },
        hash: {
          type: 'string',
          description: 'Optional draft hash for optimistic concurrency.',
        },
        environment_variables: {
          type: 'array',
          description: 'Optional environment variables.',
          items: { type: 'object' },
        },
        conversation_variables: {
          type: 'array',
          description: 'Optional conversation variables.',
          items: { type: 'object' },
        },
      },
      required: ['graph'],
    },
    execute: syncWorkflowDraftForAgent,
  },
  {
    name: 'dify_run_workflow_draft',
    title: 'Run workflow draft',
    description: 'Runs the current or specified workflow draft through the authenticated console API and returns parsed streaming events, final status, text chunks, and node execution summaries.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'Optional app ID. Defaults to the app ID in the current route.',
        },
        app_mode: {
          type: 'string',
          description: 'Use advanced-chat for chatflow draft runs. Defaults to workflow.',
          enum: ['workflow', 'advanced-chat'],
        },
        inputs: {
          type: 'object',
          description: 'Workflow input values keyed by Start node variable name.',
        },
        files: {
          type: 'array',
          description: 'Optional uploaded file references.',
          items: { type: 'object' },
        },
        query: {
          type: 'string',
          description: 'Optional chat query for advanced-chat or single-node-compatible workflows.',
        },
      },
    },
    execute: runWorkflowDraft,
  },
  {
    name: 'dify_run_workflow_node',
    title: 'Run workflow node',
    description: 'Runs one draft workflow node with supplied inputs and returns the node execution result. Use this for targeted debugging.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'Optional app ID. Defaults to the app ID in the current route.',
        },
        node_id: {
          type: 'string',
          description: 'Draft node ID to run.',
        },
        inputs: {
          type: 'object',
          description: 'Input values available to the node run.',
        },
        query: {
          type: 'string',
          description: 'Optional query for nodes that use query text.',
        },
        files: {
          type: 'array',
          description: 'Optional uploaded file references.',
          items: { type: 'object' },
        },
      },
      required: ['node_id'],
    },
    execute: runWorkflowNode,
  },
  {
    name: 'dify_get_workflow_runs',
    title: 'Get workflow runs',
    description: 'Lists recent workflow runs for debugging or app-run execution history.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'Optional app ID. Defaults to the app ID in the current route.',
        },
        limit: {
          type: 'number',
          description: 'Number of runs to return. Defaults to 20.',
        },
        status: {
          type: 'string',
          description: 'Optional run status filter.',
          enum: ['running', 'succeeded', 'failed', 'stopped', 'partial-succeeded'],
        },
        triggered_from: {
          type: 'string',
          description: 'Run source. Defaults server-side to debugging.',
          enum: ['debugging', 'app-run'],
        },
        last_id: {
          type: 'string',
          description: 'Optional pagination cursor.',
        },
      },
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: getWorkflowRuns,
  },
  {
    name: 'dify_get_workflow_run_detail',
    title: 'Get workflow run detail',
    description: 'Fetches workflow run detail by run_id for debugging final inputs, outputs, status, and error.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'Optional app ID. Defaults to the app ID in the current route.',
        },
        run_id: {
          type: 'string',
          description: 'Workflow run ID.',
        },
        workflow_run_id: {
          type: 'string',
          description: 'Alias for run_id.',
        },
      },
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: getWorkflowRunDetail,
  },
  {
    name: 'dify_get_workflow_run_node_executions',
    title: 'Get workflow run node executions',
    description: 'Fetches per-node execution traces for a workflow run, including node inputs, process data, outputs, status, timing, and errors.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'Optional app ID. Defaults to the app ID in the current route.',
        },
        run_id: {
          type: 'string',
          description: 'Workflow run ID.',
        },
        workflow_run_id: {
          type: 'string',
          description: 'Alias for run_id.',
        },
      },
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: getWorkflowRunNodeExecutions,
  },
  {
    name: 'dify_stop_workflow_run',
    title: 'Stop workflow run',
    description: 'Stops a running workflow task by task_id.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'Optional app ID. Defaults to the app ID in the current route.',
        },
        task_id: {
          type: 'string',
          description: 'Task ID from dify_run_workflow_draft summary.',
        },
      },
      required: ['task_id'],
    },
    execute: stopWorkflowRun,
  },
  {
    name: 'dify_create_workflow_app',
    title: 'Create workflow app',
    description: 'Creates a new Dify workflow app through the authenticated console API and optionally navigates to its workflow builder.',
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Optional app description.',
        },
        icon: {
          type: 'string',
          description: 'Optional emoji icon. Defaults to 🤖.',
        },
        icon_background: {
          type: 'string',
          description: 'Optional icon background color.',
        },
        name: {
          type: 'string',
          description: 'Workflow app name.',
        },
        navigate_to_workflow: {
          type: 'boolean',
          description: 'Navigate to /app/{appId}/workflow after creation. Defaults to true.',
        },
      },
      required: ['name'],
    },
    execute: createWorkflowAppForAgent,
  },
  {
    name: 'dify_list_workflow_recipes',
    title: 'List workflow recipes',
    description: 'Lists known workflow construction recipes, including plugin-aware finance automation blueprints.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: listWorkflowRecipes,
  },
  {
    name: 'dify_get_workflow_recipe',
    title: 'Get workflow recipe',
    description: 'Returns a detailed workflow recipe with node blueprint, plugin prerequisites, controls, and test cases.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: {
          type: 'string',
          description: 'Recipe id. Defaults to the finance credit-first recipe.',
        },
      },
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: input => getWorkflowRecipeForAgent(getStringInput(input, 'recipe_id')),
  },
  {
    name: 'dify_build_workflow_recipe_plan',
    title: 'Build workflow recipe plan',
    description: 'Returns an execution plan for building, validating, debugging, and publishing a known workflow recipe.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: {
          type: 'string',
          description: 'Recipe id. Defaults to the finance credit-first recipe.',
        },
      },
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: input => buildWorkflowRecipePlan(getStringInput(input, 'recipe_id')),
  },
  {
    name: 'dify_search_marketplace_plugins',
    title: 'Search Marketplace plugins',
    description: 'Searches Dify Marketplace for plugin packages by query, category, tags, and type. Use this to discover trigger/tool plugins before constructing plugin workflows.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Optional plugin category such as trigger or tool.',
        },
        exclude: {
          type: 'array',
          description: 'Optional plugin ids to exclude.',
          items: { type: 'string' },
        },
        page: {
          type: 'number',
          description: 'Page number. Defaults to 1.',
        },
        page_size: {
          type: 'number',
          description: 'Page size. Defaults to 10.',
        },
        query: {
          type: 'string',
          description: 'Search query.',
        },
        tags: {
          type: 'array',
          description: 'Optional Marketplace tags.',
          items: { type: 'string' },
        },
        type: {
          type: 'string',
          description: 'Marketplace item type. Defaults to plugin.',
          enum: ['plugin', 'bundle'],
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      untrustedContentHint: true,
    },
    execute: searchMarketplacePlugins,
  },
  {
    name: 'dify_list_installed_plugin_capabilities',
    title: 'List installed plugin capabilities',
    description: 'Lists installed plugin packages plus available tool providers, trigger providers, events, parameter schemas, and current app triggers.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'Optional app ID. Defaults to the app ID in the current route.',
        },
      },
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: listInstalledPluginCapabilities,
  },
  {
    name: 'dify_list_mcp_adapted_plugin_tools',
    title: 'List MCP-adapted plugin tools',
    description: 'Lists installed Marketplace plugin tools as MCP-style discovery snapshots with best-effort JSON input schemas and Dify workflow-node metadata. Plugin schemas are version- and workspace-scoped, not globally fixed.',
    inputSchema: {
      type: 'object',
      properties: {
        include_credential_info: {
          type: 'boolean',
          description: 'When true, fetches credential status for each matched provider.',
        },
        plugin_id: {
          type: 'string',
          description: 'Optional plugin id filter, such as petrus/quickbooks.',
        },
        plugin_unique_identifier: {
          type: 'string',
          description: 'Optional installed plugin unique identifier filter.',
        },
        provider: {
          type: 'string',
          description: 'Optional provider id/name filter.',
        },
        provider_id: {
          type: 'string',
          description: 'Alias for provider.',
        },
        tool_name: {
          type: 'string',
          description: 'Optional tool action name filter.',
        },
        unique_identifier: {
          type: 'string',
          description: 'Alias for plugin_unique_identifier.',
        },
      },
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: listMcpAdaptedPluginTools,
  },
  {
    name: 'dify_get_plugin_tool_credential_info',
    title: 'Get plugin tool credential info',
    description: 'Fetches credential and authorization status for an installed Marketplace plugin tool provider.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          description: 'Provider id/name, for example petrus/quickbooks/quickbooks.',
        },
        provider_id: {
          type: 'string',
          description: 'Alias for provider.',
        },
        provider_name: {
          type: 'string',
          description: 'Alias for provider.',
        },
      },
      required: ['provider'],
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: getPluginToolCredentialInfo,
  },
  {
    name: 'dify_build_plugin_tool_workflow_node',
    title: 'Build plugin tool workflow node',
    description: 'Builds Dify workflow tool-node JSON for an installed Marketplace plugin tool. Use this after dify_list_mcp_adapted_plugin_tools, then sync and run the workflow draft.',
    inputSchema: {
      type: 'object',
      properties: {
        constant_parameters: {
          type: 'object',
          description: 'Optional plain parameter values to wrap as constant workflow tool inputs.',
        },
        description: {
          type: 'string',
          description: 'Optional node description.',
        },
        mcp_tool_name: {
          type: 'string',
          description: 'Optional MCP-adapted tool name returned by dify_list_mcp_adapted_plugin_tools.',
        },
        node_id: {
          type: 'string',
          description: 'Optional workflow node id.',
        },
        parameters: {
          type: 'object',
          description: 'Alias for constant_parameters.',
        },
        plugin_id: {
          type: 'string',
          description: 'Optional plugin id.',
        },
        plugin_unique_identifier: {
          type: 'string',
          description: 'Optional installed plugin unique identifier.',
        },
        position: {
          type: 'object',
          description: 'Optional React Flow position.',
        },
        provider: {
          type: 'string',
          description: 'Provider id/name. Required when mcp_tool_name is not provided.',
        },
        provider_id: {
          type: 'string',
          description: 'Alias for provider.',
        },
        provider_name: {
          type: 'string',
          description: 'Optional provider display/name value.',
        },
        provider_type: {
          type: 'string',
          description: 'Provider type. Defaults to builtin for Marketplace plugin tools.',
        },
        title: {
          type: 'string',
          description: 'Optional node title.',
        },
        tool_configurations: {
          type: 'object',
          description: 'Optional workflow tool configuration values.',
        },
        tool_label: {
          type: 'string',
          description: 'Optional tool display label.',
        },
        tool_name: {
          type: 'string',
          description: 'Tool action name. Required when mcp_tool_name is not provided.',
        },
        tool_parameters: {
          type: 'object',
          description: 'Optional workflow-format tool_parameters map. When provided, this takes precedence over constant_parameters.',
        },
      },
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: buildPluginToolWorkflowNode,
  },
  {
    name: 'dify_get_plugin_readme',
    title: 'Get plugin README',
    description: 'Fetches the installed plugin README for agent understanding of configuration, credentials, and usage.',
    inputSchema: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          description: 'Optional README language, such as en-US or zh-Hans.',
        },
        plugin_unique_identifier: {
          type: 'string',
          description: 'Installed plugin unique identifier.',
        },
        unique_identifier: {
          type: 'string',
          description: 'Alias for plugin_unique_identifier.',
        },
      },
      required: ['plugin_unique_identifier'],
    },
    annotations: {
      readOnlyHint: true,
      untrustedContentHint: true,
    },
    execute: getPluginReadme,
  },
  {
    name: 'dify_install_marketplace_plugins',
    title: 'Install Marketplace plugins',
    description: 'Installs one or more Marketplace plugin package unique identifiers into the current workspace. After install, rediscover installed plugin schemas because plugin inputs/outputs are dynamic and version-scoped.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin_unique_identifier: {
          type: 'string',
          description: 'Single plugin package unique identifier.',
        },
        plugin_unique_identifiers: {
          type: 'array',
          description: 'Plugin package unique identifiers.',
          items: { type: 'string' },
        },
        unique_identifiers: {
          type: 'array',
          description: 'Alias for plugin_unique_identifiers.',
          items: { type: 'string' },
        },
      },
    },
    execute: installMarketplacePlugins,
  },
  {
    name: 'dify_get_plugin_install_tasks',
    title: 'Get plugin install tasks',
    description: 'Lists recent plugin install, upgrade, and package tasks so agents can wait for install completion or inspect errors.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: getPluginInstallTasks,
  },
  {
    name: 'dify_get_plugin_task_detail',
    title: 'Get plugin task detail',
    description: 'Fetches a single plugin install or upgrade task by task_id so agents can wait for completion before querying installed plugin schemas.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Plugin install or upgrade task id.',
        },
      },
      required: ['task_id'],
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: getPluginTaskDetail,
  },
  {
    name: 'dify_uninstall_plugin',
    title: 'Uninstall plugin',
    description: 'Uninstalls an installed plugin from the current workspace. Prefer plugin_installation_id from dify_list_installed_plugin_capabilities; plugin_unique_identifier or plugin_id can be used for lookup.',
    inputSchema: {
      type: 'object',
      properties: {
        installation_id: {
          type: 'string',
          description: 'Alias for plugin_installation_id.',
        },
        plugin_id: {
          type: 'string',
          description: 'Optional plugin id lookup, such as petrus/quickbooks.',
        },
        plugin_installation_id: {
          type: 'string',
          description: 'Installed plugin record id from Dify plugin list.',
        },
        plugin_unique_identifier: {
          type: 'string',
          description: 'Optional installed plugin unique identifier lookup.',
        },
        unique_identifier: {
          type: 'string',
          description: 'Alias for plugin_unique_identifier.',
        },
      },
    },
    execute: uninstallPluginForAgent,
  },
  {
    name: 'dify_get_trigger_provider_detail',
    title: 'Get trigger provider detail',
    description: 'Fetches trigger provider detail and subscriptions for a provider id/name. Use this before creating a trigger-plugin node or subscription.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          description: 'Trigger provider name/id, for example petrus/mercury_trigger/mercury_trigger.',
        },
        provider_id: {
          type: 'string',
          description: 'Alias for provider.',
        },
        provider_name: {
          type: 'string',
          description: 'Alias for provider.',
        },
      },
      required: ['provider'],
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: getTriggerProviderDetail,
  },
  {
    name: 'dify_create_trigger_subscription_builder',
    title: 'Create trigger subscription builder',
    description: 'Creates a trigger subscription builder for a provider. This prepares credentials and parameters before building a subscription.',
    inputSchema: {
      type: 'object',
      properties: {
        credential_type: {
          type: 'string',
          description: 'Credential type such as APIKEY, OAUTH, MANUAL, or null for provider default.',
        },
        provider: {
          type: 'string',
          description: 'Trigger provider name/id.',
        },
      },
      required: ['provider'],
    },
    execute: createTriggerSubscriptionBuilder,
  },
  {
    name: 'dify_update_trigger_subscription_builder',
    title: 'Update trigger subscription builder',
    description: 'Updates trigger subscription builder credentials, properties, parameters, or display name.',
    inputSchema: {
      type: 'object',
      properties: {
        credentials: {
          type: 'object',
          description: 'Provider credential values. Treat as sensitive.',
        },
        name: {
          type: 'string',
          description: 'Optional subscription name.',
        },
        parameters: {
          type: 'object',
          description: 'Subscription parameters.',
        },
        properties: {
          type: 'object',
          description: 'Subscription properties.',
        },
        provider: {
          type: 'string',
          description: 'Trigger provider name/id.',
        },
        subscription_builder_id: {
          type: 'string',
          description: 'Subscription builder id.',
        },
      },
      required: ['provider', 'subscription_builder_id'],
    },
    execute: updateTriggerSubscriptionBuilder,
  },
  {
    name: 'dify_verify_trigger_subscription_builder',
    title: 'Verify trigger subscription builder',
    description: 'Verifies trigger subscription builder credentials and stores the verified state when supported.',
    inputSchema: {
      type: 'object',
      properties: {
        credentials: {
          type: 'object',
          description: 'Credential values to verify. Treat as sensitive.',
        },
        provider: {
          type: 'string',
          description: 'Trigger provider name/id.',
        },
        subscription_builder_id: {
          type: 'string',
          description: 'Subscription builder id.',
        },
      },
      required: ['provider', 'subscription_builder_id'],
    },
    execute: verifyTriggerSubscriptionBuilder,
  },
  {
    name: 'dify_build_trigger_subscription',
    title: 'Build trigger subscription',
    description: 'Builds a trigger subscription from a verified builder and returns subscription details or build errors.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Optional subscription name.',
        },
        parameters: {
          type: 'object',
          description: 'Subscription parameters.',
        },
        provider: {
          type: 'string',
          description: 'Trigger provider name/id.',
        },
        subscription_builder_id: {
          type: 'string',
          description: 'Subscription builder id.',
        },
      },
      required: ['provider', 'subscription_builder_id'],
    },
    execute: buildTriggerSubscription,
  },
  {
    name: 'dify_get_trigger_subscription_builder_logs',
    title: 'Get trigger subscription builder logs',
    description: 'Fetches logs emitted while verifying or building a trigger subscription.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          description: 'Trigger provider name/id.',
        },
        subscription_builder_id: {
          type: 'string',
          description: 'Subscription builder id.',
        },
      },
      required: ['provider', 'subscription_builder_id'],
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: getTriggerSubscriptionBuilderLogs,
  },
  {
    name: 'dify_get_plugin_dynamic_options',
    title: 'Get plugin dynamic options',
    description: 'Fetches dynamic option values for plugin tool or trigger parameters, such as account selectors.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Tool action name or trigger event name.',
        },
        extra: {
          type: 'object',
          description: 'Optional extra query parameters.',
        },
        parameter: {
          type: 'string',
          description: 'Parameter name to fetch options for.',
        },
        plugin_id: {
          type: 'string',
          description: 'Plugin id, for example petrus/quickbooks.',
        },
        provider: {
          type: 'string',
          description: 'Provider id/name.',
        },
        provider_type: {
          type: 'string',
          description: 'Provider type, such as builtin or trigger.',
        },
      },
      required: ['plugin_id', 'provider', 'action', 'parameter'],
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: getPluginDynamicOptions,
  },
  {
    name: 'dify_get_app_triggers',
    title: 'Get app triggers',
    description: 'Lists trigger records generated for a published workflow app, including enabled, disabled, and unauthorized states.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'Optional app ID. Defaults to current route.',
        },
      },
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: getAppTriggers,
  },
  {
    name: 'dify_set_app_trigger_enabled',
    title: 'Enable or disable app trigger',
    description: 'Enables or disables a published app trigger record by trigger id.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'Optional app ID. Defaults to current route.',
        },
        enable_trigger: {
          type: 'boolean',
          description: 'Whether to enable the trigger. Defaults to true.',
        },
        trigger_id: {
          type: 'string',
          description: 'App trigger record id.',
        },
      },
      required: ['trigger_id'],
    },
    execute: setAppTriggerEnabled,
  },
  {
    name: 'dify_import_app_dsl',
    title: 'Import Dify app DSL',
    description: 'Imports a Dify YAML DSL through the authenticated console API and optionally navigates to the imported workflow. Use this to build complex workflows without visual editing.',
    inputSchema: {
      type: 'object',
      properties: {
        yaml_content: {
          type: 'string',
          description: 'Complete Dify app YAML DSL content.',
        },
        app_id: {
          type: 'string',
          description: 'Optional existing app ID to update. Omit to create a new app.',
        },
        name: {
          type: 'string',
          description: 'Optional app name override.',
        },
        description: {
          type: 'string',
          description: 'Optional app description override.',
        },
        auto_confirm_version_mismatch: {
          type: 'boolean',
          description: 'Confirm pending imports caused by DSL version mismatch. Defaults to true.',
        },
        navigate_to_workflow: {
          type: 'boolean',
          description: 'Navigate to /app/{appId}/workflow after a completed import. Defaults to true.',
        },
      },
      required: ['yaml_content'],
    },
    execute: importAppDsl,
  },
  {
    name: 'dify_publish_workflow',
    title: 'Publish workflow',
    description: 'Publishes the current or specified app workflow through the authenticated Dify console API.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'Optional app ID. Defaults to the app ID in the current route.',
        },
        marked_name: {
          type: 'string',
          description: 'Optional version name, max 20 characters.',
        },
        marked_comment: {
          type: 'string',
          description: 'Optional release note, max 100 characters.',
        },
      },
    },
    execute: publishWorkflow,
  },
  {
    name: 'dify_export_app_dsl',
    title: 'Export Dify app DSL',
    description: 'Exports the current or specified app YAML DSL through the authenticated Dify console API for non-visual verification or migration.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'Optional app ID. Defaults to the app ID in the current route.',
        },
        include_secret: {
          type: 'boolean',
          description: 'Whether to include secret values. Defaults to false.',
        },
        workflow_id: {
          type: 'string',
          description: 'Optional workflow version ID to export.',
        },
      },
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: exportAppDsl,
  },
  {
    name: 'dify_explain_workflow_orchestration',
    title: 'Explain Dify workflow orchestration',
    description: 'Explains how a browser agent should orchestrate Dify workflows using structured page context and browser actions.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: getWorkflowOrchestrationGuide,
  },
]
