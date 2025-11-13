import {
  memo,
  useCallback,
} from 'react'
import { useNodes } from 'reactflow'
import { useStore } from './store'
import {
  useIsChatMode,
  useNodesReadOnly,
} from './hooks'
import { type CommonNodeType, type InputVar, InputVarType, type Node } from './types'
import useConfig from './nodes/start/use-config'
import type { StartNodeType } from './nodes/start/types'
import type { PromptVariable } from '@/models/debug'
import NewFeaturePanel from '@/app/components/base/features/new-feature-panel'
import { webSocketClient } from '@/app/components/workflow/collaboration/core/websocket-manager'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { type WorkflowDraftFeaturesPayload, updateFeatures } from '@/service/workflow'

const Features = () => {
  const setShowFeaturesPanel = useStore(s => s.setShowFeaturesPanel)
  const appId = useStore(s => s.appId)
  const isChatMode = useIsChatMode()
  const { nodesReadOnly } = useNodesReadOnly()
  const featuresStore = useFeaturesStore()
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

  const handleFeaturesChange = useCallback(async () => {
    if (!appId || !featuresStore) return

    try {
      const currentFeatures = featuresStore.getState().features

      // Transform features to match the expected server format (same as doSyncWorkflowDraft)
      const transformedFeatures: WorkflowDraftFeaturesPayload = {
        opening_statement: currentFeatures.opening?.enabled ? (currentFeatures.opening?.opening_statement || '') : '',
        suggested_questions: currentFeatures.opening?.enabled ? (currentFeatures.opening?.suggested_questions || []) : [],
        suggested_questions_after_answer: currentFeatures.suggested,
        text_to_speech: currentFeatures.text2speech,
        speech_to_text: currentFeatures.speech2text,
        retriever_resource: currentFeatures.citation,
        sensitive_word_avoidance: currentFeatures.moderation,
        file_upload: currentFeatures.file,
      }

      console.log('Sending features to server:', transformedFeatures)

      await updateFeatures({
        appId,
        features: transformedFeatures,
      })

      // Emit update event to other connected clients
      const socket = webSocketClient.getSocket(appId)
      if (socket) {
        socket.emit('collaboration_event', {
          type: 'vars_and_features_update',
        })
      }
    }
    catch (error) {
      console.error('Failed to update features:', error)
    }

    setShowFeaturesPanel(true)
  }, [appId, featuresStore, setShowFeaturesPanel])

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
