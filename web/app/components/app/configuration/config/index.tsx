'use client'
import type { FC } from 'react'
import React from 'react'
import { useContext } from 'use-context-selector'
import produce from 'immer'
import { useFormattingChangedDispatcher } from '../debug/hooks'
import DatasetConfig from '../dataset-config'
import HistoryPanel from '../config-prompt/conversation-histroy/history-panel'
import ConfigVision from '../config-vision'
import useAnnotationConfig from '../toolbox/annotation/use-annotation-config'
import AgentTools from './agent/agent-tools'
import ConfigContext from '@/context/debug-configuration'
import ConfigPrompt from '@/app/components/app/configuration/config-prompt'
import ConfigVar from '@/app/components/app/configuration/config-var'
import { type ModelConfig, type PromptVariable } from '@/models/debug'
import type { AppType } from '@/types/app'
import { ModelModeType } from '@/types/app'
import ConfigParamModal from '@/app/components/app/configuration/toolbox/annotation/config-param-modal'
import AnnotationFullModal from '@/app/components/billing/annotation-full/modal'

const Config: FC = () => {
  const {
    appId,
    mode,
    isAdvancedMode,
    modelModeType,
    isAgent,
    // canReturnToSimpleMode,
    // setPromptMode,
    hasSetBlockStatus,
    showHistoryModal,
    modelConfig,
    setModelConfig,
    setPrevPromptConfig,
    annotationConfig,
    setAnnotationConfig,
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

  const {
    handleEnableAnnotation,
    // setScore,
    // handleDisableAnnotation,
    isShowAnnotationConfigInit,
    setIsShowAnnotationConfigInit,
    isShowAnnotationFullModal,
    setIsShowAnnotationFullModal,
  } = useAnnotationConfig({
    appId,
    annotationConfig,
    setAnnotationConfig,
  })

  return (
    <>
      <div
        className="grow h-0 relative px-6 pb-[50px] overflow-y-auto"
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

        {/* Chat History */}
        {isAdvancedMode && isChatApp && modelModeType === ModelModeType.completion && (
          <HistoryPanel
            showWarning={!hasSetBlockStatus.history}
            onShowEditModal={showHistoryModal}
          />
        )}

        <ConfigParamModal
          appId={appId}
          isInit
          isShow={isShowAnnotationConfigInit}
          onHide={() => {
            setIsShowAnnotationConfigInit(false)
            // showChooseFeatureTrue()
          }}
          onSave={async (embeddingModel, score) => {
            await handleEnableAnnotation(embeddingModel, score)
            setIsShowAnnotationConfigInit(false)
          }}
          annotationConfig={annotationConfig}
        />
        {isShowAnnotationFullModal && (
          <AnnotationFullModal
            show={isShowAnnotationFullModal}
            onHide={() => setIsShowAnnotationFullModal(false)}
          />
        )}
      </div>
    </>
  )
}
export default React.memo(Config)
