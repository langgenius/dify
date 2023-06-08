'use client'
import type { FC } from 'react'
import React from 'react'
import { useContext } from 'use-context-selector'
import produce from 'immer'
import { useBoolean } from 'ahooks'
import DatasetConfig from '../dataset-config'
import ChatGroup from '../features/chat-group'
import ExperienceEnchanceGroup from '../features/experience-enchance-group'
import Toolbox from '../toolbox'
import AddFeatureBtn from './feature/add-feature-btn'
import AutomaticBtn from './automatic/automatic-btn'
import type { AutomaticRes } from './automatic/get-automatic-res'
import GetAutomaticResModal from './automatic/get-automatic-res'
import ChooseFeature from './feature/choose-feature'
import useFeature from './feature/use-feature'
import ConfigContext from '@/context/debug-configuration'
import ConfigPrompt from '@/app/components/app/configuration/config-prompt'
import ConfigVar from '@/app/components/app/configuration/config-var'
import type { PromptVariable } from '@/models/debug'
import { AppType } from '@/types/app'

const Config: FC = () => {
  const {
    mode,
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
  } = useContext(ConfigContext)
  const isChatApp = mode === AppType.chat

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
  })

  const hasChatConfig = isChatApp && (featureConfig.openingStatement || featureConfig.suggestedQuestionsAfterAnswer)
  const hasToolbox = false

  const [showAutomatic, { setTrue: showAutomaticTrue, setFalse: showAutomaticFalse }] = useBoolean(false)
  const handleAutomaticRes = (res: AutomaticRes) => {
    const newModelConfig = produce(modelConfig, (draft) => {
      draft.configs.prompt_template = res.prompt
      draft.configs.prompt_variables = res.variables.map(key => ({ key, name: key, type: 'string', required: true }))
    })
    setModelConfig(newModelConfig)
    setPrevPromptConfig(modelConfig.configs)
    if (mode === AppType.chat)
      setIntroduction(res.opening_statement)
    showAutomaticFalse()
  }
  return (
    <>
      <div className="pb-[20px]">
        <div className='flex justify-between items-center mb-4'>
          <AddFeatureBtn onClick={showChooseFeatureTrue} />
          <AutomaticBtn onClick={showAutomaticTrue}/>
        </div>

        {showChooseFeature && (
          <ChooseFeature
            isShow={showChooseFeature}
            onClose={showChooseFeatureFalse}
            isChatApp={isChatApp}
            config={featureConfig}
            onChange={handleFeatureChange}
          />
        )}
        {showAutomatic && (
          <GetAutomaticResModal
            mode={mode as AppType}
            isShow={showAutomatic}
            onClose={showAutomaticFalse}
            onFinished={handleAutomaticRes}
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
