import type { StartNodeType } from './nodes/start/types'
import type { CommonNodeType, InputVar, Node } from './types'
import type { PromptVariable } from '@/models/debug'
import {
  memo,
  useCallback,
} from 'react'
import { useNodes } from 'reactflow'
import NewFeaturePanel from '@/app/components/base/features/new-feature-panel'
import {
  useIsChatMode,
  useNodesReadOnly,
  useNodesSyncDraft,
} from './hooks'
import useConfig from './nodes/start/use-config'
import { useStore } from './store'
import { InputVarType } from './types'

const Features = () => {
  const setShowFeaturesPanel = useStore(s => s.setShowFeaturesPanel)
  const isChatMode = useIsChatMode()
  const { nodesReadOnly } = useNodesReadOnly()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const nodes = useNodes<CommonNodeType>()

  const startNode = nodes.find(node => node.data.type === 'start')
  const { id, data } = startNode as Node<StartNodeType>
  const { handleAddVariable } = useConfig(id, data)

  const handleAddOpeningStatementVariable = (variables: PromptVariable[]) => {
    const newVariable = variables[0]
    const startNodeVariable: InputVar = {
      variable: newVariable.key,
      label: newVariable.name,
      type: InputVarType.textInput,
      max_length: newVariable.max_length,
      required: newVariable.required || false,
      options: [],
    }
    handleAddVariable(startNodeVariable)
  }

  const handleFeaturesChange = useCallback(() => {
    handleSyncWorkflowDraft()
    setShowFeaturesPanel(true)
  }, [handleSyncWorkflowDraft, setShowFeaturesPanel])

  return (
    <NewFeaturePanel
      show
      isChatMode={isChatMode}
      disabled={nodesReadOnly}
      onChange={handleFeaturesChange}
      onClose={() => setShowFeaturesPanel(false)}
      onAutoAddPromptVariable={handleAddOpeningStatementVariable}
      workflowVariables={data.variables}
    />
  )
}

export default memo(Features)
