import type { AgentNode, WorkflowVariableBlockType } from '@/app/components/base/prompt-editor/types'
import type { StrategyDetail, StrategyPluginDetail } from '@/app/components/plugins/types'
import type { MentionConfig, VarKindType } from '@/app/components/workflow/nodes/_base/types'
import type { AgentNodeType } from '@/app/components/workflow/nodes/agent/types'
import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
import type {
  CommonNodeType,
  NodeOutPutVar,
  PromptItem,
  PromptTemplateItem,
  ValueSelector,
  Node as WorkflowNode,
} from '@/app/components/workflow/types'
import {
  memo,
  useCallback,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNodes, useStoreApi } from 'reactflow'
import PromptEditor from '@/app/components/base/prompt-editor'
import { useNodesMetaData, useNodesSyncDraft } from '@/app/components/workflow/hooks'
import { VarKindType as VarKindTypeEnum } from '@/app/components/workflow/nodes/_base/types'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum, EditionType, isPromptMessageContext, PromptRole, VarType } from '@/app/components/workflow/types'
import { generateNewNode, getNodeCustomTypeByNodeDataType, mergeNodeDefaultData } from '@/app/components/workflow/utils'
import { useGetLanguage } from '@/context/i18n'
import { useStrategyProviders } from '@/service/use-strategy'
import { cn } from '@/utils/classnames'
import SubGraphModal from '../sub-graph-modal'
import AgentHeaderBar from './agent-header-bar'
import Placeholder from './placeholder'

/**
 * Matches agent context variable syntax: {{@nodeId.context@}}
 * Example: {{@agent-123.context@}}
 */
const AGENT_CONTEXT_VAR_PATTERN = /\{\{@[^.@#]+\.context@\}\}/g
const AGENT_CONTEXT_VAR_PREFIX = '{{@'
const AGENT_CONTEXT_VAR_SUFFIX = '.context@}}'
const getAgentNodeIdFromContextVar = (placeholder: string) => {
  if (!placeholder.startsWith(AGENT_CONTEXT_VAR_PREFIX) || !placeholder.endsWith(AGENT_CONTEXT_VAR_SUFFIX))
    return ''
  return placeholder.slice(AGENT_CONTEXT_VAR_PREFIX.length, -AGENT_CONTEXT_VAR_SUFFIX.length)
}

const buildAssemblePlaceholder = (toolNodeId?: string, paramKey?: string) => {
  if (!toolNodeId || !paramKey)
    return ''
  return `{{#${toolNodeId}_ext_${paramKey}.result#}}`
}
const DEFAULT_MENTION_CONFIG: MentionConfig = {
  extractor_node_id: '',
  output_selector: [],
  null_strategy: 'use_default',
  default_value: '',
}
type AgentCheckValidContext = {
  provider?: StrategyPluginDetail
  strategy?: StrategyDetail
  language: string
  isReadyForCheckValid: boolean
}

type WorkflowNodesMap = NonNullable<WorkflowVariableBlockType['workflowNodesMap']>

const resolvePromptText = (item?: PromptItem) => {
  if (!item)
    return ''
  if (item.edition_type === EditionType.jinja2)
    return item.jinja2_text || item.text || ''
  return item.text || ''
}

const getUserPromptText = (promptTemplate?: PromptTemplateItem[] | PromptItem) => {
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

const hasUserPromptTemplate = (promptTemplate: PromptTemplateItem[] | PromptItem) => {
  if (!Array.isArray(promptTemplate))
    return true
  return promptTemplate.some(item => !isPromptMessageContext(item) && item.role === PromptRole.user)
}

const applyPromptText = (item: PromptItem, text: string) => {
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

const buildPromptTemplateWithText = (promptTemplate: PromptTemplateItem[] | PromptItem, text: string) => {
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

type MixedVariableTextInputProps = {
  readOnly?: boolean
  nodesOutputVars?: NodeOutPutVar[]
  availableNodes?: WorkflowNode[]
  value?: string
  onChange?: (text: string, type?: VarKindType, mentionConfig?: MentionConfig | null) => void
  showManageInputField?: boolean
  onManageInputField?: () => void
  disableVariableInsertion?: boolean
  toolNodeId?: string
  paramKey?: string
}

const MixedVariableTextInput = ({
  readOnly = false,
  nodesOutputVars,
  availableNodes = [],
  value = '',
  onChange,
  showManageInputField,
  onManageInputField,
  disableVariableInsertion = false,
  toolNodeId,
  paramKey = '',
}: MixedVariableTextInputProps) => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const { data: strategyProviders } = useStrategyProviders()
  const reactFlowStore = useStoreApi()
  const nodes = useNodes<CommonNodeType>()
  const controlPromptEditorRerenderKey = useStore(s => s.controlPromptEditorRerenderKey)
  const setControlPromptEditorRerenderKey = useStore(s => s.setControlPromptEditorRerenderKey)
  const nodesDefaultConfigs = useStore(s => s.nodesDefaultConfigs)
  const { nodesMap: nodesMetaDataMap } = useNodesMetaData()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const [isSubGraphModalOpen, setIsSubGraphModalOpen] = useState(false)

  const nodesByIdMap = useMemo(() => {
    return availableNodes.reduce((acc, node) => {
      acc[node.id] = node
      return acc
    }, {} as Record<string, WorkflowNode>)
  }, [availableNodes])

  const assemblePlaceholder = useMemo(() => {
    return buildAssemblePlaceholder(toolNodeId, paramKey)
  }, [paramKey, toolNodeId])

  const isAssembleValue = useMemo(() => {
    if (!assemblePlaceholder)
      return false
    return value.includes(assemblePlaceholder)
  }, [assemblePlaceholder, value])

  const contextNodeIds = useMemo(() => {
    const ids = new Set<string>()
    availableNodes.forEach((node) => {
      if (node.data.type === BlockEnum.Agent || node.data.type === BlockEnum.LLM)
        ids.add(node.id)
    })
    return ids
  }, [availableNodes])

  const nodesById = useMemo(() => {
    return nodes.reduce((acc, node) => {
      acc[node.id] = node
      return acc
    }, {} as Record<string, WorkflowNode>)
  }, [nodes])

  const assembleExtractorNodeId = useMemo(() => {
    if (!toolNodeId || !paramKey)
      return ''
    return `${toolNodeId}_ext_${paramKey}`
  }, [paramKey, toolNodeId])

  const ensureExtractorNode = useCallback((payload: {
    extractorNodeId: string
    nodeType: BlockEnum
    data: Partial<LLMNodeType | CodeNodeType>
  }) => {
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

  type DetectedAgent = {
    nodeId: string
    name: string
  }

  const detectAgentFromText = useCallback((text: string): DetectedAgent | null => {
    if (!text)
      return null

    const matches = text.matchAll(AGENT_CONTEXT_VAR_PATTERN)
    for (const match of matches) {
      const nodeId = getAgentNodeIdFromContextVar(match[0])
      if (!nodeId)
        continue
      const node = nodesByIdMap[nodeId]
      if (node && contextNodeIds.has(nodeId)) {
        return {
          nodeId,
          name: node.data.title,
        }
      }
    }
    return null
  }, [contextNodeIds, nodesByIdMap])

  const detectedAgentFromValue: DetectedAgent | null = useMemo(() => {
    return detectAgentFromText(value)
  }, [detectAgentFromText, value])

  // Check if value only contains agent context variable without other user input
  const isOnlyAgentContext = useMemo(() => {
    if (!detectedAgentFromValue || !value)
      return false
    const valueWithoutAgentContext = value.replace(AGENT_CONTEXT_VAR_PATTERN, '').trim()
    return valueWithoutAgentContext === ''
  }, [detectedAgentFromValue, value])

  const agentNodes = useMemo(() => {
    if (!contextNodeIds.size)
      return []
    return availableNodes
      .filter(node => contextNodeIds.has(node.id))
      .map(node => ({
        id: node.id,
        title: node.data.title,
      }))
  }, [availableNodes, contextNodeIds])

  const workflowNodesMap = useMemo<WorkflowNodesMap>(() => {
    const acc: WorkflowNodesMap = {}
    availableNodes.forEach((node) => {
      acc[node.id] = {
        title: node.data.title,
        type: node.data.type,
        height: node.data.height,
        width: node.data.width,
        position: node.data.position,
      }
      if (node.data.type === BlockEnum.Start) {
        acc.sys = {
          title: t('blocks.start', { ns: 'workflow' }),
          type: BlockEnum.Start,
          height: node.data.height,
          width: node.data.width,
          position: node.data.position,
        }
      }
    })
    return acc
  }, [availableNodes, t])

  const getNodeWarning = useCallback((node?: WorkflowNode) => {
    if (!node)
      return true
    const validator = nodesMetaDataMap?.[node.data.type as BlockEnum]?.checkValid
    if (!validator)
      return false
    let moreDataForCheckValid: AgentCheckValidContext | undefined
    if (node.data.type === BlockEnum.Agent) {
      const agentData = node.data as AgentNodeType
      const isReadyForCheckValid = !!strategyProviders
      const provider = strategyProviders?.find(provider => provider.declaration.identity.name === agentData.agent_strategy_provider_name)
      const strategy = provider?.declaration.strategies?.find(s => s.identity.name === agentData.agent_strategy_name)
      moreDataForCheckValid = {
        provider,
        strategy,
        language,
        isReadyForCheckValid,
      }
    }
    const { errorMessage } = validator(node.data, t, moreDataForCheckValid)
    return Boolean(errorMessage)
  }, [language, nodesMetaDataMap, strategyProviders, t])

  const hasAgentWarning = useMemo(() => {
    if (!detectedAgentFromValue)
      return false
    const agentWarning = getNodeWarning(nodesById[detectedAgentFromValue.nodeId])
    if (!toolNodeId || !paramKey)
      return agentWarning
    const extractorNodeId = `${toolNodeId}_ext_${paramKey}`
    const extractorWarning = getNodeWarning(nodesById[extractorNodeId])
    return agentWarning || extractorWarning
  }, [detectedAgentFromValue, getNodeWarning, nodesById, paramKey, toolNodeId])

  const hasAssembleWarning = useMemo(() => {
    if (!isAssembleValue || !assembleExtractorNodeId)
      return false
    return getNodeWarning(nodesById[assembleExtractorNodeId])
  }, [assembleExtractorNodeId, getNodeWarning, isAssembleValue, nodesById])

  const syncExtractorPromptFromText = useCallback((text: string) => {
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
  }, [detectAgentFromText, handleSyncWorkflowDraft, paramKey, reactFlowStore, toolNodeId])

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

  const handleAgentRemove = useCallback(() => {
    const agentNodeId = detectedAgentFromValue?.nodeId
    if (!agentNodeId || !onChange)
      return

    const valueWithoutAgentVars = value.replace(AGENT_CONTEXT_VAR_PATTERN, (match) => {
      const nodeId = getAgentNodeIdFromContextVar(match)
      return nodeId === agentNodeId ? '' : match
    })

    removeExtractorNode()
    onChange(valueWithoutAgentVars, VarKindTypeEnum.mixed, null)
    setControlPromptEditorRerenderKey(Date.now())
  }, [detectedAgentFromValue?.nodeId, onChange, removeExtractorNode, setControlPromptEditorRerenderKey, value])

  const handleAgentSelect = useCallback((agent: AgentNode) => {
    if (!onChange)
      return

    const valueWithoutTrigger = value.replace(/@$/, '')
    const newValue = `{{@${agent.id}.context@}}${valueWithoutTrigger}`

    if (toolNodeId && paramKey) {
      ensureExtractorNode({
        extractorNodeId: `${toolNodeId}_ext_${paramKey}`,
        nodeType: BlockEnum.LLM,
        data: {
          structured_output_enabled: true,
          structured_output: {
            schema: {
              type: Type.object,
              properties: {
                [paramKey]: {
                  type: Type.string,
                },
              },
              required: [paramKey],
              additionalProperties: false,
            },
          },
        },
      })
    }

    const mentionConfigWithOutputSelector: MentionConfig = {
      ...DEFAULT_MENTION_CONFIG,
      extractor_node_id: toolNodeId && paramKey ? `${toolNodeId}_ext_${paramKey}` : '',
      output_selector: paramKey ? ['structured_output', paramKey] : [],
    }
    onChange(newValue, VarKindTypeEnum.mention, mentionConfigWithOutputSelector)
    syncExtractorPromptFromText(newValue)
    setControlPromptEditorRerenderKey(Date.now())
  }, [ensureExtractorNode, onChange, paramKey, setControlPromptEditorRerenderKey, syncExtractorPromptFromText, toolNodeId, value])

  const handleAssembleSelect = useCallback((): ValueSelector | null => {
    if (!toolNodeId || !paramKey || !assemblePlaceholder)
      return null
    const extractorNodeId = assembleExtractorNodeId || `${toolNodeId}_ext_${paramKey}`
    ensureAssembleExtractorNode()
    onChange?.(assemblePlaceholder, VarKindTypeEnum.mixed, null)
    setControlPromptEditorRerenderKey(Date.now())
    return [extractorNodeId, 'result']
  }, [assembleExtractorNodeId, assemblePlaceholder, ensureAssembleExtractorNode, onChange, paramKey, setControlPromptEditorRerenderKey, toolNodeId])

  const handleAssembleRemove = useCallback(() => {
    if (!onChange || !assemblePlaceholder)
      return

    removeExtractorNode()
    onChange('', VarKindTypeEnum.mixed, null)
    setControlPromptEditorRerenderKey(Date.now())
  }, [assemblePlaceholder, onChange, removeExtractorNode, setControlPromptEditorRerenderKey])

  const handleOpenSubGraphModal = useCallback(() => {
    setIsSubGraphModalOpen(true)
  }, [])

  const handleCloseSubGraphModal = useCallback(() => {
    setIsSubGraphModalOpen(false)
  }, [])

  const sourceVariable: ValueSelector | undefined = detectedAgentFromValue
    ? [detectedAgentFromValue.nodeId, 'context']
    : undefined

  return (
    <div className={cn(
      'w-full rounded-lg border border-transparent bg-components-input-bg-normal',
      'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
      'focus-within:border-components-input-border-active focus-within:bg-components-input-bg-active focus-within:shadow-xs',
    )}
    >
      {isAssembleValue && (
        <AgentHeaderBar
          agentName={t('nodes.tool.assembleVariables', { ns: 'workflow' })}
          onRemove={handleAssembleRemove}
          onViewInternals={handleOpenSubGraphModal}
          hasWarning={hasAssembleWarning}
          showAtPrefix={false}
        />
      )}
      {!isAssembleValue && detectedAgentFromValue && (
        <AgentHeaderBar
          agentName={detectedAgentFromValue.name}
          onRemove={handleAgentRemove}
          onViewInternals={handleOpenSubGraphModal}
          hasWarning={hasAgentWarning}
        />
      )}
      {!isAssembleValue && (
        <div className="relative">
          <PromptEditor
            key={controlPromptEditorRerenderKey}
            wrapperClassName="min-h-8 px-2 py-1"
            className="caret:text-text-accent"
            editable={!readOnly}
            value={value}
            workflowVariableBlock={{
              show: !disableVariableInsertion,
              variables: nodesOutputVars || [],
              workflowNodesMap,
              showManageInputField,
              onManageInputField,
              showAssembleVariables: !disableVariableInsertion && !!toolNodeId && !!paramKey,
              onAssembleVariables: handleAssembleSelect,
            }}
            agentBlock={{
              show: agentNodes.length > 0 && !detectedAgentFromValue,
              agentNodes,
              onSelect: handleAgentSelect,
            }}
            placeholder={<Placeholder disableVariableInsertion={disableVariableInsertion} hasSelectedAgent={!!detectedAgentFromValue} />}
            onChange={(text) => {
              const hasPlaceholder = new RegExp(AGENT_CONTEXT_VAR_PATTERN.source).test(text)
              if (hasPlaceholder)
                syncExtractorPromptFromText(text)
              if (detectedAgentFromValue && !hasPlaceholder) {
                removeExtractorNode()
                onChange?.(text, VarKindTypeEnum.mixed, null)
                return
              }
              onChange?.(text)
            }}
          />
          {isOnlyAgentContext && paramKey && (
            <div className="pointer-events-none absolute left-0 top-0 flex h-full w-full items-center px-2 py-1">
              <span className="system-sm-regular text-components-input-text-placeholder">
                {t('nodes.tool.agentPlaceholder', { ns: 'workflow', paramKey })}
              </span>
            </div>
          )}
        </div>
      )}
      {toolNodeId && paramKey && isAssembleValue && (
        <SubGraphModal
          isOpen={isSubGraphModalOpen}
          onClose={handleCloseSubGraphModal}
          variant="assemble"
          toolNodeId={toolNodeId}
          paramKey={paramKey}
          title={t('nodes.tool.assembleVariables', { ns: 'workflow' })}
        />
      )}
      {toolNodeId && paramKey && !isAssembleValue && detectedAgentFromValue && sourceVariable && (
        <SubGraphModal
          isOpen={isSubGraphModalOpen}
          onClose={handleCloseSubGraphModal}
          variant="agent"
          toolNodeId={toolNodeId}
          paramKey={paramKey}
          sourceVariable={sourceVariable}
          agentName={detectedAgentFromValue.name}
          agentNodeId={detectedAgentFromValue.nodeId}
        />
      )}
    </div>
  )
}

export default memo(MixedVariableTextInput)
