'use client'
import type { FC } from 'react'
import React, { useRef } from 'react'
import { useContext } from 'use-context-selector'
import produce from 'immer'
import { useBoolean, useScroll } from 'ahooks'
import { useFormattingChangedDispatcher } from '../debug/hooks'
import DatasetConfig from '../dataset-config'
import ChatGroup from '../features/chat-group'
import ExperienceEnchanceGroup from '../features/experience-enchance-group'
import Toolbox from '../toolbox'
import HistoryPanel from '../config-prompt/conversation-histroy/history-panel'
import ConfigVision from '../config-vision'
import useAnnotationConfig from '../toolbox/annotation/use-annotation-config'
import AddFeatureBtn from './feature/add-feature-btn'
import ChooseFeature from './feature/choose-feature'
import useFeature from './feature/use-feature'
import AgentTools from './agent/agent-tools'
import AdvancedModeWaring from '@/app/components/app/configuration/prompt-mode/advanced-mode-waring'
import ConfigContext from '@/context/debug-configuration'
import ConfigPrompt from '@/app/components/app/configuration/config-prompt'
import ConfigVar from '@/app/components/app/configuration/config-var'
import { type CitationConfig, type ModelConfig, type ModerationConfig, type MoreLikeThisConfig, PromptMode, type PromptVariable, type SpeechToTextConfig, type SuggestedQuestionsAfterAnswerConfig, type TextToSpeechConfig } from '@/models/debug'
import { AppType, ModelModeType } from '@/types/app'
import { useModalContext } from '@/context/modal-context'
import ConfigParamModal from '@/app/components/app/configuration/toolbox/annotation/config-param-modal'
import AnnotationFullModal from '@/app/components/billing/annotation-full/modal'
import { useDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'

const Config: FC = () => {
  const {
    appId,
    mode,
    isAdvancedMode,
    modelModeType,
    isAgent,
    canReturnToSimpleMode,
    setPromptMode,
    hasSetBlockStatus,
    showHistoryModal,
    introduction,
    setIntroduction,
    suggestedQuestions,
    setSuggestedQuestions,
    modelConfig,
    setModelConfig,
    setPrevPromptConfig,
    moreLikeThisConfig,
    setMoreLikeThisConfig,
    suggestedQuestionsAfterAnswerConfig,
    setSuggestedQuestionsAfterAnswerConfig,
    speechToTextConfig,
    setSpeechToTextConfig,
    textToSpeechConfig,
    setTextToSpeechConfig,
    citationConfig,
    setCitationConfig,
    annotationConfig,
    setAnnotationConfig,
    moderationConfig,
    setModerationConfig,
  } = useContext(ConfigContext)
  const isChatApp = mode === AppType.chat
  const { data: speech2textDefaultModel } = useDefaultModel(4)
  const { data: text2speechDefaultModel } = useDefaultModel(5)
  const { setShowModerationSettingModal } = useModalContext()
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

  const [showChooseFeature, {
    setTrue: showChooseFeatureTrue,
    setFalse: showChooseFeatureFalse,
  }] = useBoolean(false)
  const { featureConfig, handleFeatureChange } = useFeature({
    introduction,
    setIntroduction,
    moreLikeThis: moreLikeThisConfig.enabled,
    setMoreLikeThis: (value) => {
      setMoreLikeThisConfig(produce(moreLikeThisConfig, (draft: MoreLikeThisConfig) => {
        draft.enabled = value
      }))
    },
    suggestedQuestionsAfterAnswer: suggestedQuestionsAfterAnswerConfig.enabled,
    setSuggestedQuestionsAfterAnswer: (value) => {
      setSuggestedQuestionsAfterAnswerConfig(produce(suggestedQuestionsAfterAnswerConfig, (draft: SuggestedQuestionsAfterAnswerConfig) => {
        draft.enabled = value
      }))
      formattingChangedDispatcher()
    },
    speechToText: speechToTextConfig.enabled,
    setSpeechToText: (value) => {
      setSpeechToTextConfig(produce(speechToTextConfig, (draft: SpeechToTextConfig) => {
        draft.enabled = value
      }))
    },
    textToSpeech: textToSpeechConfig.enabled,
    setTextToSpeech: (value) => {
      setTextToSpeechConfig(produce(textToSpeechConfig, (draft: TextToSpeechConfig) => {
        draft.enabled = value
      }))
    },
    citation: citationConfig.enabled,
    setCitation: (value) => {
      setCitationConfig(produce(citationConfig, (draft: CitationConfig) => {
        draft.enabled = value
      }))
      formattingChangedDispatcher()
    },
    annotation: annotationConfig.enabled,
    setAnnotation: async (value) => {
      if (value) {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        setIsShowAnnotationConfigInit(true)
      }
      else {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        await handleDisableAnnotation(annotationConfig.embedding_model)
      }
    },
    moderation: moderationConfig.enabled,
    setModeration: (value) => {
      setModerationConfig(produce(moderationConfig, (draft: ModerationConfig) => {
        draft.enabled = value
      }))
      if (value && !moderationConfig.type) {
        setShowModerationSettingModal({
          payload: {
            enabled: true,
            type: 'keywords',
            config: {
              keywords: '',
              inputs_config: {
                enabled: true,
                preset_response: '',
              },
            },
          },
          onSaveCallback: setModerationConfig,
          onCancelCallback: () => {
            setModerationConfig(produce(moderationConfig, (draft: ModerationConfig) => {
              draft.enabled = false
              showChooseFeatureTrue()
            }))
          },
        })
        showChooseFeatureFalse()
      }
    },
  })

  const {
    handleEnableAnnotation,
    setScore,
    handleDisableAnnotation,
    isShowAnnotationConfigInit,
    setIsShowAnnotationConfigInit,
    isShowAnnotationFullModal,
    setIsShowAnnotationFullModal,
  } = useAnnotationConfig({
    appId,
    annotationConfig,
    setAnnotationConfig,
  })

  const hasChatConfig = isChatApp && (featureConfig.openingStatement || featureConfig.suggestedQuestionsAfterAnswer || (featureConfig.speechToText && !!speech2textDefaultModel) || (featureConfig.textToSpeech && !!text2speechDefaultModel) || featureConfig.citation)
  const hasCompletionConfig = !isChatApp && (moreLikeThisConfig.enabled || (featureConfig.textToSpeech && !!text2speechDefaultModel))

  const hasToolbox = moderationConfig.enabled || featureConfig.annotation

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
        className="grow h-0 relative px-6 pb-[50px] overflow-y-auto"
      >
        <AddFeatureBtn toBottomHeight={toBottomHeight} onClick={showChooseFeatureTrue} />
        {
          (isAdvancedMode && canReturnToSimpleMode && !isAgent) && (
            <AdvancedModeWaring onReturnToSimpleMode={() => setPromptMode(PromptMode.simple)} />
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
            showTextToSpeechItem={!!text2speechDefaultModel}
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

        {/* Tools */}
        {(isAgent && isChatApp) && (
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

        {/* ChatConifig */}
        {
          hasChatConfig && (
            <ChatGroup
              isShowOpeningStatement={featureConfig.openingStatement}
              openingStatementConfig={
                {
                  value: introduction,
                  onChange: setIntroduction,
                  suggestedQuestions,
                  onSuggestedQuestionsChange: setSuggestedQuestions,
                }
              }
              isShowSuggestedQuestionsAfterAnswer={featureConfig.suggestedQuestionsAfterAnswer}
              isShowTextToSpeech={featureConfig.textToSpeech && !!text2speechDefaultModel}
              isShowSpeechText={featureConfig.speechToText && !!speech2textDefaultModel}
              isShowCitation={featureConfig.citation}
            />
          )
        }

        {/* Text Generation config */}{
          hasCompletionConfig && (
            <ExperienceEnchanceGroup
              isShowMoreLike={moreLikeThisConfig.enabled}
              isShowTextToSpeech={featureConfig.textToSpeech && !!text2speechDefaultModel}
            />
          )
        }

        {/* Toolbox */}
        {
          hasToolbox && (
            <Toolbox
              showModerationSettings={moderationConfig.enabled}
              showAnnotation={isChatApp && featureConfig.annotation}
              onEmbeddingChange={handleEnableAnnotation}
              onScoreChange={setScore}
            />
          )
        }

        <ConfigParamModal
          appId={appId}
          isInit
          isShow={isShowAnnotationConfigInit}
          onHide={() => {
            setIsShowAnnotationConfigInit(false)
            showChooseFeatureTrue()
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
