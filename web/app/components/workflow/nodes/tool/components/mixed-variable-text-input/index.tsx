import type { ContextGenerateModalHandle } from '../context-generate-modal'
import type { DetectedAgent } from './hooks'
import type { AgentNode, WorkflowVariableBlockType } from '@/app/components/base/prompt-editor/types'
import type { StrategyDetail, StrategyPluginDetail } from '@/app/components/plugins/types'
import type { NestedNodeConfig, VarKindType } from '@/app/components/workflow/nodes/_base/types'
import type { AgentNodeType } from '@/app/components/workflow/nodes/agent/types'
import type {
  CommonNodeType,
  NodeOutPutVar,
  ValueSelector,
  Node as WorkflowNode,
} from '@/app/components/workflow/types'
import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNodes, useStoreApi } from 'reactflow'
import PromptEditor from '@/app/components/base/prompt-editor'
import { useNodesMetaData, useNodesSyncDraft } from '@/app/components/workflow/hooks'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { NULL_STRATEGY } from '@/app/components/workflow/nodes/_base/constants'
import { VarKindType as VarKindTypeEnum } from '@/app/components/workflow/nodes/_base/types'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { useGetLanguage } from '@/context/i18n'
import { useStrategyProviders } from '@/service/use-strategy'
import { cn } from '@/utils/classnames'
import ContextGenerateModal from '../context-generate-modal'
import { buildContextGenStorageKey, clearContextGenStorage } from '../context-generate-modal/utils/storage'
import SubGraphModal from '../sub-graph-modal'
import { AgentHeaderBar, Placeholder } from './components'
import {
  AGENT_CONTEXT_VAR_PATTERN,
  buildAssembleNestedNodeConfig,
  buildAssemblePlaceholder,
  getAgentNodeIdFromContextVar,
  useMixedVariableExtractor,
} from './hooks'

type WorkflowNodesMap = NonNullable<WorkflowVariableBlockType['workflowNodesMap']>

const DEFAULT_NESTED_NODE_CONFIG: NestedNodeConfig = {
  extractor_node_id: '',
  output_selector: [],
  null_strategy: NULL_STRATEGY.RAISE_ERROR,
  default_value: '',
}

type AgentCheckValidContext = {
  provider?: StrategyPluginDetail
  strategy?: StrategyDetail
  language: string
  isReadyForCheckValid: boolean
}

type MixedVariableTextInputProps = {
  readOnly?: boolean
  nodesOutputVars?: NodeOutPutVar[]
  availableNodes?: WorkflowNode[]
  value?: string
  onChange?: (text: string, type?: VarKindType, nestedNodeConfig?: NestedNodeConfig | null) => void
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
  const configsMap = useHooksStore(s => s.configsMap)
  const controlPromptEditorRerenderKey = useStore(s => s.controlPromptEditorRerenderKey)
  const setControlPromptEditorRerenderKey = useStore(s => s.setControlPromptEditorRerenderKey)
  const nodesDefaultConfigs = useStore(s => s.nodesDefaultConfigs)
  const { nodesMap: nodesMetaDataMap } = useNodesMetaData()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const [isSubGraphModalOpen, setIsSubGraphModalOpen] = useState(false)
  const [isContextGenerateModalOpen, setIsContextGenerateModalOpen] = useState(false)
  const contextGenerateModalRef = useRef<ContextGenerateModalHandle>(null)
  const [pendingRunAfterSubGraphOpen, setPendingRunAfterSubGraphOpen] = useState(false)

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

  const {
    assembleExtractorNodeId,
    ensureExtractorNode,
    ensureAssembleExtractorNode,
    removeExtractorNode,
    syncExtractorPromptFromText,
    requestNestedNodeGraph,
  } = useMixedVariableExtractor({
    toolNodeId,
    paramKey,
    language,
    nodesById,
    nodesDefaultConfigs,
    reactFlowStore,
    nodesMetaDataMap,
    handleSyncWorkflowDraft,
    configsMap,
  })

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

    const valueWithoutTrigger = value.replace(/@[^@\n]*$/, '')
    const newValue = `{{@${agent.id}.context@}}${valueWithoutTrigger}`

    const extractorNodeId = toolNodeId && paramKey ? `${toolNodeId}_ext_${paramKey}` : ''
    if (extractorNodeId) {
      ensureExtractorNode({
        extractorNodeId,
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

    const nestedNodeConfigWithOutputSelector: NestedNodeConfig = {
      ...DEFAULT_NESTED_NODE_CONFIG,
      extractor_node_id: extractorNodeId,
      output_selector: paramKey ? ['structured_output', paramKey] : [],
    }
    onChange(newValue, VarKindTypeEnum.nested_node, nestedNodeConfigWithOutputSelector)
    syncExtractorPromptFromText(newValue, detectAgentFromText)
    if (extractorNodeId) {
      void requestNestedNodeGraph({
        agentId: agent.id,
        extractorNodeId,
        valueText: newValue,
        detectAgentFromText,
      })
    }
  }, [detectAgentFromText, ensureExtractorNode, onChange, paramKey, requestNestedNodeGraph, syncExtractorPromptFromText, toolNodeId, value])

  const handleAssembleSelect = useCallback((): ValueSelector | null => {
    if (!toolNodeId || !paramKey || !assemblePlaceholder)
      return null
    const extractorNodeId = assembleExtractorNodeId || `${toolNodeId}_ext_${paramKey}`
    ensureAssembleExtractorNode()
    const { getNodes } = reactFlowStore.getState()
    const extractorNode = getNodes().find(node => node.id === extractorNodeId)
    const outputs = (extractorNode?.data as { outputs?: Record<string, unknown> } | undefined)?.outputs
    const nestedNodeConfig = buildAssembleNestedNodeConfig(extractorNodeId, outputs as import('@/app/components/workflow/nodes/code/types').OutputVar | undefined)
    onChange?.(assemblePlaceholder, VarKindTypeEnum.nested_node, nestedNodeConfig)
    setControlPromptEditorRerenderKey(Date.now())
    setIsContextGenerateModalOpen(true)
    setTimeout(() => {
      contextGenerateModalRef.current?.onOpen()
    }, 0)
    return [extractorNodeId, 'result']
  }, [assembleExtractorNodeId, assemblePlaceholder, ensureAssembleExtractorNode, onChange, paramKey, reactFlowStore, setControlPromptEditorRerenderKey, toolNodeId])

  const handleAssembleRemove = useCallback(() => {
    if (!onChange || !assemblePlaceholder || !toolNodeId)
      return

    removeExtractorNode()
    onChange('', VarKindTypeEnum.mixed, null)
    setControlPromptEditorRerenderKey(Date.now())

    const storageKey = buildContextGenStorageKey(configsMap?.flowId, toolNodeId, paramKey)
    clearContextGenStorage(storageKey)
  }, [assemblePlaceholder, configsMap?.flowId, onChange, paramKey, removeExtractorNode, setControlPromptEditorRerenderKey, toolNodeId])

  const handleOpenSubGraphModal = useCallback(() => {
    setIsSubGraphModalOpen(true)
  }, [])

  const handleCloseSubGraphModal = useCallback(() => {
    setIsSubGraphModalOpen(false)
    setPendingRunAfterSubGraphOpen(false)
  }, [])

  const handlePendingSingleRunHandled = useCallback(() => {
    setPendingRunAfterSubGraphOpen(false)
  }, [])

  const handleCloseContextGenerateModal = useCallback(() => {
    setIsContextGenerateModalOpen(false)
  }, [])

  const handleOpenInternalViewAndRun = useCallback(() => {
    if (!isSubGraphModalOpen)
      setIsSubGraphModalOpen(true)
    setPendingRunAfterSubGraphOpen(true)
  }, [isSubGraphModalOpen])

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
                syncExtractorPromptFromText(text, detectAgentFromText)
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
          pendingSingleRun={pendingRunAfterSubGraphOpen}
          onPendingSingleRunHandled={handlePendingSingleRunHandled}
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
      {toolNodeId && paramKey && (
        <ContextGenerateModal
          ref={contextGenerateModalRef}
          isShow={isContextGenerateModalOpen}
          onClose={handleCloseContextGenerateModal}
          toolNodeId={toolNodeId}
          paramKey={paramKey}
          codeNodeId={assembleExtractorNodeId || `${toolNodeId}_ext_${paramKey}`}
          availableVars={nodesOutputVars}
          availableNodes={availableNodes}
          onOpenInternalViewAndRun={handleOpenInternalViewAndRun}
        />
      )}
    </div>
  )
}

export default memo(MixedVariableTextInput)
