import {
  memo,
  useCallback,
} from 'react'
import { useNodes } from 'reactflow'
import { useStore } from './store'
import {
  useIsChatMode,
  useNodesReadOnly,
  useNodesSyncDraft,
} from './hooks'
import { type CommonNodeType, type InputVar, InputVarType, type Node } from './types'
import useConfig from './nodes/start/use-config'
import type { StartNodeType } from './nodes/start/types'
import type { PromptVariable } from '@/models/debug'
import NewFeaturePanel from '@/app/components/base/features/new-feature-panel'

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
