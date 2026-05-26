'use client'
import type { FC } from 'react'
import type { ModelConfig, PromptVariable } from '@/models/debug'
import { produce } from 'immer'
import * as React from 'react'
import { useContext } from 'use-context-selector'
import ConfigPrompt from '../../configuration/config-prompt'
import ConfigVar from '../../configuration/config-var'
import ConfigContext from '@/context/debug-configuration'
import { AppModeEnum, ModelModeType } from '@/types/app'
import HistoryPanel from '../../configuration/config-prompt/conversation-history/history-panel'
import ConfigVision from '../../configuration/config-vision/index'
import DatasetConfig from '../../configuration/dataset-config/index'
import { useFormattingChangedDispatcher } from '../../configuration/debug/hooks'
import AgentTools from '../../configuration/config/agent/agent-tools/index'
import ConfigAudio from '../../configuration/config/config-audio'
import ConfigDocument from '../../configuration/config/config-document'

const Config: FC = () => {
  const {
    readonly,
    mode,
    isAdvancedMode,
    modelModeType,
    isAgent,
    hasSetBlockStatus,
    showHistoryModal,
    modelConfig,
    setModelConfig,
    setPrevPromptConfig,
    dataSets,
  } = useContext(ConfigContext)
  const isChatApp = [AppModeEnum.ADVANCED_CHAT, AppModeEnum.AGENT_CHAT, AppModeEnum.CHAT].includes(mode)
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
          mode={mode}
          promptTemplate={promptTemplate}
          promptVariables={promptVariables}
          onChange={handlePromptChange}
          readonly={readonly}
        />

        {/* Variables */}
        {!(readonly && promptVariables.length === 0) && (
          <ConfigVar
            promptVariables={promptVariables}
            onPromptVariablesChange={handlePromptVariablesNameChange}
            readonly={readonly}
          />
        )}

        {/* Dataset */}
        {!(readonly && dataSets.length === 0) && (
          <DatasetConfig
            readonly={readonly}
            hideMetadataFilter={readonly}
          />
        )}
        {/* Tools */}
        {isAgent && !(readonly && modelConfig.agentConfig.tools.length === 0) && (
          <AgentTools />
        )}

        <ConfigVision />

        <ConfigDocument />

        <ConfigAudio />

        {/* Chat History */}
        {!readonly && isAdvancedMode && isChatApp && modelModeType === ModelModeType.completion && (
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
