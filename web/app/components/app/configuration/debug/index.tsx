'use client'
import type { FC } from 'react'
import type { DebugWithSingleModelRefType } from './debug-with-single-model'
import type { ModelAndParameter } from './types'
import type { ModelParameterModalProps } from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import type { Inputs } from '@/models/debug'
import type { ModelConfig as BackendModelConfig, VisionFile, VisionSettings } from '@/types/app'
import {
  RiAddLine,
  RiEqualizer2Line,
  RiSparklingFill,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { noop } from 'es-toolkit/function'
import { cloneDeep } from 'es-toolkit/object'
import { produce, setAutoFreeze } from 'immer'
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useShallow } from 'zustand/react/shallow'
import ChatUserInput from '@/app/components/app/configuration/debug/chat-user-input'
import PromptValuePanel from '@/app/components/app/configuration/prompt-value-panel'
import { useStore as useAppStore } from '@/app/components/app/store'
import TextGeneration from '@/app/components/app/text-generate/item'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import AgentLogModal from '@/app/components/base/agent-log-modal'
import Button from '@/app/components/base/button'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import { RefreshCcw01 } from '@/app/components/base/icons/src/vender/line/arrows'
import PromptLogModal from '@/app/components/base/prompt-log-modal'
import { ToastContext } from '@/app/components/base/toast'
import TooltipPlus from '@/app/components/base/tooltip'
import { ModelFeatureEnum, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG, IS_CE_EDITION } from '@/config'
import ConfigContext from '@/context/debug-configuration'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useProviderContext } from '@/context/provider-context'
import { sendCompletionMessage } from '@/service/debug'
import { AppSourceType } from '@/service/share'
import { AppModeEnum, ModelModeType, TransferMethod } from '@/types/app'
import { formatBooleanInputs, promptVariablesToUserInputsForm } from '@/utils/model-config'
import GroupName from '../base/group-name'
import CannotQueryDataset from '../base/warning-mask/cannot-query-dataset'
import FormattingChanged from '../base/warning-mask/formatting-changed'
import HasNotSetAPIKEY from '../base/warning-mask/has-not-set-api'
import DebugWithMultipleModel from './debug-with-multiple-model'
import DebugWithSingleModel from './debug-with-single-model'
import {
  APP_CHAT_WITH_MULTIPLE_MODEL,
  APP_CHAT_WITH_MULTIPLE_MODEL_RESTART,
} from './types'

type IDebug = {
  isAPIKeySet: boolean
  onSetting: () => void
  inputs: Inputs
  modelParameterParams: Pick<ModelParameterModalProps, 'setModel' | 'onCompletionParamsChange'>
  debugWithMultipleModel: boolean
  multipleModelConfigs: ModelAndParameter[]
  onMultipleModelConfigsChange: (multiple: boolean, modelConfigs: ModelAndParameter[]) => void
}

const Debug: FC<IDebug> = ({
  isAPIKeySet = true,
  onSetting,
  inputs,
  modelParameterParams,
  debugWithMultipleModel,
  multipleModelConfigs,
  onMultipleModelConfigsChange,
}) => {
  const { t } = useTranslation()
  const {
    readonly,
    appId,
    mode,
    modelModeType,
    hasSetBlockStatus,
    isAdvancedMode,
    promptMode,
    chatPromptConfig,
    completionPromptConfig,
    introduction,
    suggestedQuestionsAfterAnswerConfig,
    speechToTextConfig,
    textToSpeechConfig,
    citationConfig,
    formattingChanged,
    setFormattingChanged,
    dataSets,
    modelConfig,
    completionParams,
    hasSetContextVar,
    datasetConfigs,
    externalDataToolsConfig,
  } = useContext(ConfigContext)
  const { eventEmitter } = useEventEmitterContextContext()
  const { data: text2speechDefaultModel } = useDefaultModel(ModelTypeEnum.textEmbedding)
  useEffect(() => {
    setAutoFreeze(false)
    return () => {
      setAutoFreeze(true)
    }
  }, [])

  const [isResponding, { setTrue: setRespondingTrue, setFalse: setRespondingFalse }] = useBoolean(false)
  const [isShowFormattingChangeConfirm, setIsShowFormattingChangeConfirm] = useState(false)
  const [isShowCannotQueryDataset, setShowCannotQueryDataset] = useState(false)

  useEffect(() => {
    if (formattingChanged)
      setIsShowFormattingChangeConfirm(true)
  }, [formattingChanged])

  const debugWithSingleModelRef = React.useRef<DebugWithSingleModelRefType>(null!)
  const handleClearConversation = () => {
    debugWithSingleModelRef.current?.handleRestart()
  }
  const clearConversation = async () => {
    if (debugWithMultipleModel) {
      eventEmitter?.emit({
        type: APP_CHAT_WITH_MULTIPLE_MODEL_RESTART,
      } as any)
      return
    }

    handleClearConversation()
  }

  const handleConfirm = () => {
    clearConversation()
    setIsShowFormattingChangeConfirm(false)
    setFormattingChanged(false)
  }

  const handleCancel = () => {
    setIsShowFormattingChangeConfirm(false)
    setFormattingChanged(false)
  }

  const { notify } = useContext(ToastContext)
  const logError = useCallback((message: string) => {
    notify({ type: 'error', message })
  }, [notify])
  const [completionFiles, setCompletionFiles] = useState<VisionFile[]>([])

  const checkCanSend = useCallback(() => {
    if (isAdvancedMode && mode !== AppModeEnum.COMPLETION) {
      if (modelModeType === ModelModeType.completion) {
        if (!hasSetBlockStatus.history) {
          notify({ type: 'error', message: t('otherError.historyNoBeEmpty', { ns: 'appDebug' }) })
          return false
        }
        if (!hasSetBlockStatus.query) {
          notify({ type: 'error', message: t('otherError.queryNoBeEmpty', { ns: 'appDebug' }) })
          return false
        }
      }
    }
    let hasEmptyInput = ''
    const requiredVars = modelConfig.configs.prompt_variables.filter(({ key, name, required, type }) => {
      if (type !== 'string' && type !== 'paragraph' && type !== 'select' && type !== 'number')
        return false
      const res = (!key || !key.trim()) || (!name || !name.trim()) || (required || required === undefined || required === null)
      return res
    }) // compatible with old version
    requiredVars.forEach(({ key, name }) => {
      if (hasEmptyInput)
        return

      if (!inputs[key])
        hasEmptyInput = name
    })

    if (hasEmptyInput) {
      logError(t('errorMessage.valueOfVarRequired', { ns: 'appDebug', key: hasEmptyInput }))
      return false
    }

    if (completionFiles.find(item => item.transfer_method === TransferMethod.local_file && !item.upload_file_id)) {
      notify({ type: 'info', message: t('errorMessage.waitForFileUpload', { ns: 'appDebug' }) })
      return false
    }
    return !hasEmptyInput
  }, [
    completionFiles,
    hasSetBlockStatus.history,
    hasSetBlockStatus.query,
    inputs,
    isAdvancedMode,
    mode,
    modelConfig.configs.prompt_variables,
    t,
    logError,
    notify,
    modelModeType,
  ])

  const [completionRes, setCompletionRes] = useState('')
  const [messageId, setMessageId] = useState<string | null>(null)
  const features = useFeatures(s => s.features)
  const featuresStore = useFeaturesStore()

  const sendTextCompletion = async () => {
    if (isResponding) {
      notify({ type: 'info', message: t('errorMessage.waitForResponse', { ns: 'appDebug' }) })
      return false
    }

    if (dataSets.length > 0 && !hasSetContextVar) {
      setShowCannotQueryDataset(true)
      return true
    }

    if (!checkCanSend())
      return

    const postDatasets = dataSets.map(({ id }) => ({
      dataset: {
        enabled: true,
        id,
      },
    }))
    const contextVar = modelConfig.configs.prompt_variables.find(item => item.is_context_var)?.key

    const postModelConfig: BackendModelConfig = {
      pre_prompt: !isAdvancedMode ? modelConfig.configs.prompt_template : '',
      prompt_type: promptMode,
      chat_prompt_config: isAdvancedMode ? chatPromptConfig : cloneDeep(DEFAULT_CHAT_PROMPT_CONFIG),
      completion_prompt_config: isAdvancedMode ? completionPromptConfig : cloneDeep(DEFAULT_COMPLETION_PROMPT_CONFIG),
      user_input_form: promptVariablesToUserInputsForm(modelConfig.configs.prompt_variables),
      dataset_query_variable: contextVar || '',
      dataset_configs: {
        ...datasetConfigs,
        datasets: {
          datasets: [...postDatasets],
        } as any,
      },
      agent_mode: {
        enabled: false,
        tools: [],
      },
      model: {
        provider: modelConfig.provider,
        name: modelConfig.model_id,
        mode: modelConfig.mode,
        completion_params: completionParams as any,
      },
      more_like_this: features.moreLikeThis as any,
      sensitive_word_avoidance: features.moderation as any,
      text_to_speech: features.text2speech as any,
      file_upload: features.file as any,
      opening_statement: introduction,
      suggested_questions_after_answer: suggestedQuestionsAfterAnswerConfig,
      speech_to_text: speechToTextConfig,
      retriever_resource: citationConfig,
      system_parameters: modelConfig.system_parameters,
      external_data_tools: externalDataToolsConfig,
    }

    const data: Record<string, any> = {
      inputs: formatBooleanInputs(modelConfig.configs.prompt_variables, inputs),
      model_config: postModelConfig,
    }

    if ((features.file as any).enabled && completionFiles && completionFiles?.length > 0) {
      data.files = completionFiles.map((item) => {
        if (item.transfer_method === TransferMethod.local_file) {
          return {
            ...item,
            url: '',
          }
        }
        return item
      })
    }

    setCompletionRes('')
    setMessageId('')
    let res: string[] = []

    setRespondingTrue()
    sendCompletionMessage(appId, data, {
      onData: (data: string, _isFirstMessage: boolean, { messageId }) => {
        res.push(data)
        setCompletionRes(res.join(''))
        setMessageId(messageId)
      },
      onMessageReplace: (messageReplace) => {
        res = [messageReplace.answer]
        setCompletionRes(res.join(''))
      },
      onCompleted() {
        setRespondingFalse()
      },
      onError() {
        setRespondingFalse()
      },
    })
  }

  const handleSendTextCompletion = () => {
    if (debugWithMultipleModel) {
      eventEmitter?.emit({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: {
          message: '',
          files: completionFiles,
        },
      } as any)
      return
    }

    sendTextCompletion()
  }

  const varList = modelConfig.configs.prompt_variables.map((item: any) => {
    return {
      label: item.key,
      value: inputs[item.key],
    }
  })

  const { textGenerationModelList } = useProviderContext()
  const handleChangeToSingleModel = (item: ModelAndParameter) => {
    const currentProvider = textGenerationModelList.find(modelItem => modelItem.provider === item.provider)
    const currentModel = currentProvider?.models.find(model => model.model === item.model)

    modelParameterParams.setModel({
      modelId: item.model,
      provider: item.provider,
      mode: currentModel?.model_properties.mode as string,
      features: currentModel?.features,
    })
    modelParameterParams.onCompletionParamsChange(item.parameters)
    onMultipleModelConfigsChange(
      false,
      [],
    )
  }

  const handleVisionConfigInMultipleModel = useCallback(() => {
    if (debugWithMultipleModel && mode) {
      const supportedVision = multipleModelConfigs.some((modelConfig) => {
        const currentProvider = textGenerationModelList.find(modelItem => modelItem.provider === modelConfig.provider)
        const currentModel = currentProvider?.models.find(model => model.model === modelConfig.model)

        return currentModel?.features?.includes(ModelFeatureEnum.vision)
      })
      const {
        features,
        setFeatures,
      } = featuresStore!.getState()

      const newFeatures = produce(features, (draft) => {
        draft.file = {
          ...draft.file,
          enabled: supportedVision,
        }
      })
      setFeatures(newFeatures)
    }
  }, [debugWithMultipleModel, featuresStore, mode, multipleModelConfigs, textGenerationModelList])

  useEffect(() => {
    handleVisionConfigInMultipleModel()
  }, [multipleModelConfigs, mode, handleVisionConfigInMultipleModel])

  const { currentLogItem, setCurrentLogItem, showPromptLogModal, setShowPromptLogModal, showAgentLogModal, setShowAgentLogModal } = useAppStore(useShallow(state => ({
    currentLogItem: state.currentLogItem,
    setCurrentLogItem: state.setCurrentLogItem,
    showPromptLogModal: state.showPromptLogModal,
    setShowPromptLogModal: state.setShowPromptLogModal,
    showAgentLogModal: state.showAgentLogModal,
    setShowAgentLogModal: state.setShowAgentLogModal,
  })))
  const [width, setWidth] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const adjustModalWidth = () => {
    if (ref.current)
      setWidth(document.body.clientWidth - (ref.current?.clientWidth + 16) - 8)
  }

  useEffect(() => {
    adjustModalWidth()
  }, [])

  const [expanded, setExpanded] = useState(true)

  return (
    <>
      <div className="shrink-0">
        <div className="flex items-center justify-between px-4 pb-2 pt-3">
          <div className="system-xl-semibold text-text-primary">{t('inputs.title', { ns: 'appDebug' })}</div>
          <div className="flex items-center">
            {
              debugWithMultipleModel
                ? (
                    <>
                      <Button
                        variant="ghost-accent"
                        onClick={() => onMultipleModelConfigsChange(true, [...multipleModelConfigs, { id: `${Date.now()}`, model: '', provider: '', parameters: {} }])}
                        disabled={multipleModelConfigs.length >= 4}
                      >
                        <RiAddLine className="mr-1 h-3.5 w-3.5" />
                        {t('modelProvider.addModel', { ns: 'common' })}
                        (
                        {multipleModelConfigs.length}
                        /4)
                      </Button>
                      <div className="mx-2 h-[14px] w-[1px] bg-divider-regular" />
                    </>
                  )
                : null
            }
            {mode !== AppModeEnum.COMPLETION && (
              <>
                {
                  !readonly && (
                    <TooltipPlus
                      popupContent={t('operation.refresh', { ns: 'common' })}
                    >
                      <ActionButton onClick={clearConversation}>
                        <RefreshCcw01 className="h-4 w-4" />
                      </ActionButton>

                    </TooltipPlus>
                  )
                }

                {
                  varList.length > 0 && (
                    <div className="relative ml-1 mr-2">
                      <TooltipPlus
                        popupContent={t('panel.userInputField', { ns: 'workflow' })}
                      >
                        <ActionButton state={expanded ? ActionButtonState.Active : undefined} onClick={() => !readonly && setExpanded(!expanded)}>
                          <RiEqualizer2Line className="h-4 w-4" />
                        </ActionButton>
                      </TooltipPlus>
                      {expanded && <div className="absolute bottom-[-14px] right-[5px] z-10 h-3 w-3 rotate-45 border-l-[0.5px] border-t-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg" />}
                    </div>
                  )
                }
              </>
            )}
          </div>
        </div>
        {mode !== AppModeEnum.COMPLETION && expanded && (
          <div className="mx-3">
            <ChatUserInput inputs={inputs} />
          </div>
        )}
        {
          mode === AppModeEnum.COMPLETION && (
            <PromptValuePanel
              appType={mode as AppModeEnum}
              onSend={handleSendTextCompletion}
              inputs={inputs}
              visionConfig={{
                ...features.file! as VisionSettings,
                transfer_methods: features.file!.allowed_file_upload_methods || [],
                image_file_size_limit: features.file?.fileUploadConfig?.image_file_size_limit,
              }}
              onVisionFilesChange={setCompletionFiles}
            />
          )
        }
      </div>
      {
        debugWithMultipleModel && (
          <div className="mt-3 grow overflow-hidden" ref={ref}>
            <DebugWithMultipleModel
              multipleModelConfigs={multipleModelConfigs}
              onMultipleModelConfigsChange={onMultipleModelConfigsChange}
              onDebugWithMultipleModelChange={handleChangeToSingleModel}
              checkCanSend={checkCanSend}
            />
            {showPromptLogModal && (
              <PromptLogModal
                width={width}
                currentLogItem={currentLogItem}
                onCancel={() => {
                  setCurrentLogItem()
                  setShowPromptLogModal(false)
                }}
              />
            )}
            {showAgentLogModal && (
              <AgentLogModal
                width={width}
                currentLogItem={currentLogItem}
                onCancel={() => {
                  setCurrentLogItem()
                  setShowAgentLogModal(false)
                }}
              />
            )}
          </div>
        )
      }
      {
        !debugWithMultipleModel && (
          <div className="flex grow flex-col" ref={ref}>
            {/* Chat */}
            {mode !== AppModeEnum.COMPLETION && (
              <div className="h-0 grow overflow-hidden">
                <DebugWithSingleModel
                  ref={debugWithSingleModelRef}
                  checkCanSend={checkCanSend}
                />
              </div>
            )}
            {/* Text  Generation */}
            {mode === AppModeEnum.COMPLETION && (
              <>
                {(completionRes || isResponding) && (
                  <>
                    <div className="mx-4 mt-3"><GroupName name={t('result', { ns: 'appDebug' })} /></div>
                    <div className="mx-3 mb-8">
                      <TextGeneration
                        appSourceType={AppSourceType.webApp}
                        className="mt-2"
                        content={completionRes}
                        isLoading={!completionRes && isResponding}
                        isShowTextToSpeech={textToSpeechConfig.enabled && !!text2speechDefaultModel}
                        isResponding={isResponding}
                        messageId={messageId}
                        isError={false}
                        onRetry={noop}
                        siteInfo={null}
                      />
                    </div>
                  </>
                )}
                {!completionRes && !isResponding && (
                  <div className="flex grow flex-col items-center justify-center gap-2">
                    <RiSparklingFill className="h-12 w-12 text-text-empty-state-icon" />
                    <div className="system-sm-regular text-text-quaternary">{t('noResult', { ns: 'appDebug' })}</div>
                  </div>
                )}
              </>
            )}
            {mode === AppModeEnum.COMPLETION && showPromptLogModal && (
              <PromptLogModal
                width={width}
                currentLogItem={currentLogItem}
                onCancel={() => {
                  setCurrentLogItem()
                  setShowPromptLogModal(false)
                }}
              />
            )}
            {isShowCannotQueryDataset && (
              <CannotQueryDataset
                onConfirm={() => setShowCannotQueryDataset(false)}
              />
            )}
          </div>
        )
      }
      {
        isShowFormattingChangeConfirm && (
          <FormattingChanged
            onConfirm={handleConfirm}
            onCancel={handleCancel}
          />
        )
      }
      {!isAPIKeySet && !readonly && (<HasNotSetAPIKEY isTrailFinished={!IS_CE_EDITION} onSetting={onSetting} />)}
    </>
  )
}
export default React.memo(Debug)
