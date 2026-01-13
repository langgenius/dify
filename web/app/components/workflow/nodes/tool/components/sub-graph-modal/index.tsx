'use client'
import type { FC } from 'react'
import type { SubGraphModalProps } from './types'
import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
import type { ToolNodeType } from '@/app/components/workflow/nodes/tool/types'
import type { Node, PromptItem } from '@/app/components/workflow/types'
import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
import { RiCloseLine } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import { Fragment, memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import { Agent } from '@/app/components/base/icons/src/vender/workflow'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks'
import { useStore } from '@/app/components/workflow/store'
import { EditionType, PromptRole } from '@/app/components/workflow/types'
import SubGraphCanvas from './sub-graph-canvas'

const SubGraphModal: FC<SubGraphModalProps> = ({
  isOpen,
  onClose,
  toolNodeId,
  paramKey,
  sourceVariable,
  agentName,
  agentNodeId,
}) => {
  const { t } = useTranslation()
  const reactflowStore = useStoreApi()
  const workflowNodes = useStore(state => state.nodes)
  const setControlPromptEditorRerenderKey = useStore(state => state.setControlPromptEditorRerenderKey)
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()

  const extractorNodeId = `${toolNodeId}_ext_${paramKey}`
  const extractorNode = useMemo(() => {
    return workflowNodes.find(node => node.id === extractorNodeId) as Node<LLMNodeType> | undefined
  }, [extractorNodeId, workflowNodes])
  const toolNode = useMemo(() => {
    return workflowNodes.find(node => node.id === toolNodeId)
  }, [toolNodeId, workflowNodes])
  const toolParamValue = (toolNode?.data as ToolNodeType | undefined)?.tool_parameters?.[paramKey]?.value as string | undefined

  const getUserPromptText = useCallback((promptTemplate?: PromptItem[] | PromptItem) => {
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
      const userPrompt = promptTemplate.find(item => item.role === PromptRole.user)
      if (userPrompt)
        return resolveText(userPrompt)
      const systemPrompt = promptTemplate.find(item => item.role === PromptRole.system)
      return resolveText(systemPrompt)
    }
    return resolveText(promptTemplate)
  }, [])

  const handleSave = useCallback((subGraphNodes: any[], _edges: any[]) => {
    const extractorNodeData = subGraphNodes.find(node => node.id === extractorNodeId)
    if (!extractorNodeData)
      return

    const userPromptText = getUserPromptText(extractorNodeData.data?.prompt_template)
    const placeholder = `{{@${agentNodeId}.context@}}`
    const nextValue = `${placeholder}${userPromptText}`

    const { getNodes, setNodes } = reactflowStore.getState()
    const nextNodes = getNodes().map((node) => {
      if (node.id === extractorNodeId) {
        return {
          ...node,
          hidden: true,
          data: {
            ...node.data,
            ...extractorNodeData.data,
            parent_node_id: toolNodeId,
          },
        }
      }
      if (node.id === toolNodeId) {
        const toolData = node.data as ToolNodeType
        if (!toolData.tool_parameters?.[paramKey])
          return node

        return {
          ...node,
          data: {
            ...toolData,
            tool_parameters: {
              ...toolData.tool_parameters,
              [paramKey]: {
                ...toolData.tool_parameters[paramKey],
                value: nextValue,
              },
            },
          },
        }
      }
      return node
    })
    setNodes(nextNodes)
    // Trigger main graph draft sync to persist changes to backend
    handleSyncWorkflowDraft(true)
    setControlPromptEditorRerenderKey(Date.now())
  }, [agentNodeId, extractorNodeId, getUserPromptText, handleSyncWorkflowDraft, paramKey, reactflowStore, setControlPromptEditorRerenderKey, toolNodeId])

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
                      <Agent className="h-4 w-4 text-text-primary-on-surface" />
                    </div>
                    <span className="system-md-semibold text-text-primary">
                      @
                      {agentName}
                      {' '}
                      {t('subGraphModal.title', { ns: 'workflow' })}
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
                  <SubGraphCanvas
                    toolNodeId={toolNodeId}
                    paramKey={paramKey}
                    sourceVariable={sourceVariable}
                    agentNodeId={agentNodeId}
                    agentName={agentName}
                    extractorNode={extractorNode}
                    toolParamValue={toolParamValue}
                    onSave={handleSave}
                  />
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
