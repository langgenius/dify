'use client'
import type { FC } from 'react'
import React from 'react'
import { useContext } from 'use-context-selector'
import produce from 'immer'
import { useFormattingChangedDispatcher } from '../debug/hooks'
import DatasetConfig from '../dataset-config'
import HistoryPanel from '../config-prompt/conversation-history/history-panel'
import ConfigVision from '../config-vision'
import ConfigDocument from './config-document'
import AgentTools from './agent/agent-tools'
import ConfigContext from '@/context/debug-configuration'
import ConfigPrompt from '@/app/components/app/configuration/config-prompt'
import ConfigVar from '@/app/components/app/configuration/config-var'
import type { ModelConfig, PromptVariable } from '@/models/debug'
import type { AppType } from '@/types/app'
import { ModelModeType } from '@/types/app'

const Config: FC = () => {
  const {
    mode,
    isAdvancedMode,
    modelModeType,
    isAgent,
    hasSetBlockStatus,
    showHistoryModal,
    modelConfig,
    setModelConfig,
    setPrevPromptConfig,
  } = useContext(ConfigContext)
  const isChatApp = ['advanced-chat', 'agent-chat', 'chat'].includes(mode)
  const formattingChangedDispatcher = useFormattingChangedDispatcher()

  const promptTemplate = modelConfig.configs.prompt_template
  const promptVariables = modelConfig.configs.prompt_variables
  // simple mode
  const handlePromptChange = (newTemplate: string, newVariables: PromptVariable[]) => {
    const newModelConfig = produce(modelConfig, (draft: ModelConfig) => {
      draft.configs.prompt_template = newTemplate
      draft.configs.prompt_variables = [...draft.configs.prompt_variables, ...newVariables]
    })
    if (modelConfig.configs.prompt_template !== newTemplate)
      formattingChangedDispatcher()

    setPrevPromptConfig(modelConfig.configs)
    setModelConfig(newModelConfig)
  }

  const handlePromptVariablesNameChange = (newVariables: PromptVariable[]) => {
    setPrevPromptConfig(modelConfig.configs)
    const newModelConfig = produce(modelConfig, (draft: ModelConfig) => {
      draft.configs.prompt_variables = newVariables
    })
    setModelConfig(newModelConfig)
  }

  return (
    <>
      <div
        className="relative h-0 grow overflow-y-auto px-6 pb-[50px]"
      >
        {/* Template */}
        <ConfigPrompt
          mode={mode as AppType}
          promptTemplate={promptTemplate}
          promptVariables={promptVariables}
          onChange={handlePromptChange}
        />

        {/* Variables */}
        <ConfigVar
          promptVariables={promptVariables}
          onPromptVariablesChange={handlePromptVariablesNameChange}
        />

        {/* Dataset */}
        <DatasetConfig />

        {/* Tools */}
        {isAgent && (
          <AgentTools />
        )}

        <ConfigVision />

        <ConfigDocument />

        {/* Chat History */}
        {isAdvancedMode && isChatApp && modelModeType === ModelModeType.completion && (
          <HistoryPanel
            showWarning={!hasSetBlockStatus.history}
            onShowEditModal={showHistoryModal}
          />
        )}
      </div>
    </>
  )
}
export default React.memo(Config)
