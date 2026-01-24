/* eslint-disable regexp/no-super-linear-backtracking */
import type { ToolDefaultValue } from '../../block-selector/types'
import type { Edge, Node, ToolWithProvider } from '../../types'
import type { ParsedEdge, ParsedNode, ParsedNodeDraft, ParseError, ParseResult } from './types'
import { basePath } from '@/utils/var'
import { CUSTOM_EDGE } from '../../constants'
import { BlockEnum } from '../../types'
import { correctFieldName, NODE_TYPE_ALIASES } from '../use-workflow-vibe-config'

export const NODE_DECLARATION = /^([A-Z][\w-]*)\s*\[(?:"([^"]+)"|([^\]]+))\]\s*$/i
export const EDGE_DECLARATION = /^(.+?)\s*-->\s*(?:\|([^|]+)\|\s*)?(.+)$/

export const extractMermaidCode = (raw: string) => {
  const fencedMatch = raw.match(/```(?:mermaid)?\s*([\s\S]*?)```/i)
  return (fencedMatch ? fencedMatch[1] : raw).trim()
}

export const isMermaidFlowchart = (value: string) => {
  const trimmed = value.trim().toLowerCase()
  return trimmed.startsWith('flowchart') || trimmed.startsWith('graph')
}

export const normalizeKey = (value: string) => value.trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

export const normalizeProviderIcon = (icon?: ToolWithProvider['icon']) => {
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
export const replaceVariableReferences = (
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
      // #region agent log
      if (!newNode && !['sys', 'env', 'conversation'].includes(potentialNodeId)) {
        // console.warn(`[VIBE DEBUG] replaceVariableReferences: No mapping for "${potentialNodeId}" in selector [${data.join(', ')}]`)
      }
      // #endregion
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

export const normalizeBranchLabel = (label?: string) => {
  if (!label)
    return ''
  const normalized = label.trim().toLowerCase()
  if (['true', 'yes', 'y', '1'].includes(normalized))
    return 'true'
  if (['false', 'no', 'n', '0'].includes(normalized))
    return 'false'
  return ''
}

export const parseMermaidFlowchart = (
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

export const dedupeHandles = (handles?: string[]) => {
  if (!handles)
    return handles
  return Array.from(new Set(handles))
}

export const buildToolParams = (parameters?: ToolWithProvider['tools'][number]['parameters']) => {
  const params: Record<string, string> = {}
  if (!parameters)
    return params
  parameters.forEach((item) => {
    params[item.name] = ''
  })
  return params
}

export const buildEdge = (
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
