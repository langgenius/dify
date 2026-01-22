'use client'
import type { FC } from 'react'
import type { SubGraphModalProps } from './types'
import type { NestedNodeConfig } from '@/app/components/workflow/nodes/_base/types'
import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
import type { ToolNodeType } from '@/app/components/workflow/nodes/tool/types'
import type { Node, PromptItem, PromptTemplateItem } from '@/app/components/workflow/types'
import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
import { RiCloseLine } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import { Fragment, memo, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useReactFlowStore, useStoreApi } from 'reactflow'
import { AssembleVariablesAlt } from '@/app/components/base/icons/src/vender/line/general'
import { Agent } from '@/app/components/base/icons/src/vender/workflow'
import { useIsChatMode, useNodesSyncDraft, useWorkflow, useWorkflowVariables } from '@/app/components/workflow/hooks'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { useStore as useWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum, EditionType, isPromptMessageContext, PromptRole, VarType } from '@/app/components/workflow/types'
import SubGraphCanvas from './sub-graph-canvas'

const SubGraphModal: FC<SubGraphModalProps> = (props) => {
  const { t } = useTranslation()
  const { isOpen, onClose, variant, toolNodeId, paramKey } = props
  const isAgentVariant = variant === 'agent'
  const resolvedAgentNodeId = isAgentVariant ? props.agentNodeId : ''
  const agentName = isAgentVariant ? props.agentName : ''
  const assembleTitle = !isAgentVariant ? props.title : ''
  const modalTitle = useMemo(() => {
    const baseTitle = isAgentVariant
      ? agentName
      : (assembleTitle || t('nodes.tool.assembleVariables', { ns: 'workflow' }))
    const prefix = isAgentVariant && baseTitle ? '@' : ''
    return `${prefix}${baseTitle} ${t('subGraphModal.title', { ns: 'workflow' })}`.trim()
  }, [agentName, assembleTitle, isAgentVariant, t])
  const reactflowStore = useStoreApi()
  const workflowNodes = useWorkflowStore(state => state.nodes)
  const workflowEdges = useReactFlowStore(state => state.edges)
  const setControlPromptEditorRerenderKey = useWorkflowStore(state => state.setControlPromptEditorRerenderKey)
  const { handleSyncWorkflowDraft, doSyncWorkflowDraft } = useNodesSyncDraft()
  const configsMap = useHooksStore(state => state.configsMap)
  const { getBeforeNodesInSameBranch } = useWorkflow()
  const { getNodeAvailableVars } = useWorkflowVariables()
  const isChatMode = useIsChatMode()

  const extractorNodeId = `${toolNodeId}_ext_${paramKey}`
  const extractorNode = useMemo(() => {
    return workflowNodes.find(node => node.id === extractorNodeId) as Node<LLMNodeType | CodeNodeType> | undefined
  }, [extractorNodeId, workflowNodes])
  const toolNode = useMemo(() => {
    return workflowNodes.find(node => node.id === toolNodeId)
  }, [toolNodeId, workflowNodes])
  const toolParam = (toolNode?.data as ToolNodeType | undefined)?.tool_parameters?.[paramKey]
  const toolParamValue = toolParam?.value as string | undefined
  const assemblePlaceholder = useMemo(() => {
    return `{{#${toolNodeId}_ext_${paramKey}.result#}}`
  }, [paramKey, toolNodeId])

  const parentBeforeNodes = useMemo(() => {
    if (!isOpen)
      return []
    return getBeforeNodesInSameBranch(toolNodeId, workflowNodes, workflowEdges)
  }, [getBeforeNodesInSameBranch, isOpen, toolNodeId, workflowEdges, workflowNodes])

  const parentContextNodes = useMemo(() => {
    if (!parentBeforeNodes.length || !isAgentVariant)
      return []
    return parentBeforeNodes.filter(node => node.data.type === BlockEnum.Agent || node.data.type === BlockEnum.LLM)
  }, [isAgentVariant, parentBeforeNodes])

  const parentAvailableNodes = useMemo(() => {
    if (!isOpen)
      return []
    return isAgentVariant ? parentContextNodes : parentBeforeNodes
  }, [isAgentVariant, isOpen, parentBeforeNodes, parentContextNodes])

  const parentAvailableVars = useMemo(() => {
    if (!parentAvailableNodes.length)
      return []
    const vars = getNodeAvailableVars({
      beforeNodes: parentAvailableNodes,
      isChatMode,
      filterVar: () => true,
    })
    const availableNodeIds = new Set(parentAvailableNodes.map(node => node.id))
    return vars.filter(nodeVar => availableNodeIds.has(nodeVar.nodeId))
  }, [getNodeAvailableVars, isChatMode, parentAvailableNodes])

  const nestedNodeConfig = useMemo<NestedNodeConfig>(() => {
    const current = toolParam?.nested_node_config
    const rawSelector = Array.isArray(current?.output_selector) ? current!.output_selector : []
    const outputSelector = rawSelector[0] === extractorNodeId ? rawSelector.slice(1) : rawSelector
    const defaultOutputSelector = isAgentVariant
      ? ['structured_output', paramKey]
      : ['result']

    return {
      extractor_node_id: current?.extractor_node_id || extractorNodeId,
      output_selector: outputSelector.length > 0 ? outputSelector : defaultOutputSelector,
      null_strategy: current?.null_strategy || 'use_default',
      default_value: current?.default_value ?? '',
    }
  }, [extractorNodeId, isAgentVariant, paramKey, toolParam?.nested_node_config])

  const handleNestedNodeConfigChange = useCallback((config: NestedNodeConfig) => {
    const { getNodes, setNodes } = reactflowStore.getState()
    const nextNodes = getNodes().map((node) => {
      if (node.id !== toolNodeId)
        return node

      const toolData = node.data as ToolNodeType
      const currentParam = toolData.tool_parameters?.[paramKey]
      if (!currentParam)
        return node

      return {
        ...node,
        data: {
          ...toolData,
          tool_parameters: {
            ...toolData.tool_parameters,
            [paramKey]: {
              ...currentParam,
              type: VarKindType.nested_node,
              nested_node_config: config,
            },
          },
        },
      }
    })
    setNodes(nextNodes)
    handleSyncWorkflowDraft()
  }, [handleSyncWorkflowDraft, paramKey, reactflowStore, toolNodeId])

  useEffect(() => {
    if (!toolParam || (toolParam.type && toolParam.type !== VarKindType.nested_node))
      return

    const current = toolParam.nested_node_config
    const needsExtractor = !current?.extractor_node_id
    const needsNullStrategy = !current?.null_strategy
    const needsOutputSelector = !Array.isArray(current?.output_selector)
    const needsDefaultValue = current?.default_value === undefined

    if (needsExtractor || needsNullStrategy || needsOutputSelector || needsDefaultValue)
      handleNestedNodeConfigChange(nestedNodeConfig)
  }, [handleNestedNodeConfigChange, nestedNodeConfig, toolParam])

  const getUserPromptText = useCallback((promptTemplate?: PromptTemplateItem[] | PromptItem) => {
    if (!promptTemplate)
      return ''
    const resolveText = (item?: PromptItem) => {
      if (!item)
        return ''
      if (item.edition_type === EditionType.jinja2)
        return item.jinja2_text || item.text || ''
      return item.text || ''
    }
    if (Array.isArray(promptTemplate)) {
      for (const item of promptTemplate) {
        if (!isPromptMessageContext(item) && item.role === PromptRole.user)
          return resolveText(item)
      }
      return ''
    }
    return resolveText(promptTemplate)
  }, [])

  // TODO: handle external workflow updates while sub-graph modal is open.
  const handleSave = useCallback((subGraphNodes: Node[]) => {
    const extractorNodeData = subGraphNodes.find(node => node.id === extractorNodeId) as Node<LLMNodeType | CodeNodeType> | undefined
    if (!extractorNodeData)
      return

    const ensureAssembleOutputs = (payload: CodeNodeType) => {
      const outputs = payload.outputs || {}
      if (outputs.result)
        return payload
      return {
        ...payload,
        outputs: {
          ...outputs,
          result: {
            type: VarType.string,
            children: null,
          },
        },
      }
    }

    const userPromptText = isAgentVariant
      ? getUserPromptText((extractorNodeData.data as LLMNodeType).prompt_template)
      : ''
    const placeholder = isAgentVariant && resolvedAgentNodeId ? `{{@${resolvedAgentNodeId}.context@}}` : ''
    const nextValue = isAgentVariant
      ? `${placeholder}${userPromptText}`
      : assemblePlaceholder

    const { getNodes, setNodes } = reactflowStore.getState()
    const nextNodes = getNodes().map((node) => {
      if (node.id === extractorNodeId) {
        const nextData = isAgentVariant
          ? extractorNodeData.data
          : ensureAssembleOutputs(extractorNodeData.data as CodeNodeType)
        return {
          ...node,
          hidden: true,
          data: {
            ...node.data,
            ...nextData,
            parent_node_id: toolNodeId,
          },
        }
      }
      if (node.id === toolNodeId) {
        const toolData = node.data as ToolNodeType
        if (!toolData.tool_parameters?.[paramKey])
          return node

        const currentParam = toolData.tool_parameters[paramKey]
        return {
          ...node,
          data: {
            ...toolData,
            tool_parameters: {
              ...toolData.tool_parameters,
              [paramKey]: {
                ...currentParam,
                type: VarKindType.nested_node,
                value: nextValue,
                nested_node_config: currentParam.nested_node_config ?? nestedNodeConfig,
              },
            },
          },
        }
      }
      return node
    })
    setNodes(nextNodes)
    setControlPromptEditorRerenderKey(Date.now())
  }, [assemblePlaceholder, extractorNodeId, getUserPromptText, isAgentVariant, nestedNodeConfig, paramKey, reactflowStore, resolvedAgentNodeId, setControlPromptEditorRerenderKey, toolNodeId])

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[60]" onClose={noop}>
        <TransitionChild>
          <div className="fixed inset-0 bg-background-overlay duration-300 ease-in data-[closed]:opacity-0 data-[enter]:opacity-100 data-[leave]:opacity-0" />
        </TransitionChild>
        <div className="fixed inset-0 overflow-hidden">
          <div className="flex h-full w-full items-center justify-center px-[10px] pb-[4px] pt-[24px]">
            <TransitionChild>
              <DialogPanel className="flex h-full w-full flex-col overflow-hidden rounded-2xl bg-components-panel-bg shadow-xl duration-100 ease-in data-[closed]:scale-95 data-[enter]:scale-100 data-[leave]:scale-95 data-[closed]:opacity-0 data-[enter]:opacity-100 data-[leave]:opacity-0">
                <div className="flex h-14 shrink-0 items-center justify-between border-b border-divider-subtle px-4">
                  <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded bg-util-colors-indigo-indigo-500">
                      {isAgentVariant
                        ? <Agent className="h-4 w-4 text-text-primary-on-surface" />
                        : <AssembleVariablesAlt className="h-4 w-4 text-text-primary-on-surface" />}
                    </div>
                    <span className="system-md-semibold text-text-primary">
                      {modalTitle}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-state-base-hover"
                    onClick={onClose}
                  >
                    <RiCloseLine className="h-5 w-5 text-text-tertiary" />
                  </button>
                </div>

                <div className="bg-workflow-canvas-wrapper relative flex-1 overflow-hidden">
                  {variant === 'agent'
                    ? (
                        <SubGraphCanvas
                          variant="agent"
                          toolNodeId={toolNodeId}
                          paramKey={paramKey}
                          sourceVariable={props.sourceVariable}
                          agentNodeId={props.agentNodeId}
                          agentName={props.agentName}
                          configsMap={configsMap}
                          nestedNodeConfig={nestedNodeConfig}
                          onNestedNodeConfigChange={handleNestedNodeConfigChange}
                          extractorNode={extractorNode as Node<LLMNodeType> | undefined}
                          toolParamValue={toolParamValue}
                          parentAvailableNodes={parentAvailableNodes}
                          parentAvailableVars={parentAvailableVars}
                          onSave={handleSave}
                          onSyncWorkflowDraft={doSyncWorkflowDraft}
                        />
                      )
                    : (
                        <SubGraphCanvas
                          variant="assemble"
                          toolNodeId={toolNodeId}
                          paramKey={paramKey}
                          title={props.title}
                          configsMap={configsMap}
                          nestedNodeConfig={nestedNodeConfig}
                          onNestedNodeConfigChange={handleNestedNodeConfigChange}
                          extractorNode={extractorNode as Node<CodeNodeType> | undefined}
                          toolParamValue={toolParamValue}
                          parentAvailableNodes={parentAvailableNodes}
                          parentAvailableVars={parentAvailableVars}
                          onSave={handleSave}
                          onSyncWorkflowDraft={doSyncWorkflowDraft}
                        />
                      )}
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}

export default memo(SubGraphModal)
