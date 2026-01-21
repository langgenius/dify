import type { ReactFlowState } from 'reactflow'
import type { ToolParameter } from '@/app/components/tools/types'
import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
import type {
  CommonNodeType,
  PromptItem,
  PromptTemplateItem,
  Node as WorkflowNode,
} from '@/app/components/workflow/types'
import { useCallback, useMemo } from 'react'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { BlockEnum, EditionType, isPromptMessageContext, PromptRole, VarType } from '@/app/components/workflow/types'
import { generateNewNode, getNodeCustomTypeByNodeDataType, mergeNodeDefaultData } from '@/app/components/workflow/utils'
import { fetchMentionGraph } from '@/service/workflow'
import { FlowType } from '@/types/common'

// Constants

export const AGENT_CONTEXT_VAR_PATTERN = /\{\{@[^.@#]+\.context@\}\}/g
const AGENT_CONTEXT_VAR_PREFIX = '{{@'
const AGENT_CONTEXT_VAR_SUFFIX = '.context@}}'

export const getAgentNodeIdFromContextVar = (placeholder: string): string => {
  if (!placeholder.startsWith(AGENT_CONTEXT_VAR_PREFIX) || !placeholder.endsWith(AGENT_CONTEXT_VAR_SUFFIX))
    return ''
  return placeholder.slice(AGENT_CONTEXT_VAR_PREFIX.length, -AGENT_CONTEXT_VAR_SUFFIX.length)
}

export const buildAssemblePlaceholder = (toolNodeId?: string, paramKey?: string): string => {
  if (!toolNodeId || !paramKey)
    return ''
  return `{{#${toolNodeId}_ext_${paramKey}.result#}}`
}

const resolvePromptText = (item?: PromptItem): string => {
  if (!item)
    return ''
  if (item.edition_type === EditionType.jinja2)
    return item.jinja2_text || item.text || ''
  return item.text || ''
}

const getUserPromptText = (promptTemplate?: PromptTemplateItem[] | PromptItem): string => {
  if (!promptTemplate)
    return ''
  if (Array.isArray(promptTemplate)) {
    const userPrompt = promptTemplate.find(
      item => !isPromptMessageContext(item) && item.role === PromptRole.user,
    ) as PromptItem | undefined
    return resolvePromptText(userPrompt)
  }
  return resolvePromptText(promptTemplate)
}

const hasUserPromptTemplate = (promptTemplate: PromptTemplateItem[] | PromptItem): boolean => {
  if (!Array.isArray(promptTemplate))
    return true
  return promptTemplate.some(item => !isPromptMessageContext(item) && item.role === PromptRole.user)
}

const applyPromptText = (item: PromptItem, text: string): PromptItem => {
  if (item.edition_type === EditionType.jinja2) {
    return {
      ...item,
      text,
      jinja2_text: text,
    }
  }
  return {
    ...item,
    text,
  }
}

const buildPromptTemplateWithText = (
  promptTemplate: PromptTemplateItem[] | PromptItem,
  text: string,
): PromptTemplateItem[] | PromptItem => {
  if (!Array.isArray(promptTemplate))
    return applyPromptText(promptTemplate as PromptItem, text)

  const userIndex = promptTemplate.findIndex(
    item => !isPromptMessageContext(item) && item.role === PromptRole.user,
  )
  if (userIndex >= 0) {
    return promptTemplate.map((item, index) => {
      if (index !== userIndex || isPromptMessageContext(item))
        return item
      return applyPromptText(item as PromptItem, text)
    }) as PromptTemplateItem[]
  }

  const useJinja = promptTemplate.some(
    item => !isPromptMessageContext(item) && (item as PromptItem).edition_type === EditionType.jinja2,
  )
  const defaultUserPrompt: PromptItem = useJinja
    ? {
        role: PromptRole.user,
        text,
        jinja2_text: text,
        edition_type: EditionType.jinja2,
      }
    : { role: PromptRole.user, text }

  return [...promptTemplate, defaultUserPrompt] as PromptTemplateItem[]
}

type NodesMetaDataMap = Record<BlockEnum, {
  defaultValue?: Partial<LLMNodeType | CodeNodeType>
  checkValid?: (data: CommonNodeType, t: (key: string, options?: Record<string, unknown>) => string, moreData?: unknown) => { isValid: boolean, errorMessage?: string }
}>

type ConfigsMap = {
  flowId?: string
  flowType?: FlowType
}

type ExtractorNodePayload = {
  extractorNodeId: string
  nodeType: BlockEnum
  data: Partial<LLMNodeType | CodeNodeType>
}

export type DetectedAgent = {
  nodeId: string
  name: string
}

type ReactFlowStoreApi = {
  getState: () => ReactFlowState
}

export type UseMixedVariableExtractorOptions = {
  toolNodeId?: string
  paramKey: string
  language: string
  nodesById: Record<string, WorkflowNode>
  nodesMetaDataMap?: NodesMetaDataMap
  nodesDefaultConfigs?: Record<string, Partial<LLMNodeType | CodeNodeType>>
  reactFlowStore: ReactFlowStoreApi
  handleSyncWorkflowDraft: () => void
  configsMap?: ConfigsMap
}

export function useMixedVariableExtractor({
  toolNodeId,
  paramKey,
  language,
  nodesById,
  nodesMetaDataMap,
  nodesDefaultConfigs,
  reactFlowStore,
  handleSyncWorkflowDraft,
  configsMap,
}: UseMixedVariableExtractorOptions) {
  const assembleExtractorNodeId = useMemo(() => {
    if (!toolNodeId || !paramKey)
      return ''
    return `${toolNodeId}_ext_${paramKey}`
  }, [paramKey, toolNodeId])

  const resolveMentionParameterSchema = useCallback((key: string) => {
    if (!toolNodeId) {
      return {
        name: key,
        type: Type.string,
        description: '',
      }
    }
    const toolNodeData = nodesById[toolNodeId]?.data as { paramSchemas?: ToolParameter[] } | undefined
    const paramSchema = toolNodeData?.paramSchemas?.find(param => param.name === key)
    const description = paramSchema?.llm_description
      || paramSchema?.human_description?.[language]
      || paramSchema?.human_description?.en_US
      || ''
    return {
      name: paramSchema?.name || key,
      type: paramSchema?.type || Type.string,
      description,
    }
  }, [language, nodesById, toolNodeId])

  const ensureExtractorNode = useCallback((payload: ExtractorNodePayload) => {
    if (!toolNodeId)
      return null
    const metaDefault = nodesMetaDataMap?.[payload.nodeType]?.defaultValue as Partial<LLMNodeType | CodeNodeType> | undefined
    const appDefault = nodesDefaultConfigs?.[payload.nodeType] as Partial<LLMNodeType | CodeNodeType> | undefined
    if (!metaDefault && !appDefault)
      return null

    const { getNodes, setNodes } = reactFlowStore.getState()
    const currentNodes = getNodes()
    const existingNode = currentNodes.find(node => node.id === payload.extractorNodeId)
    const shouldReplace = existingNode && existingNode.data.type !== payload.nodeType
    if (!existingNode || shouldReplace) {
      const nextNodes = shouldReplace
        ? currentNodes.filter(node => node.id !== payload.extractorNodeId)
        : currentNodes
      const mergedData = mergeNodeDefaultData({
        nodeType: payload.nodeType,
        metaDefault,
        appDefault,
        overrideData: payload.data,
      })
      const resolvedTitle = mergedData.title ?? metaDefault?.title ?? appDefault?.title ?? ''
      const resolvedDesc = mergedData.desc ?? metaDefault?.desc ?? appDefault?.desc ?? ''
      const { newNode } = generateNewNode({
        id: payload.extractorNodeId,
        type: getNodeCustomTypeByNodeDataType(payload.nodeType),
        data: {
          ...mergedData,
          type: payload.nodeType,
          title: resolvedTitle,
          desc: resolvedDesc,
          parent_node_id: toolNodeId,
        },
        position: {
          x: 0,
          y: 0,
        },
        hidden: true,
      })
      setNodes([...nextNodes, newNode])
      handleSyncWorkflowDraft()
      return newNode
    }

    return existingNode
  }, [handleSyncWorkflowDraft, nodesDefaultConfigs, nodesMetaDataMap, reactFlowStore, toolNodeId])

  const ensureAssembleExtractorNode = useCallback(() => {
    if (!assembleExtractorNodeId)
      return ''
    const extractorNode = ensureExtractorNode({
      extractorNodeId: assembleExtractorNodeId,
      nodeType: BlockEnum.Code,
      data: {
        outputs: {
          result: {
            type: VarType.string,
            children: null,
          },
        },
      },
    })
    if (!extractorNode)
      return ''
    if (extractorNode.data.type !== BlockEnum.Code)
      return assembleExtractorNodeId

    const outputs = (extractorNode.data as CodeNodeType).outputs || {}
    const resultOutput = outputs.result
    if (!resultOutput || resultOutput.type !== VarType.string) {
      const { getNodes, setNodes } = reactFlowStore.getState()
      const currentNodes = getNodes()
      const nextOutputs = {
        ...outputs,
        result: {
          type: VarType.string,
          children: null,
        },
      }
      setNodes(currentNodes.map((node) => {
        if (node.id !== assembleExtractorNodeId)
          return node
        return {
          ...node,
          data: {
            ...node.data,
            outputs: nextOutputs,
          },
        }
      }))
      handleSyncWorkflowDraft()
    }

    return assembleExtractorNodeId
  }, [assembleExtractorNodeId, ensureExtractorNode, handleSyncWorkflowDraft, reactFlowStore])

  const removeExtractorNode = useCallback(() => {
    if (!toolNodeId || !paramKey)
      return

    const extractorNodeId = `${toolNodeId}_ext_${paramKey}`
    const { getNodes, setNodes } = reactFlowStore.getState()
    const nodes = getNodes()
    const hasExtractorNode = nodes.some(node => node.id === extractorNodeId)
    if (!hasExtractorNode)
      return

    setNodes(nodes.filter(node => node.id !== extractorNodeId))
    handleSyncWorkflowDraft()
  }, [handleSyncWorkflowDraft, paramKey, reactFlowStore, toolNodeId])

  const syncExtractorPromptFromText = useCallback((
    text: string,
    detectAgentFromText: (text: string) => DetectedAgent | null,
  ) => {
    if (!toolNodeId || !paramKey)
      return

    const detectedAgent = detectAgentFromText(text)
    if (!detectedAgent)
      return

    const escapedAgentId = detectedAgent.nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const leadingPattern = new RegExp(`^\\{\\{@${escapedAgentId}\\.context@\\}\\}`)
    const promptText = text.replace(leadingPattern, '')

    const extractorNodeId = `${toolNodeId}_ext_${paramKey}`
    const { getNodes, setNodes } = reactFlowStore.getState()
    const nodes = getNodes()
    const extractorNode = nodes.find(node => node.id === extractorNodeId) as WorkflowNode<LLMNodeType> | undefined
    if (!extractorNode?.data?.prompt_template)
      return

    const currentPromptText = getUserPromptText(extractorNode.data.prompt_template)
    const shouldUpdate = !hasUserPromptTemplate(extractorNode.data.prompt_template)
      || currentPromptText !== promptText
    if (!shouldUpdate)
      return

    const nextPromptTemplate = buildPromptTemplateWithText(extractorNode.data.prompt_template, promptText)
    const nextNodes = nodes.map((node) => {
      if (node.id !== extractorNodeId)
        return node
      return {
        ...node,
        data: {
          ...node.data,
          prompt_template: nextPromptTemplate,
        },
      }
    })
    setNodes(nextNodes)
    handleSyncWorkflowDraft()
  }, [handleSyncWorkflowDraft, paramKey, reactFlowStore, toolNodeId])

  const applyMentionGraphNodeData = useCallback((payload: {
    extractorNodeId: string
    mentionNodeData: Partial<LLMNodeType>
    valueText: string
    detectAgentFromText: (text: string) => DetectedAgent | null
  }) => {
    const { extractorNodeId, mentionNodeData, valueText, detectAgentFromText } = payload
    if (!toolNodeId)
      return
    const hasPromptTemplate = Array.isArray(mentionNodeData.prompt_template)
      ? mentionNodeData.prompt_template.length > 0
      : Boolean(mentionNodeData.prompt_template)
    const nextData: Partial<LLMNodeType> = {}
    if (mentionNodeData.title)
      nextData.title = mentionNodeData.title
    if (mentionNodeData.desc)
      nextData.desc = mentionNodeData.desc
    if (mentionNodeData.model && (mentionNodeData.model.provider || mentionNodeData.model.name))
      nextData.model = mentionNodeData.model
    if (hasPromptTemplate)
      nextData.prompt_template = mentionNodeData.prompt_template
    if (typeof mentionNodeData.structured_output_enabled === 'boolean')
      nextData.structured_output_enabled = mentionNodeData.structured_output_enabled
    if (mentionNodeData.structured_output?.schema)
      nextData.structured_output = mentionNodeData.structured_output
    if (mentionNodeData.context)
      nextData.context = mentionNodeData.context
    if (mentionNodeData.vision)
      nextData.vision = mentionNodeData.vision
    if (Object.prototype.hasOwnProperty.call(mentionNodeData, 'memory'))
      nextData.memory = mentionNodeData.memory

    if (Object.keys(nextData).length === 0)
      return

    const { getNodes, setNodes } = reactFlowStore.getState()
    const currentNodes = getNodes()
    const hasExtractorNode = currentNodes.some(node => node.id === extractorNodeId)
    if (!hasExtractorNode)
      return

    const nextNodes = currentNodes.map((node) => {
      if (node.id !== extractorNodeId)
        return node
      return {
        ...node,
        data: {
          ...node.data,
          ...nextData,
          type: BlockEnum.LLM,
          parent_node_id: toolNodeId,
        },
      }
    })
    setNodes(nextNodes)
    handleSyncWorkflowDraft()
    syncExtractorPromptFromText(valueText, detectAgentFromText)
  }, [handleSyncWorkflowDraft, reactFlowStore, syncExtractorPromptFromText, toolNodeId])

  const requestMentionGraph = useCallback(async (payload: {
    agentId: string
    extractorNodeId: string
    valueText: string
    detectAgentFromText: (text: string) => DetectedAgent | null
  }) => {
    if (!toolNodeId || !paramKey)
      return
    if (!configsMap?.flowId || configsMap.flowType !== FlowType.appFlow)
      return
    const parameterSchema = resolveMentionParameterSchema(paramKey)
    try {
      const response = await fetchMentionGraph(configsMap.flowType, configsMap.flowId, {
        parent_node_id: toolNodeId,
        parameter_key: paramKey,
        context_source: [payload.agentId, 'context'],
        parameter_schema: parameterSchema,
      })
      const mentionNode = response?.graph?.nodes?.find(node => node.id === payload.extractorNodeId)
      const mentionNodeData = mentionNode?.data as Partial<LLMNodeType> | undefined
      if (!mentionNodeData)
        return
      applyMentionGraphNodeData({
        extractorNodeId: payload.extractorNodeId,
        mentionNodeData,
        valueText: payload.valueText,
        detectAgentFromText: payload.detectAgentFromText,
      })
    }
    catch {
    }
  }, [applyMentionGraphNodeData, configsMap?.flowId, configsMap?.flowType, paramKey, resolveMentionParameterSchema, toolNodeId])

  return {
    assembleExtractorNodeId,
    ensureExtractorNode,
    ensureAssembleExtractorNode,
    removeExtractorNode,
    syncExtractorPromptFromText,
    requestMentionGraph,
  }
}
