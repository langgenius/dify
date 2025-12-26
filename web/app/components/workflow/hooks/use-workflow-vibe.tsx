'use client'

import type { ToolDefaultValue } from '../block-selector/types'
import type { Edge, Node, ToolWithProvider } from '../types'
import type { Tool } from '@/app/components/tools/types'
import type { Model } from '@/types/app'
import { useSessionStorageState } from 'ahooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import { v4 as uuid4 } from 'uuid'
import Toast from '@/app/components/base/toast'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useGetLanguage } from '@/context/i18n'
import type { BackendEdgeSpec, BackendNodeSpec } from '@/service/debug'
import { generateFlowchart } from '@/service/debug'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'
import { ModelModeType } from '@/types/app'
import { basePath } from '@/utils/var'
import {
  CUSTOM_EDGE,
  NODE_WIDTH,
  NODE_WIDTH_X_OFFSET,
  VIBE_APPLY_EVENT,
  VIBE_COMMAND_EVENT,
} from '../constants'
import { useHooksStore } from '../hooks-store'
import { useWorkflowStore } from '../store'
import { BlockEnum } from '../types'
import {
  generateNewNode,
  getLayoutByDagre,
  getNodeCustomTypeByNodeDataType,
  getNodesConnectedSourceOrTargetHandleIdsMap,
} from '../utils'
import { useNodesMetaData } from './use-nodes-meta-data'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import { useNodesReadOnly } from './use-workflow'
import { useWorkflowHistory, WorkflowHistoryEvent } from './use-workflow-history'
import { NODE_TYPE_ALIASES, correctFieldName } from './use-workflow-vibe-config'

type VibeCommandDetail = {
  dsl?: string
}

type ParsedNodeDraft = {
  id: string
  type?: BlockEnum
  title?: string
  toolKey?: string
}

type ParsedNode = {
  id: string
  type: BlockEnum
  title?: string
  toolKey?: string
}

type ParsedEdge = {
  sourceId: string
  targetId: string
  label?: string
}

type ParseError = {
  error: 'invalidMermaid' | 'missingNodeType' | 'unknownNodeType' | 'unknownTool' | 'missingNodeDefinition' | 'unknownNodeId' | 'unsupportedEdgeLabel'
  detail?: string
}

type ParseResult = {
  nodes: ParsedNode[]
  edges: ParsedEdge[]
}

type FlowGraph = {
  nodes: Node[]
  edges: Edge[]
}

const NODE_DECLARATION = /^([A-Z][\w-]*)\s*\[(?:"([^"]+)"|([^\]]+))\]\s*$/i
const EDGE_DECLARATION = /^(.+?)\s*-->\s*(?:\|([^|]+)\|\s*)?(.+)$/

const extractMermaidCode = (raw: string) => {
  const fencedMatch = raw.match(/```(?:mermaid)?\s*([\s\S]*?)```/i)
  return (fencedMatch ? fencedMatch[1] : raw).trim()
}

const isMermaidFlowchart = (value: string) => {
  const trimmed = value.trim().toLowerCase()
  return trimmed.startsWith('flowchart') || trimmed.startsWith('graph')
}

const normalizeKey = (value: string) => value.trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

const normalizeProviderIcon = (icon?: ToolWithProvider['icon']) => {
  if (!icon)
    return icon
  if (typeof icon === 'string' && basePath && icon.startsWith('/') && !icon.startsWith(`${basePath}/`))
    return `${basePath}${icon}`
  return icon
}

/**
 * Replace variable references in node data using the nodeIdMap.
 * Handles:
 * - String templates: {{#old_id.field#}} → {{#new_id.field#}}
 * - Value selectors: ["old_id", "field"] → ["new_id", "field"]
 * - Mixed content objects: {type: "mixed", value: "..."} → normalized to string
 * - Field name correction based on node type
 */
const replaceVariableReferences = (
  data: unknown,
  nodeIdMap: Map<string, Node>,
  parentKey?: string,
): unknown => {
  if (typeof data === 'string') {
    // Replace {{#old_id.field#}} patterns and correct field names
    return data.replace(/\{\{#([^.#]+)\.([^#]+)#\}\}/g, (match, oldId, field) => {
      const newNode = nodeIdMap.get(oldId)
      if (newNode) {
        const nodeType = newNode.data?.type as string || ''
        const correctedField = correctFieldName(field, nodeType)
        return `{{#${newNode.id}.${correctedField}#}}`
      }
      return match // Keep original if no mapping found
    })
  }

  if (Array.isArray(data)) {
    // Check if this is a value_selector array: ["node_id", "field", ...]
    if (data.length >= 2 && typeof data[0] === 'string' && typeof data[1] === 'string') {
      const potentialNodeId = data[0]
      const newNode = nodeIdMap.get(potentialNodeId)
      if (newNode) {
        const nodeType = newNode.data?.type as string || ''
        const correctedField = correctFieldName(data[1], nodeType)
        // Replace the node ID and correct field name in value_selector
        return [newNode.id, correctedField, ...data.slice(2)]
      }
    }
    // Recursively process array elements
    return data.map(item => replaceVariableReferences(item, nodeIdMap))
  }

  if (data !== null && typeof data === 'object') {
    const obj = data as Record<string, unknown>

    // Handle "mixed content" objects like {type: "mixed", value: "{{#...#}}"}
    // These should be normalized to plain strings for fields like 'url'
    if (obj.type === 'mixed' && typeof obj.value === 'string') {
      const processedValue = replaceVariableReferences(obj.value, nodeIdMap) as string
      // For certain fields (url, headers, params), return just the string value
      if (parentKey && ['url', 'headers', 'params'].includes(parentKey)) {
        return processedValue
      }
      // Otherwise keep the object structure but update the value
      return { ...obj, value: processedValue }
    }

    // Recursively process object properties
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = replaceVariableReferences(value, nodeIdMap, key)
    }
    return result
  }

  return data // Return primitives as-is
}

const parseNodeLabel = (label: string) => {
  const tokens = label.split('|').map(token => token.trim()).filter(Boolean)
  const info: Record<string, string> = {}

  tokens.forEach((token) => {
    const [rawKey, ...rest] = token.split('=')
    if (!rawKey || rest.length === 0)
      return
    info[rawKey.trim().toLowerCase()] = rest.join('=').trim()
  })

  // Fallback: if no type= found, try to infer from label text
  if (!info.type && tokens.length === 1 && !tokens[0].includes('=')) {
    const labelLower = tokens[0].toLowerCase()
    // Check if label matches a known node type alias
    if (NODE_TYPE_ALIASES[labelLower]) {
      info.type = NODE_TYPE_ALIASES[labelLower]
      info.title = tokens[0] // Use original label as title
    }
    else {
      info.type = tokens[0]
    }
  }

  if (!info.tool && info.tool_key)
    info.tool = info.tool_key

  return info
}

const parseNodeToken = (token: string) => {
  const trimmed = token.trim()
  const match = trimmed.match(NODE_DECLARATION)
  if (match)
    return { id: match[1], label: match[2] || match[3] }
  const idMatch = trimmed.match(/^([A-Z][\w-]*)$/i)
  if (idMatch)
    return { id: idMatch[1] }
  return null
}

const normalizeBranchLabel = (label?: string) => {
  if (!label)
    return ''
  const normalized = label.trim().toLowerCase()
  if (['true', 'yes', 'y', '1'].includes(normalized))
    return 'true'
  if (['false', 'no', 'n', '0'].includes(normalized))
    return 'false'
  return ''
}

const parseMermaidFlowchart = (
  raw: string,
  nodeTypeLookup: Map<string, BlockEnum>,
  toolLookup: Map<string, ToolDefaultValue>,
): ParseResult | ParseError => {
  const code = extractMermaidCode(raw)
  const lines = code.split(/\r?\n/).map((line) => {
    const commentIndex = line.indexOf('%%')
    return (commentIndex >= 0 ? line.slice(0, commentIndex) : line).trim()
  }).filter(Boolean)

  const nodesMap = new Map<string, ParsedNodeDraft>()
  const declaredNodeIds = new Set<string>()
  const edges: ParsedEdge[] = []

  const registerNode = (id: string, label?: string): ParseError | null => {
    const existing = nodesMap.get(id)
    if (!label) {
      if (!existing)
        nodesMap.set(id, { id })
      return null
    }

    const info = parseNodeLabel(label)
    if (!info.type)
      return { error: 'missingNodeType', detail: label }

    const typeKey = normalizeKey(info.type)
    const nodeType = nodeTypeLookup.get(typeKey)
    if (!nodeType)
      return { error: 'unknownNodeType', detail: info.type }

    const nodeData: ParsedNodeDraft = {
      id,
      type: nodeType,
      title: info.title,
    }

    if (nodeType === BlockEnum.Tool) {
      if (!info.tool)
        return { error: 'unknownTool', detail: 'tool' }
      const toolKey = normalizeKey(info.tool)
      if (!toolLookup.has(toolKey))
        return { error: 'unknownTool', detail: info.tool }
      nodeData.toolKey = toolKey
    }

    nodesMap.set(id, { ...(existing || {}), ...nodeData })
    declaredNodeIds.add(id)
    return null
  }

  for (const line of lines) {
    if (line.toLowerCase().startsWith('flowchart') || line.toLowerCase().startsWith('graph'))
      continue

    if (line.includes('-->')) {
      const edgeMatch = line.match(EDGE_DECLARATION)
      if (!edgeMatch)
        return { error: 'invalidMermaid', detail: line }

      const sourceToken = parseNodeToken(edgeMatch[1])
      const targetToken = parseNodeToken(edgeMatch[3])
      if (!sourceToken || !targetToken)
        return { error: 'invalidMermaid', detail: line }

      if (!sourceToken.label && !declaredNodeIds.has(sourceToken.id))
        return { error: 'unknownNodeId', detail: sourceToken.id }
      if (!targetToken.label && !declaredNodeIds.has(targetToken.id))
        return { error: 'unknownNodeId', detail: targetToken.id }

      const sourceError = registerNode(sourceToken.id, sourceToken.label)
      if (sourceError)
        return sourceError
      const targetError = registerNode(targetToken.id, targetToken.label)
      if (targetError)
        return targetError

      edges.push({
        sourceId: sourceToken.id,
        targetId: targetToken.id,
        label: edgeMatch[2]?.trim() || undefined,
      })
      continue
    }

    const nodeMatch = line.match(NODE_DECLARATION)
    if (nodeMatch) {
      const error = registerNode(nodeMatch[1], nodeMatch[2] || nodeMatch[3])
      if (error)
        return error
    }
  }

  const parsedNodes: ParsedNode[] = []
  const nodeTypeById = new Map<string, BlockEnum>()
  for (const node of nodesMap.values()) {
    if (!node.type)
      return { error: 'missingNodeDefinition', detail: node.id }
    parsedNodes.push(node as ParsedNode)
    nodeTypeById.set(node.id, node.type)
  }

  if (!parsedNodes.length)
    return { error: 'invalidMermaid', detail: '' }

  for (const edge of edges) {
    if (!edge.label)
      continue
    const sourceType = nodeTypeById.get(edge.sourceId)
    const branchLabel = normalizeBranchLabel(edge.label)
    if (sourceType !== BlockEnum.IfElse || !branchLabel)
      return { error: 'unsupportedEdgeLabel', detail: edge.label }
  }

  return { nodes: parsedNodes, edges }
}

const dedupeHandles = (handles?: string[]) => {
  if (!handles)
    return handles
  return Array.from(new Set(handles))
}

const buildToolParams = (parameters?: Tool['parameters']) => {
  const params: Record<string, string> = {}
  if (!parameters)
    return params
  parameters.forEach((item) => {
    params[item.name] = ''
  })
  return params
}

type UseVibeFlowDataParams = {
  storageKey: string
}

const keyPrefix = 'vibe-flow-'

export const useVibeFlowData = ({ storageKey }: UseVibeFlowDataParams) => {
  const [versions, setVersions] = useSessionStorageState<FlowGraph[]>(`${keyPrefix}${storageKey}-versions`, {
    defaultValue: [],
  })

  const [currentVersionIndex, setCurrentVersionIndex] = useSessionStorageState<number>(`${keyPrefix}${storageKey}-version-index`, {
    defaultValue: 0,
  })

  useEffect(() => {
    if (!versions || versions.length === 0) {
      if (currentVersionIndex !== 0 && currentVersionIndex !== -1)
        setCurrentVersionIndex(0)
      return
    }

    if (currentVersionIndex === -1)
      return

    const normalizedIndex = Math.min(Math.max(currentVersionIndex ?? 0, 0), versions.length - 1)
    if (normalizedIndex !== currentVersionIndex)
      setCurrentVersionIndex(normalizedIndex)
  }, [versions, currentVersionIndex, setCurrentVersionIndex])

  const current = useMemo(() => {
    if (!versions || versions.length === 0)
      return undefined
    const index = currentVersionIndex ?? 0
    if (index < 0)
      return undefined
    return versions[index] || versions[versions.length - 1]
  }, [versions, currentVersionIndex])

  const addVersion = useCallback((version: FlowGraph) => {
    // Prevent adding empty graphs
    if (!version || !version.nodes || version.nodes.length === 0) {
      setCurrentVersionIndex(-1)
      return
    }

    setVersions((prev) => {
      const newVersions = [...(prev || []), version]
      // Set index in setVersions callback to ensure using the latest length
      setCurrentVersionIndex(newVersions.length - 1)
      return newVersions
    })
  }, [setVersions, setCurrentVersionIndex])

  return {
    versions,
    addVersion,
    currentVersionIndex,
    setCurrentVersionIndex,
    current,
  }
}

export const useWorkflowVibe = () => {
  const { t } = useTranslation()
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const configsMap = useHooksStore(s => s.configsMap)

  const language = useGetLanguage()
  const { nodesMap: nodesMetaDataMap } = useNodesMetaData()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { saveStateToHistory } = useWorkflowHistory()
  const { defaultModel, modelList } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)

  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()

  const [modelConfig, setModelConfig] = useState<Model | null>(null)
  const isGeneratingRef = useRef(false)
  const lastInstructionRef = useRef<string>('')

  const { addVersion, current: currentFlowGraph } = useVibeFlowData({
    storageKey: configsMap?.flowId || '',
  })

  useEffect(() => {
    const storedModel = (() => {
      if (typeof window === 'undefined')
        return null
      const stored = localStorage.getItem('auto-gen-model')
      if (!stored)
        return null
      try {
        return JSON.parse(stored) as Model
      }
      catch {
        return null
      }
    })()

    if (storedModel) {
      setModelConfig(storedModel)
      return
    }

    if (defaultModel) {
      setModelConfig({
        name: defaultModel.model,
        provider: defaultModel.provider.provider,
        mode: ModelModeType.chat,
        completion_params: {} as Model['completion_params'],
      })
    }
  }, [defaultModel])

  const getLatestModelConfig = useCallback(() => {
    if (typeof window === 'undefined')
      return modelConfig
    const stored = localStorage.getItem('auto-gen-model')
    if (!stored)
      return modelConfig
    try {
      return JSON.parse(stored) as Model
    }
    catch {
      return modelConfig
    }
  }, [modelConfig])

  const availableNodesList = useMemo(() => {
    if (!nodesMetaDataMap)
      return []
    return Object.values(nodesMetaDataMap).map(node => ({
      type: node.metaData.type,
      title: node.metaData.title,
      description: node.metaData.description,
    }))
  }, [nodesMetaDataMap])

  const toolOptions = useMemo(() => {
    const collections = [
      buildInTools,
      customTools,
      workflowTools,
      mcpTools,
    ].filter(Boolean) as ToolWithProvider[][]

    const tools: ToolDefaultValue[] = []
    const seen = new Set<string>()

    collections.forEach((collection) => {
      collection.forEach((provider) => {
        provider.tools.forEach((tool) => {
          const key = `${provider.id}:${tool.name}`
          if (seen.has(key))
            return
          seen.add(key)

          const params = buildToolParams(tool.parameters)
          const toolDescription = typeof tool.description === 'object'
            ? tool.description?.[language]
            : tool.description
          tools.push({
            provider_id: provider.id,
            provider_type: provider.type,
            provider_name: provider.name,
            plugin_id: provider.plugin_id,
            plugin_unique_identifier: provider.plugin_unique_identifier,
            provider_icon: normalizeProviderIcon(provider.icon),
            provider_icon_dark: normalizeProviderIcon(provider.icon_dark),
            tool_name: tool.name,
            tool_label: tool.label[language] || tool.name,
            tool_description: toolDescription || '',
            title: tool.label[language] || tool.name,
            is_team_authorization: provider.is_team_authorization,
            paramSchemas: tool.parameters,
            params,
            output_schema: tool.output_schema,
            meta: provider.meta,
          })
        })
      })
    })

    return tools
  }, [buildInTools, customTools, workflowTools, mcpTools, language])

  const toolLookup = useMemo(() => {
    const map = new Map<string, ToolDefaultValue>()
    toolOptions.forEach((tool) => {
      // Primary key: provider_id/tool_name (e.g., "google/google_search")
      const primaryKey = normalizeKey(`${tool.provider_id}/${tool.tool_name}`)
      map.set(primaryKey, tool)

      // Fallback 1: provider_name/tool_name (e.g., "Google/google_search")
      const providerNameKey = normalizeKey(`${tool.provider_name}/${tool.tool_name}`)
      map.set(providerNameKey, tool)

      // Fallback 2: tool_label (display name)
      const labelKey = normalizeKey(tool.tool_label)
      map.set(labelKey, tool)

      // Fallback 3: tool_name alone (for partial matching when model omits provider)
      const toolNameKey = normalizeKey(tool.tool_name)
      if (!map.has(toolNameKey)) {
        // Only set if not already taken (avoid collisions between providers)
        map.set(toolNameKey, tool)
      }
    })
    return map
  }, [toolOptions])

  const nodeTypeLookup = useMemo(() => {
    const map = new Map<string, BlockEnum>()
    if (!nodesMetaDataMap)
      return map
    Object.values(nodesMetaDataMap).forEach((node) => {
      map.set(normalizeKey(node.metaData.type), node.metaData.type)
      if (node.metaData.title)
        map.set(normalizeKey(node.metaData.title), node.metaData.type)
    })
    map.set('ifelse', BlockEnum.IfElse)
    map.set('ifelsecase', BlockEnum.IfElse)
    return map
  }, [nodesMetaDataMap])

  const createGraphFromBackendNodes = useCallback(async (
    backendNodes: BackendNodeSpec[],
    backendEdges: BackendEdgeSpec[],
  ): Promise<FlowGraph> => {
    const { getNodes } = store.getState()
    const nodes = getNodes()

    if (!nodesMetaDataMap) {
      Toast.notify({ type: 'error', message: t('workflow.vibe.nodesUnavailable') })
      return { nodes: [], edges: [] }
    }

    const existingStartNode = nodes.find(node => node.data.type === BlockEnum.Start)
    const newNodes: Node[] = []
    const nodeIdMap = new Map<string, Node>()

    for (const nodeSpec of backendNodes) {
      // Map string type to BlockEnum
      const typeKey = normalizeKey(nodeSpec.type)
      const nodeType = nodeTypeLookup.get(typeKey)
      if (!nodeType) {
        // Skip unknown node types
        continue
      }

      if (nodeType === BlockEnum.Start && existingStartNode) {
        // Merge backend variables into existing Start node
        const backendVariables = (nodeSpec.config?.variables as Array<Record<string, unknown>>) || []
        if (backendVariables.length > 0) {
          const existingVariables = (existingStartNode.data.variables as Array<Record<string, unknown>>) || []
          // Add new variables that don't already exist
          for (const backendVar of backendVariables) {
            const varName = backendVar.variable as string
            const exists = existingVariables.some(v => v.variable === varName)
            if (!exists) {
              existingVariables.push(backendVar)
            }
          }
          // Note: we don't mutate existingStartNode directly here for the return value,
          // but we should probably include it in the graph if we want it to be part of the preview?
          // Actually, existingStartNode is already in 'nodes'.
          // The preview usually shows ONLY new nodes + maybe start node?
          // User's code applied changes to existingStartNode directly.
          // For preview, we might want to clone it.
          // For now, we just map it.
        }

        nodeIdMap.set(nodeSpec.id, existingStartNode)
        continue
      }

      const nodeDefault = nodesMetaDataMap[nodeType]
      if (!nodeDefault)
        continue

      const defaultValue = nodeDefault.defaultValue || {}
      const title = nodeSpec.title?.trim() || nodeDefault.metaData.title || defaultValue.title || nodeSpec.type

      // For tool nodes, try to get tool default value from config
      let toolDefaultValue: ToolDefaultValue | undefined
      if (nodeType === BlockEnum.Tool && nodeSpec.config) {
        const toolName = nodeSpec.config.tool_name as string | undefined
        const providerId = nodeSpec.config.provider_id as string | undefined
        if (toolName && providerId) {
          const toolKey = normalizeKey(`${providerId}/${toolName}`)
          toolDefaultValue = toolLookup.get(toolKey) || toolLookup.get(normalizeKey(toolName))
        }
      }

      const desc = (toolDefaultValue?.tool_description || (defaultValue as { desc?: string }).desc || '') as string

      // Merge backend config into node data
      // Backend provides: { url: "{{#start.url#}}", method: "GET", ... }
      const backendConfig = nodeSpec.config || {}

      // Deep merge for nested objects (e.g., body, authorization) to preserve required fields
      const mergedConfig: Record<string, unknown> = { ...backendConfig }
      const defaultValueRecord = defaultValue as Record<string, unknown>

      // For http-request nodes, ensure body has all required fields
      if (nodeType === BlockEnum.HttpRequest) {
        const defaultBody = defaultValueRecord.body as Record<string, unknown> | undefined
        const backendBody = backendConfig.body as Record<string, unknown> | undefined
        if (defaultBody || backendBody) {
          mergedConfig.body = {
            type: 'none',
            data: [],
            ...(defaultBody || {}),
            ...(backendBody || {}),
          }
          // Ensure data is always an array
          if (!Array.isArray((mergedConfig.body as Record<string, unknown>).data)) {
            (mergedConfig.body as Record<string, unknown>).data = []
          }
        }

        // Ensure authorization has type
        const defaultAuth = defaultValueRecord.authorization as Record<string, unknown> | undefined
        const backendAuth = backendConfig.authorization as Record<string, unknown> | undefined
        if (defaultAuth || backendAuth) {
          mergedConfig.authorization = {
            type: 'no-auth',
            ...(defaultAuth || {}),
            ...(backendAuth || {}),
          }
        }
      }

      // For any node with model config, ALWAYS use user's default model
      if (backendConfig.model && defaultModel) {
        mergedConfig.model = {
          provider: defaultModel.provider.provider,
          name: defaultModel.model,
          mode: 'chat',
        }
      }

      const data = {
        ...(defaultValue as Record<string, unknown>),
        title,
        desc,
        type: nodeType,
        selected: false,
        ...(toolDefaultValue || {}),
        // Apply backend-generated config (url, method, headers, etc.)
        ...mergedConfig,
      }

      const newNode = generateNewNode({
        id: uuid4(),
        type: getNodeCustomTypeByNodeDataType(nodeType),
        data,
        position: nodeSpec.position || { x: 0, y: 0 },
      }).newNode

      newNodes.push(newNode)
      nodeIdMap.set(nodeSpec.id, newNode)
    }

    // Replace variable references in all node configs using the nodeIdMap
    for (const node of newNodes) {
      node.data = replaceVariableReferences(node.data, nodeIdMap) as typeof node.data
    }

    if (!newNodes.length) {
      Toast.notify({ type: 'error', message: t('workflow.vibe.invalidFlowchart') })
      return { nodes: [], edges: [] }
    }

    const buildEdge = (
      source: Node,
      target: Node,
      sourceHandle = 'source',
      targetHandle = 'target',
    ): Edge => ({
      id: `${source.id}-${sourceHandle}-${target.id}-${targetHandle}`,
      type: CUSTOM_EDGE,
      source: source.id,
      sourceHandle,
      target: target.id,
      targetHandle,
      data: {
        sourceType: source.data.type,
        targetType: target.data.type,
        isInIteration: false,
        isInLoop: false,
        _connectedNodeIsSelected: false,
      },
      zIndex: 0,
    })

    const newEdges: Edge[] = []
    for (const edgeSpec of backendEdges) {
      const sourceNode = nodeIdMap.get(edgeSpec.source)
      const targetNode = nodeIdMap.get(edgeSpec.target)
      if (!sourceNode || !targetNode)
        continue

      let sourceHandle = edgeSpec.sourceHandle || 'source'
      // Handle IfElse branch handles
      if (sourceNode.data.type === BlockEnum.IfElse && !edgeSpec.sourceHandle) {
        sourceHandle = 'source'
      }

      newEdges.push(buildEdge(sourceNode, targetNode, sourceHandle, edgeSpec.targetHandle || 'target'))
    }

    // Layout nodes
    const bounds = nodes.reduce(
      (acc, node) => {
        const width = node.width ?? NODE_WIDTH
        acc.maxX = Math.max(acc.maxX, node.position.x + width)
        acc.minY = Math.min(acc.minY, node.position.y)
        return acc
      },
      { maxX: 0, minY: 0 },
    )

    const baseX = nodes.length ? bounds.maxX + NODE_WIDTH_X_OFFSET : 0
    const baseY = Number.isFinite(bounds.minY) ? bounds.minY : 0
    const branchOffset = Math.max(120, NODE_WIDTH_X_OFFSET / 2)

    const layoutNodeIds = new Set(newNodes.map(node => node.id))
    const layoutEdges = newEdges.filter(edge =>
      layoutNodeIds.has(edge.source) && layoutNodeIds.has(edge.target),
    )

    try {
      const layout = await getLayoutByDagre(newNodes, layoutEdges)
      const layoutedNodes = newNodes.map((node) => {
        const info = layout.nodes.get(node.id)
        if (!info)
          return node
        return {
          ...node,
          position: {
            x: baseX + info.x,
            y: baseY + info.y,
          },
        }
      })
      newNodes.splice(0, newNodes.length, ...layoutedNodes)
    }
    catch {
      newNodes.forEach((node, index) => {
        const row = Math.floor(index / 4)
        const col = index % 4
        node.position = {
          x: baseX + col * NODE_WIDTH_X_OFFSET,
          y: baseY + row * branchOffset,
        }
      })
    }

    return {
      nodes: newNodes,
      edges: newEdges,
    }
  }, [
    defaultModel,
    nodeTypeLookup,
    nodesMetaDataMap,
    store,
    t,
    toolLookup,
  ])

  // Apply backend-provided nodes directly (bypasses mermaid parsing)
  const applyBackendNodesToWorkflow = useCallback(async (
    backendNodes: BackendNodeSpec[],
    backendEdges: BackendEdgeSpec[],
  ) => {
    const { getNodes, setNodes, edges, setEdges } = store.getState()
    const nodes = getNodes()
    const {
      setShowVibePanel,
    } = workflowStore.getState()

    const { nodes: newNodes, edges: newEdges } = await createGraphFromBackendNodes(backendNodes, backendEdges)

    if (newNodes.length === 0) {
      setShowVibePanel(false)
      return
    }

    const allNodes = [...nodes, ...newNodes]
    const nodesConnectedMap = getNodesConnectedSourceOrTargetHandleIdsMap(
      newEdges.map(edge => ({ type: 'add', edge })),
      allNodes,
    )

    const updatedNodes = allNodes.map((node) => {
      const connected = nodesConnectedMap[node.id]
      if (!connected)
        return node

      return {
        ...node,
        data: {
          ...node.data,
          ...connected,
          _connectedSourceHandleIds: dedupeHandles(connected._connectedSourceHandleIds),
          _connectedTargetHandleIds: dedupeHandles(connected._connectedTargetHandleIds),
        },
      }
    })

    setNodes(updatedNodes)
    setEdges([...edges, ...newEdges])
    saveStateToHistory(WorkflowHistoryEvent.NodeAdd, { nodeId: newNodes[0].id })
    handleSyncWorkflowDraft()

    workflowStore.setState(state => ({
      ...state,
      showVibePanel: false,
      vibePanelMermaidCode: '',
    }))
  }, [
    createGraphFromBackendNodes,
    handleSyncWorkflowDraft,
    saveStateToHistory,
    store,
  ])

  const flowchartToWorkflowGraph = useCallback(async (mermaidCode: string): Promise<FlowGraph> => {
    const { getNodes } = store.getState()
    const nodes = getNodes()

    const parseResultToUse = parseMermaidFlowchart(mermaidCode, nodeTypeLookup, toolLookup)
    const emptyGraph = {
      nodes: [],
      edges: [],
    }
    if ('error' in parseResultToUse) {
      switch (parseResultToUse.error) {
        case 'missingNodeType':
        case 'missingNodeDefinition':
          Toast.notify({ type: 'error', message: t('workflow.vibe.invalidFlowchart') })
          return emptyGraph
        case 'unknownNodeId':
          Toast.notify({ type: 'error', message: t('workflow.vibe.unknownNodeId', { id: parseResultToUse.detail }) })
          return emptyGraph
        case 'unknownNodeType':
          Toast.notify({ type: 'error', message: t('workflow.vibe.nodeTypeUnavailable', { type: parseResultToUse.detail }) })
          return emptyGraph
        case 'unknownTool':
          Toast.notify({ type: 'error', message: t('workflow.vibe.toolUnavailable', { tool: parseResultToUse.detail }) })
          return emptyGraph
        case 'unsupportedEdgeLabel':
          Toast.notify({ type: 'error', message: t('workflow.vibe.unsupportedEdgeLabel', { label: parseResultToUse.detail }) })
          return emptyGraph
        default:
          Toast.notify({ type: 'error', message: t('workflow.vibe.invalidFlowchart') })
          return emptyGraph
      }
    }

    if (!nodesMetaDataMap) {
      Toast.notify({ type: 'error', message: t('workflow.vibe.nodesUnavailable') })
      return emptyGraph
    }

    const existingStartNode = nodes.find(node => node.data.type === BlockEnum.Start)
    const newNodes: Node[] = []
    const nodeIdMap = new Map<string, Node>()

    parseResultToUse.nodes.forEach((nodeSpec) => {
      if (nodeSpec.type === BlockEnum.Start && existingStartNode) {
        nodeIdMap.set(nodeSpec.id, existingStartNode)
        return
      }

      const nodeDefault = nodesMetaDataMap![nodeSpec.type]
      if (!nodeDefault)
        return

      const defaultValue = nodeDefault.defaultValue || {}
      const title = nodeSpec.title?.trim() || nodeDefault.metaData.title || defaultValue.title || nodeSpec.type

      const toolDefaultValue = nodeSpec.toolKey ? toolLookup.get(nodeSpec.toolKey) : undefined
      const desc = (toolDefaultValue?.tool_description || (defaultValue as { desc?: string }).desc || '') as string

      const data = {
        ...(defaultValue as Record<string, unknown>),
        title,
        desc,
        type: nodeSpec.type,
        selected: false,
        ...(toolDefaultValue || {}),
      }

      const newNode = generateNewNode({
        id: uuid4(),
        type: getNodeCustomTypeByNodeDataType(nodeSpec.type),
        data,
        position: { x: 0, y: 0 },
      }).newNode

      newNodes.push(newNode)
      nodeIdMap.set(nodeSpec.id, newNode)
    })

    if (!newNodes.length) {
      Toast.notify({ type: 'error', message: t('workflow.vibe.invalidFlowchart') })
      return emptyGraph
    }

    const buildEdge = (
      source: Node,
      target: Node,
      sourceHandle = 'source',
      targetHandle = 'target',
    ): Edge => ({
      id: `${source.id}-${sourceHandle}-${target.id}-${targetHandle}`,
      type: CUSTOM_EDGE,
      source: source.id,
      sourceHandle,
      target: target.id,
      targetHandle,
      data: {
        sourceType: source.data.type,
        targetType: target.data.type,
        isInIteration: false,
        isInLoop: false,
        _connectedNodeIsSelected: false,
      },
      zIndex: 0,
    })

    const newEdges: Edge[] = []
    for (const edgeSpec of parseResultToUse.edges) {
      const sourceNode = nodeIdMap.get(edgeSpec.sourceId)
      const targetNode = nodeIdMap.get(edgeSpec.targetId)
      if (!sourceNode || !targetNode)
        continue

      let sourceHandle = 'source'
      if (sourceNode.data.type === BlockEnum.IfElse) {
        const branchLabel = normalizeBranchLabel(edgeSpec.label)
        if (branchLabel === 'true') {
          sourceHandle = (sourceNode.data as { cases?: { case_id: string }[] })?.cases?.[0]?.case_id || 'true'
        }
        if (branchLabel === 'false') {
          sourceHandle = 'false'
        }
      }

      newEdges.push(buildEdge(sourceNode, targetNode, sourceHandle))
    }

    const bounds = nodes.reduce(
      (acc, node) => {
        const width = node.width ?? NODE_WIDTH
        acc.maxX = Math.max(acc.maxX, node.position.x + width)
        acc.minY = Math.min(acc.minY, node.position.y)
        return acc
      },
      { maxX: 0, minY: 0 },
    )

    const baseX = nodes.length ? bounds.maxX + NODE_WIDTH_X_OFFSET : 0
    const baseY = Number.isFinite(bounds.minY) ? bounds.minY : 0
    const branchOffset = Math.max(120, NODE_WIDTH_X_OFFSET / 2)

    const layoutNodeIds = new Set(newNodes.map(node => node.id))
    const layoutEdges = newEdges.filter(edge =>
      layoutNodeIds.has(edge.source) && layoutNodeIds.has(edge.target),
    )

    try {
      const layout = await getLayoutByDagre(newNodes, layoutEdges)
      const layoutedNodes = newNodes.map((node) => {
        const info = layout.nodes.get(node.id)
        if (!info)
          return node
        return {
          ...node,
          position: {
            x: baseX + info.x,
            y: baseY + info.y,
          },
        }
      })
      newNodes.splice(0, newNodes.length, ...layoutedNodes)
    }
    catch {
      newNodes.forEach((node, index) => {
        const row = Math.floor(index / 4)
        const col = index % 4
        node.position = {
          x: baseX + col * NODE_WIDTH_X_OFFSET,
          y: baseY + row * branchOffset,
        }
      })
    }

    const allNodes = [...nodes, ...newNodes]
    const nodesConnectedMap = getNodesConnectedSourceOrTargetHandleIdsMap(
      newEdges.map(edge => ({ type: 'add', edge })),
      allNodes,
    )

    const updatedNodes = allNodes.map((node) => {
      const connected = nodesConnectedMap[node.id]
      if (!connected)
        return node

      return {
        ...node,
        data: {
          ...node.data,
          ...connected,
          _connectedSourceHandleIds: dedupeHandles(connected._connectedSourceHandleIds),
          _connectedTargetHandleIds: dedupeHandles(connected._connectedTargetHandleIds),
        },
      }
    })
    return {
      nodes: updatedNodes,
      edges: newEdges,
    }
  }, [nodeTypeLookup, nodesMetaDataMap, store, t, toolLookup])

  const applyFlowchartToWorkflow = useCallback(() => {
    if (!currentFlowGraph || !currentFlowGraph.nodes || currentFlowGraph.nodes.length === 0) {
      Toast.notify({ type: 'error', message: t('workflow.vibe.invalidFlowchart') })
      return
    }

    const { setNodes, setEdges } = store.getState()
    const vibePanelPreviewNodes = currentFlowGraph.nodes || []
    const vibePanelPreviewEdges = currentFlowGraph.edges || []

    setNodes(vibePanelPreviewNodes)
    setEdges(vibePanelPreviewEdges)
    saveStateToHistory(WorkflowHistoryEvent.NodeAdd, { nodeId: vibePanelPreviewNodes[0].id })
    handleSyncWorkflowDraft(true, true)

    workflowStore.setState(state => ({
      ...state,
      showVibePanel: false,
      vibePanelMermaidCode: '',
    }))
  }, [
    currentFlowGraph,
    handleSyncWorkflowDraft,
    saveStateToHistory,
    store,
    t,
  ])

  const handleVibeCommand = useCallback(async (
    dsl?: string,
    skipPanelPreview = false,
    regenerateMode = false,
  ) => {
    if (getNodesReadOnly()) {
      Toast.notify({ type: 'error', message: t('workflow.vibe.readOnly') })
      return
    }

    const trimmed = dsl?.trim() || ''
    if (!trimmed) {
      Toast.notify({ type: 'error', message: t('workflow.vibe.missingInstruction') })
      return
    }

    if (!nodesMetaDataMap || Object.keys(nodesMetaDataMap).length === 0) {
      Toast.notify({ type: 'error', message: t('workflow.vibe.nodesUnavailable') })
      return
    }

    const latestModelConfig = getLatestModelConfig()
    if (!latestModelConfig && !isMermaidFlowchart(trimmed)) {
      Toast.notify({ type: 'error', message: t('workflow.vibe.modelUnavailable') })
      return
    }

    if (isGeneratingRef.current)
      return
    isGeneratingRef.current = true

    if (!isMermaidFlowchart(trimmed))
      lastInstructionRef.current = trimmed

    workflowStore.setState(state => ({
      ...state,
      showVibePanel: true,
      isVibeGenerating: true,
      vibePanelMermaidCode: '',
      vibePanelInstruction: trimmed,
      vibePanelIntent: '',
      vibePanelMessage: '',
      vibePanelSuggestions: [],
    }))

    try {
      const { getNodes } = store.getState()
      const nodes = getNodes()
      const {
        setIsVibeGenerating,
      } = workflowStore.getState()

      const existingNodesPayload = nodes.map(node => ({
        id: node.id,
        type: node.data.type,
        title: node.data.title || '',
      }))

      const toolsPayload = toolOptions.map(tool => ({
        provider_id: tool.provider_id,
        provider_name: tool.provider_name,
        provider_type: tool.provider_type,
        tool_name: tool.tool_name,
        tool_label: tool.tool_label,
        tool_key: `${tool.provider_id}/${tool.tool_name}`,
        tool_description: tool.tool_description,
        is_team_authorization: tool.is_team_authorization,
        // Include parameter schemas so backend can inform model how to use tools
        parameters: tool.paramSchemas,
        output_schema: tool.output_schema,
      }))

      const stream = await generateFlowchart({
        instruction: trimmed,
        model_config: latestModelConfig!,
        existing_nodes: existingNodesPayload,
        tools: toolsPayload,
        regenerate_mode: regenerateMode,
      })

      let mermaidCode = ''
      let backendNodes: BackendNodeSpec[] | undefined
      let backendEdges: BackendEdgeSpec[] | undefined

      const reader = stream.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done)
          break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: '))
            continue

          try {
            const data = JSON.parse(line.slice(6))
            if (data.event === 'message' || data.event === 'workflow_generated') {
              if (data.data?.text) {
                mermaidCode += data.data.text
                workflowStore.setState(state => ({
                  ...state,
                  vibePanelMermaidCode: mermaidCode,
                }))
              }
              if (data.data?.nodes) {
                backendNodes = data.data.nodes
                workflowStore.setState(state => ({
                  ...state,
                  vibePanelBackendNodes: backendNodes,
                }))
              }
              if (data.data?.edges) {
                backendEdges = data.data.edges
                workflowStore.setState(state => ({
                  ...state,
                  vibePanelBackendEdges: backendEdges,
                }))
              }
              if (data.data?.intent) {
                workflowStore.setState(state => ({
                  ...state,
                  vibePanelIntent: data.data.intent,
                }))
              }
              if (data.data?.message) {
                workflowStore.setState(state => ({
                  ...state,
                  vibePanelMessage: data.data.message,
                }))
              }
              if (data.data?.suggestions) {
                workflowStore.setState(state => ({
                  ...state,
                  vibePanelSuggestions: data.data.suggestions,
                }))
              }
            }
          }
          catch (e) {
            console.error('Error parsing chunk:', e)
          }
        }
      }

      setIsVibeGenerating(false)

      // Add version for preview
      if (backendNodes && backendNodes.length > 0 && backendEdges) {
        const graph = await createGraphFromBackendNodes(backendNodes, backendEdges)
        addVersion(graph)
      }
      else if (mermaidCode) {
        const graph = await flowchartToWorkflowGraph(mermaidCode)
        addVersion(graph)
      }

      if (skipPanelPreview) {
        // Prefer backend nodes (already sanitized) over mermaid re-parsing
        if (backendNodes && backendNodes.length > 0 && backendEdges) {
          await applyBackendNodesToWorkflow(backendNodes, backendEdges)
        }
        else {
          await applyFlowchartToWorkflow()
        }
      }
    }
    catch (error: unknown) {
      // Handle API errors (e.g., network errors, server errors)
      const { setIsVibeGenerating } = workflowStore.getState()
      setIsVibeGenerating(false)

      // Extract error message from Response object or Error
      let errorMessage = t('workflow.vibe.generateError')
      if (error instanceof Response) {
        try {
          const errorData = await error.json()
          errorMessage = errorData?.message || errorMessage
        }
        catch {
          // If we can't parse the response, use the default error message
        }
      }
      else if (error instanceof Error) {
        errorMessage = error.message || errorMessage
      }

      Toast.notify({ type: 'error', message: errorMessage })
    }
    finally {
      isGeneratingRef.current = false
    }
  }, [
    addVersion,
    applyBackendNodesToWorkflow,
    applyFlowchartToWorkflow,
    createGraphFromBackendNodes,
    flowchartToWorkflowGraph,
    getLatestModelConfig,
    getNodesReadOnly,
    nodeTypeLookup,
    nodesMetaDataMap,
    store,
    t,
    toolOptions,
  ])

  const handleRegenerate = useCallback(async () => {
    if (!lastInstructionRef.current) {
      Toast.notify({ type: 'error', message: t('workflow.vibe.missingInstruction') })
      return
    }

    // Pass regenerateMode=true to include previous workflow context
    await handleVibeCommand(lastInstructionRef.current, false, true)
  }, [handleVibeCommand, t])

  const handleAccept = useCallback(async (vibePanelMermaidCode: string | undefined) => {
    // Prefer backend nodes (already sanitized) over mermaid re-parsing
    const { vibePanelBackendNodes, vibePanelBackendEdges } = workflowStore.getState()
    if (vibePanelBackendNodes && vibePanelBackendNodes.length > 0 && vibePanelBackendEdges) {
      await applyBackendNodesToWorkflow(vibePanelBackendNodes, vibePanelBackendEdges)
    }
    else {
      // Use applyFlowchartToWorkflow which uses currentFlowGraph (populated by addVersion)
      applyFlowchartToWorkflow()
    }
  }, [applyBackendNodesToWorkflow, applyFlowchartToWorkflow])

  useEffect(() => {
    const handler = (event: CustomEvent<VibeCommandDetail>) => {
      handleVibeCommand(event.detail?.dsl, false)
    }

    const acceptHandler = () => {
      handleAccept(undefined)
    }

    document.addEventListener(VIBE_COMMAND_EVENT, handler as EventListener)
    document.addEventListener(VIBE_APPLY_EVENT, acceptHandler as EventListener)

    return () => {
      document.removeEventListener(VIBE_COMMAND_EVENT, handler as EventListener)
      document.removeEventListener(VIBE_APPLY_EVENT, acceptHandler as EventListener)
    }
  }, [handleVibeCommand, handleAccept])

  return null
}
