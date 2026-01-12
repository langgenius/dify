import type { AgentBlockType } from '@/app/components/base/prompt-editor/types'
import type {
  Node,
  NodeOutPutVar,
  ValueSelector,
} from '@/app/components/workflow/types'
import {
  memo,
  useCallback,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import PromptEditor from '@/app/components/base/prompt-editor'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'
import SubGraphModal from '../sub-graph-modal'
import AgentHeaderBar from './agent-header-bar'
import Placeholder from './placeholder'

/**
 * Matches workflow variable syntax: {{#nodeId.varName#}}
 * Example: {{#agent-123.text#}} -> captures "agent-123.text"
 */
const WORKFLOW_VAR_PATTERN = /\{\{#([^#]+)#\}\}/g

type MixedVariableTextInputProps = {
  readOnly?: boolean
  nodesOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
  value?: string
  onChange?: (text: string) => void
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
  const controlPromptEditorRerenderKey = useStore(s => s.controlPromptEditorRerenderKey)
  const setControlPromptEditorRerenderKey = useStore(s => s.setControlPromptEditorRerenderKey)
  const [isSubGraphModalOpen, setIsSubGraphModalOpen] = useState(false)

  const nodesByIdMap = useMemo(() => {
    return availableNodes.reduce((acc, node) => {
      acc[node.id] = node
      return acc
    }, {} as Record<string, Node>)
  }, [availableNodes])

  const detectedAgentFromValue = useMemo(() => {
    if (!value)
      return null

    const matches = value.matchAll(WORKFLOW_VAR_PATTERN)
    for (const match of matches) {
      const variablePath = match[1]
      const nodeId = variablePath.split('.')[0]
      const node = nodesByIdMap[nodeId]
      if (node?.data.type === BlockEnum.Agent) {
        return {
          nodeId,
          name: node.data.title,
        }
      }
    }
    return null
  }, [value, nodesByIdMap])

  const [selectedAgent, setSelectedAgent] = useState<{ id: string, title: string } | null>(null)

  const agentNodes = useMemo(() => {
    return availableNodes
      .filter(node => node.data.type === BlockEnum.Agent)
      .map(node => ({
        id: node.id,
        title: node.data.title,
      }))
  }, [availableNodes])

  const handleAgentSelect = useCallback((agent: { id: string, title: string }) => {
    setSelectedAgent(agent)
  }, [])

  const handleAgentRemove = useCallback(() => {
    const agentNodeId = detectedAgentFromValue?.nodeId || selectedAgent?.id
    if (!agentNodeId || !onChange)
      return

    const pattern = /\{\{#([^#]+)#\}\}/g
    const valueWithoutAgentVars = value.replace(pattern, (match, variablePath) => {
      const nodeId = variablePath.split('.')[0]
      return nodeId === agentNodeId ? '' : match
    }).trim()

    onChange(valueWithoutAgentVars)
    setSelectedAgent(null)
    setControlPromptEditorRerenderKey(Date.now())
  }, [detectedAgentFromValue?.nodeId, selectedAgent?.id, value, onChange, setControlPromptEditorRerenderKey])

  const displayedAgent = detectedAgentFromValue || (selectedAgent ? { nodeId: selectedAgent.id, name: selectedAgent.title } : null)

  const handleOpenSubGraphModal = useCallback(() => {
    setIsSubGraphModalOpen(true)
  }, [])

  const handleCloseSubGraphModal = useCallback(() => {
    setIsSubGraphModalOpen(false)
  }, [])

  const sourceVariable: ValueSelector | undefined = displayedAgent
    ? [displayedAgent.nodeId, 'text']
    : undefined

  return (
    <div className={cn(
      'w-full rounded-lg border border-transparent bg-components-input-bg-normal',
      'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
      'focus-within:border-components-input-border-active focus-within:bg-components-input-bg-active focus-within:shadow-xs',
    )}
    >
      {displayedAgent && (
        <AgentHeaderBar
          agentName={displayedAgent.name}
          onRemove={handleAgentRemove}
          onViewInternals={handleOpenSubGraphModal}
        />
      )}
      <PromptEditor
        key={controlPromptEditorRerenderKey}
        wrapperClassName="min-h-8 px-2 py-1"
        className="caret:text-text-accent"
        editable={!readOnly}
        value={value}
        workflowVariableBlock={{
          show: !disableVariableInsertion,
          variables: nodesOutputVars || [],
          workflowNodesMap: availableNodes.reduce((acc, node) => {
            acc[node.id] = {
              title: node.data.title,
              type: node.data.type,
            }
            if (node.data.type === BlockEnum.Start) {
              acc.sys = {
                title: t('blocks.start', { ns: 'workflow' }),
                type: BlockEnum.Start,
              }
            }
            return acc
          }, {} as any),
          showManageInputField,
          onManageInputField,
        }}
        agentBlock={{
          show: agentNodes.length > 0 && !displayedAgent,
          agentNodes,
          onSelect: handleAgentSelect,
        } as AgentBlockType}
        placeholder={<Placeholder disableVariableInsertion={disableVariableInsertion} hasSelectedAgent={!!displayedAgent} />}
        onChange={onChange}
      />
      {toolNodeId && displayedAgent && sourceVariable && (
        <SubGraphModal
          isOpen={isSubGraphModalOpen}
          onClose={handleCloseSubGraphModal}
          toolNodeId={toolNodeId}
          paramKey={paramKey}
          sourceVariable={sourceVariable}
          agentName={displayedAgent.name}
          agentNodeId={displayedAgent.nodeId}
        />
      )}
    </div>
  )
}

export default memo(MixedVariableTextInput)
