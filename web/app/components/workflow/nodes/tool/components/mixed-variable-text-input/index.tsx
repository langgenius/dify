import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import PromptEditor from '@/app/components/base/prompt-editor'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'
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
  onViewInternals?: () => void
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
  onViewInternals,
}: MixedVariableTextInputProps) => {
  const { t } = useTranslation()
  const controlPromptEditorRerenderKey = useStore(s => s.controlPromptEditorRerenderKey)
  const setControlPromptEditorRerenderKey = useStore(s => s.setControlPromptEditorRerenderKey)

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

  const handleAgentRemove = useCallback(() => {
    if (!detectedAgentFromValue || !onChange)
      return

    const pattern = /\{\{#([^#]+)#\}\}/g
    const valueWithoutAgentVars = value.replace(pattern, (match, variablePath) => {
      const nodeId = variablePath.split('.')[0]
      return nodeId === detectedAgentFromValue.nodeId ? '' : match
    }).trim()

    onChange(valueWithoutAgentVars)
    setControlPromptEditorRerenderKey(Date.now())
  }, [detectedAgentFromValue, value, onChange, setControlPromptEditorRerenderKey])

  return (
    <div className={cn(
      'w-full rounded-lg border border-transparent bg-components-input-bg-normal',
      'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
      'focus-within:border-components-input-border-active focus-within:bg-components-input-bg-active focus-within:shadow-xs',
    )}
    >
      {detectedAgentFromValue && (
        <AgentHeaderBar
          agentName={detectedAgentFromValue.name}
          onRemove={handleAgentRemove}
          onViewInternals={onViewInternals}
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
        placeholder={<Placeholder disableVariableInsertion={disableVariableInsertion} />}
        onChange={onChange}
      />
    </div>
  )
}

export default memo(MixedVariableTextInput)
