'use client'
import type { FC } from 'react'
import React, { useRef } from 'react'
import { useContext } from 'use-context-selector'
import produce from 'immer'
import { useBoolean, useScroll } from 'ahooks'
import DatasetConfig from '../dataset-config'
import ChatGroup from '../features/chat-group'
import ExperienceEnchanceGroup from '../features/experience-enchance-group'
import Toolbox from '../toolbox'
import HistoryPanel from '../config-prompt/conversation-histroy/history-panel'
import AddFeatureBtn from './feature/add-feature-btn'
import ChooseFeature from './feature/choose-feature'
import useFeature from './feature/use-feature'
import AdvancedModeWaring from '@/app/components/app/configuration/prompt-mode/advanced-mode-waring'
import ConfigContext from '@/context/debug-configuration'
import ConfigPrompt from '@/app/components/app/configuration/config-prompt'
import ConfigVar from '@/app/components/app/configuration/config-var'
import type { PromptVariable } from '@/models/debug'
import { AppType, ModelModeType } from '@/types/app'
import { useProviderContext } from '@/context/provider-context'
const Config: FC = () => {
  const {
    mode,
    isAdvancedMode,
    modelModeType,
    canReturnToSimpleMode,
    hasSetBlockStatus,
    showHistoryModal,
    introduction,
    setIntroduction,
    modelConfig,
    setModelConfig,
    setPrevPromptConfig,
    setFormattingChanged,
    moreLikeThisConfig,
    setMoreLikeThisConfig,
    suggestedQuestionsAfterAnswerConfig,
    setSuggestedQuestionsAfterAnswerConfig,
    speechToTextConfig,
    setSpeechToTextConfig,
    citationConfig,
    setCitationConfig,
  } = useContext(ConfigContext)
  const isChatApp = mode === AppType.chat
  const { speech2textDefaultModel } = useProviderContext()

  const promptTemplate = modelConfig.configs.prompt_template
  const promptVariables = modelConfig.configs.prompt_variables
  const handlePromptChange = (newTemplate: string, newVariables: PromptVariable[]) => {
    const newModelConfig = produce(modelConfig, (draft) => {
      draft.configs.prompt_template = newTemplate
      draft.configs.prompt_variables = [...draft.configs.prompt_variables, ...newVariables]
    })

    if (modelConfig.configs.prompt_template !== newTemplate)
      setFormattingChanged(true)

    setPrevPromptConfig(modelConfig.configs)
    setModelConfig(newModelConfig)
  }

  const handlePromptVariablesNameChange = (newVariables: PromptVariable[]) => {
    setPrevPromptConfig(modelConfig.configs)
    const newModelConfig = produce(modelConfig, (draft) => {
      draft.configs.prompt_variables = newVariables
    })
    setModelConfig(newModelConfig)
  }

  const [showChooseFeature, {
    setTrue: showChooseFeatureTrue,
    setFalse: showChooseFeatureFalse,
  }] = useBoolean(false)
  const { featureConfig, handleFeatureChange } = useFeature({
    introduction,
    setIntroduction,
    moreLikeThis: moreLikeThisConfig.enabled,
    setMoreLikeThis: (value) => {
      setMoreLikeThisConfig(produce(moreLikeThisConfig, (draft) => {
        draft.enabled = value
      }))
    },
    suggestedQuestionsAfterAnswer: suggestedQuestionsAfterAnswerConfig.enabled,
    setSuggestedQuestionsAfterAnswer: (value) => {
      setSuggestedQuestionsAfterAnswerConfig(produce(suggestedQuestionsAfterAnswerConfig, (draft) => {
        draft.enabled = value
      }))
    },
    speechToText: speechToTextConfig.enabled,
    setSpeechToText: (value) => {
      setSpeechToTextConfig(produce(speechToTextConfig, (draft) => {
        draft.enabled = value
      }))
    },
    citation: citationConfig.enabled,
    setCitation: (value) => {
      setCitationConfig(produce(citationConfig, (draft) => {
        draft.enabled = value
      }))
    },
  })

  const hasChatConfig = isChatApp && (featureConfig.openingStatement || featureConfig.suggestedQuestionsAfterAnswer || (featureConfig.speechToText && !!speech2textDefaultModel) || featureConfig.citation)
  const hasToolbox = false

  const wrapRef = useRef<HTMLDivElement>(null)
  const wrapScroll = useScroll(wrapRef)
  const toBottomHeight = (() => {
    if (!wrapRef.current)
      return 999
    const elem = wrapRef.current
    const { clientHeight } = elem
    const value = (wrapScroll?.top || 0) + clientHeight
    return value
  })()

  return (
    <>
      <div
        ref={wrapRef}
        className="relative pb-4 px-6 pb-[20px] overflow-y-auto h-full"
      >
        <AddFeatureBtn toBottomHeight={toBottomHeight} onClick={showChooseFeatureTrue} />
        {
          (isAdvancedMode && canReturnToSimpleMode) && (
            <AdvancedModeWaring />
          )
        }
        {showChooseFeature && (
          <ChooseFeature
            isShow={showChooseFeature}
            onClose={showChooseFeatureFalse}
            isChatApp={isChatApp}
            config={featureConfig}
            onChange={handleFeatureChange}
            showSpeechToTextItem={!!speech2textDefaultModel}
          />
        )}

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

        {/* Chat History */}
        {isAdvancedMode && isChatApp && modelModeType === ModelModeType.completion && (
          <HistoryPanel
            showWarning={!hasSetBlockStatus.history}
            onShowEditModal={showHistoryModal}
          />
        )}

        {/* ChatConifig */}
        {
          hasChatConfig && (
            <ChatGroup
              isShowOpeningStatement={featureConfig.openingStatement}
              openingStatementConfig={
                {
                  value: introduction,
                  onChange: setIntroduction,
                }
              }
              isShowSuggestedQuestionsAfterAnswer={featureConfig.suggestedQuestionsAfterAnswer}
              isShowSpeechText={featureConfig.speechToText && !!speech2textDefaultModel}
              isShowCitation={featureConfig.citation}
            />
          )
        }

        {/* TextnGeneration config */}
        {moreLikeThisConfig.enabled && (
          <ExperienceEnchanceGroup />
        )}

        {/* Toolbox */}
        {
          hasToolbox && (
            <Toolbox searchToolConfig={false} sensitiveWordAvoidanceConifg={false} />
          )
        }
      </div>
    </>
  )
}
export default React.memo(Config)
