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

const parseNodeLabel = (label: string) => {
  const tokens = label.split('|').map(token => token.trim()).filter(Boolean)
  const info: Record<string, string> = {}

  tokens.forEach((token) => {
    const [rawKey, ...rest] = token.split('=')
    if (!rawKey || rest.length === 0)
      return
    info[rawKey.trim().toLowerCase()] = rest.join('=').trim()
  })

  if (!info.type && tokens.length === 1 && !tokens[0].includes('=')) {
    info.type = tokens[0]
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
  const { defaultModel } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)

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
      const primaryKey = normalizeKey(`${tool.provider_id}/${tool.tool_name}`)
      map.set(primaryKey, tool)

      const providerNameKey = normalizeKey(`${tool.provider_name}/${tool.tool_name}`)
      map.set(providerNameKey, tool)

      const labelKey = normalizeKey(tool.tool_label)
      map.set(labelKey, tool)
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
  }, [nodeTypeLookup, toolLookup])

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
    handleSyncWorkflowDraft()

    workflowStore.setState(state => ({
      ...state,
      showVibePanel: false,
      vibePanelMermaidCode: '',
    }))
  }, [
    currentFlowGraph,
    handleSyncWorkflowDraft,
    nodeTypeLookup,
    nodesMetaDataMap,
    saveStateToHistory,
    store,
    t,
    toolLookup,
  ])

  const handleVibeCommand = useCallback(async (dsl?: string, skipPanelPreview = false) => {
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
      }))

      const availableNodesPayload = availableNodesList.map(node => ({
        type: node.type,
        title: node.title,
        description: node.description,
      }))

      let mermaidCode = trimmed
      if (!isMermaidFlowchart(trimmed)) {
        const { error, flowchart } = await generateFlowchart({
          instruction: trimmed,
          model_config: latestModelConfig,
          available_nodes: availableNodesPayload,
          existing_nodes: existingNodesPayload,
          available_tools: toolsPayload,
        })

        if (error) {
          Toast.notify({ type: 'error', message: error })
          setIsVibeGenerating(false)
          return
        }

        if (!flowchart) {
          Toast.notify({ type: 'error', message: t('workflow.vibe.missingFlowchart') })
          setIsVibeGenerating(false)
          return
        }

        mermaidCode = flowchart
      }

      workflowStore.setState(state => ({
        ...state,
        vibePanelMermaidCode: mermaidCode,
        isVibeGenerating: false,
      }))

      const workflowGraph = await flowchartToWorkflowGraph(mermaidCode)
      addVersion(workflowGraph)

      if (skipPanelPreview)
        applyFlowchartToWorkflow()
    }
    finally {
      isGeneratingRef.current = false
    }
  }, [
    availableNodesList,
    getNodesReadOnly,
    handleSyncWorkflowDraft,
    nodeTypeLookup,
    nodesMetaDataMap,
    saveStateToHistory,
    store,
    t,
    toolLookup,
    toolOptions,
    getLatestModelConfig,
  ])

  const handleAccept = useCallback(() => {
    applyFlowchartToWorkflow()
  }, [applyFlowchartToWorkflow])

  useEffect(() => {
    const handler = (event: CustomEvent<VibeCommandDetail>) => {
      handleVibeCommand(event.detail?.dsl, false)
    }

    const acceptHandler = () => {
      handleAccept()
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
