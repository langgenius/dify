import type { Node } from '@/app/components/workflow/types'
import type { NodeWithVar, VarInInspect } from '@/types/workflow'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { AGENT_CONTEXT_VAR_PATTERN, getAgentNodeIdFromContextVar } from '@/app/components/workflow/utils/agent-context'
import { VarInInspectType } from '@/types/workflow'

const buildAliasVarId = (mapping: AgentAliasMapping) => {
  const outputPath = mapping.outputSelector.join('.')
  return `alias:${mapping.parentNodeId}:${mapping.extractorNodeId}:${outputPath}`
}

type AgentAliasMapping = {
  parentNodeId: string
  extractorNodeId: string
  outputSelector: string[]
  aliasName: string
}

type ToolParameterShape = {
  value?: unknown
  nested_node_config?: {
    extractor_node_id?: string
    output_selector?: unknown
  }
}

type ToolNodeDataShape = {
  tool_parameters?: Record<string, ToolParameterShape>
}

type AliasSource = {
  sourceVar: VarInInspect
  matchedSelector: string[]
  resolvedValue: unknown
  resolvedValueFound: boolean
  usedFallback: boolean
}

const toSelectorKey = (selector: string[]) => selector.join('.')

const resolveOutputSelector = (extractorNodeId: string, rawSelector?: unknown): string[] => {
  if (!Array.isArray(rawSelector))
    return []
  if (rawSelector[0] === extractorNodeId)
    return rawSelector.slice(1)
  return rawSelector as string[]
}

const collectAgentAliasMappings = (nodes: Node[]) => {
  const nodesById = new Map(nodes.map(node => [node.id, node]))
  const mappings: AgentAliasMapping[] = []
  const extractorNodeIds = new Set<string>()

  nodes.forEach((node) => {
    if (node.data.type !== BlockEnum.Tool)
      return
    const toolData = node.data as ToolNodeDataShape
    const toolParams = toolData.tool_parameters || {}
    Object.entries(toolParams).forEach(([paramKey, param]) => {
      const value = param?.value
      if (typeof value !== 'string')
        return
      const matches = Array.from(value.matchAll(AGENT_CONTEXT_VAR_PATTERN))
      if (!matches.length)
        return
      const agentNodeId = getAgentNodeIdFromContextVar(matches[0][0])
      if (!agentNodeId)
        return
      const extractorNodeId = param?.nested_node_config?.extractor_node_id || `${node.id}_ext_${paramKey}`
      extractorNodeIds.add(extractorNodeId)
      const resolvedOutputSelector = resolveOutputSelector(extractorNodeId, param?.nested_node_config?.output_selector)
      const outputSelector = resolvedOutputSelector.length > 0
        ? resolvedOutputSelector
        : ['structured_output', paramKey]
      const agentNode = nodesById.get(agentNodeId)
      const aliasName = `@${agentNode?.data.title || agentNodeId}`

      mappings.push({
        parentNodeId: node.id,
        extractorNodeId,
        outputSelector,
        aliasName,
      })
    })
  })

  return { mappings, extractorNodeIds, nodesById }
}

const findAliasSourceVar = (vars: VarInInspect[], extractorNodeId: string, outputSelector: string[]) => {
  const selectorKey = toSelectorKey(outputSelector)
  return vars.find((varItem) => {
    const selector = Array.isArray(varItem.selector) ? varItem.selector : []
    if (selector[0] !== extractorNodeId)
      return false
    return toSelectorKey(selector.slice(1)) === selectorKey
  })
}

const resolveNestedValue = (value: unknown, path: string[]): { found: boolean, value: unknown } => {
  let current: unknown = value
  for (const key of path) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(key, 10)
      if (!Number.isNaN(index) && index >= 0 && index < current.length) {
        current = current[index]
        continue
      }
      return { found: false, value: undefined }
    }
    if (current && typeof current === 'object') {
      if (Object.prototype.hasOwnProperty.call(current, key)) {
        current = (current as Record<string, unknown>)[key]
        continue
      }
    }
    return { found: false, value: undefined }
  }
  return { found: true, value: current }
}

const resolveAliasSourceVar = (
  vars: VarInInspect[],
  extractorNodeId: string,
  outputSelector: string[],
): AliasSource | undefined => {
  const directMatch = findAliasSourceVar(vars, extractorNodeId, outputSelector)
  if (directMatch) {
    return {
      sourceVar: directMatch,
      matchedSelector: directMatch.selector as string[],
      resolvedValue: directMatch.value,
      resolvedValueFound: true,
      usedFallback: false,
    }
  }
  if (outputSelector.length === 0)
    return undefined
  const prefixKey = outputSelector[0]
  const prefixVar = vars.find((varItem) => {
    const selector = Array.isArray(varItem.selector) ? varItem.selector : []
    if (selector[0] !== extractorNodeId)
      return false
    return selector[1] === prefixKey && selector.length === 2
  })
  if (!prefixVar)
    return undefined
  if (outputSelector.length === 1) {
    return {
      sourceVar: prefixVar,
      matchedSelector: prefixVar.selector as string[],
      resolvedValue: prefixVar.value,
      resolvedValueFound: true,
      usedFallback: true,
    }
  }
  const resolved = resolveNestedValue(prefixVar.value, outputSelector.slice(1))
  return {
    sourceVar: prefixVar,
    matchedSelector: prefixVar.selector as string[],
    resolvedValue: resolved.value,
    resolvedValueFound: resolved.found,
    usedFallback: true,
  }
}

export const applyAgentSubgraphInspectVars = (nodesWithInspectVars: NodeWithVar[], allNodes: Node[]) => {
  const hideExtractorNodes = true
  const { mappings, extractorNodeIds, nodesById } = collectAgentAliasMappings(allNodes)
  if (mappings.length === 0 && extractorNodeIds.size === 0) {
    return nodesWithInspectVars
  }

  const resultMap = new Map<string, NodeWithVar>()
  nodesWithInspectVars.forEach((node) => {
    const isExtractorNode = extractorNodeIds.has(node.nodeId)
    resultMap.set(node.nodeId, {
      ...node,
      vars: [...node.vars],
      isHidden: hideExtractorNodes && isExtractorNode,
    })
  })

  const getOrCreateParentNode = (parentNodeId: string): NodeWithVar | undefined => {
    const existing = resultMap.get(parentNodeId)
    if (existing)
      return existing
    const parentNode = nodesById.get(parentNodeId)
    if (!parentNode)
      return undefined
    return {
      nodeId: parentNode.id,
      nodeType: parentNode.data.type,
      title: parentNode.data.title,
      nodePayload: parentNode.data,
      vars: [] as VarInInspect[],
      isValueFetched: false,
      isHidden: false,
    }
  }

  mappings.forEach((mapping) => {
    const parent = getOrCreateParentNode(mapping.parentNodeId)
    if (!parent)
      return
    const parentVars = parent.vars as VarInInspect[]
    const aliasId = buildAliasVarId(mapping)
    const upsertAliasVar = (aliasVar: VarInInspect, shouldOverwrite: boolean) => {
      const existingIndex = parentVars.findIndex(varItem => varItem.id === aliasVar.id)
      if (existingIndex === -1)
        parentVars.unshift(aliasVar)
      else if (shouldOverwrite)
        parentVars[existingIndex] = { ...parentVars[existingIndex], ...aliasVar }
    }
    const placeholderAliasVar: VarInInspect = {
      id: aliasId,
      type: VarInInspectType.node,
      name: mapping.aliasName,
      description: '',
      selector: [mapping.parentNodeId, mapping.aliasName],
      value_type: VarType.any,
      value: undefined,
      edited: false,
      visible: true,
      is_truncated: false,
      full_content: { size_bytes: 0, download_url: '' },
      aliasMeta: {
        extractorNodeId: mapping.extractorNodeId,
        outputSelector: mapping.outputSelector,
        sourceVarId: aliasId,
      },
    }
    const extractorGroup = nodesWithInspectVars.find(node => node.nodeId === mapping.extractorNodeId)
    if (!extractorGroup?.vars?.length) {
      upsertAliasVar(placeholderAliasVar, false)
      resultMap.set(mapping.parentNodeId, parent)
      return
    }
    const resolved = resolveAliasSourceVar(extractorGroup.vars, mapping.extractorNodeId, mapping.outputSelector)
    if (!resolved) {
      upsertAliasVar(placeholderAliasVar, false)
      resultMap.set(mapping.parentNodeId, parent)
      return
    }
    const resolvedValue = resolved.resolvedValueFound ? resolved.resolvedValue : resolved.sourceVar.value
    const aliasVar: VarInInspect = {
      ...resolved.sourceVar,
      id: aliasId,
      name: mapping.aliasName,
      selector: [mapping.parentNodeId, mapping.aliasName],
      value: resolvedValue,
      visible: true,
      aliasMeta: {
        extractorNodeId: mapping.extractorNodeId,
        outputSelector: mapping.outputSelector,
        sourceVarId: resolved.sourceVar.id,
      },
    }
    upsertAliasVar(aliasVar, true)
    resultMap.set(mapping.parentNodeId, parent)
  })

  // TODO: handle assemble sub-graph output mapping.
  return Array.from(resultMap.values())
}
