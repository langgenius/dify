'use client'
import type { FC } from 'react'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { setAutoFreeze } from 'immer'
import { useBoolean } from 'ahooks'
import { useContext } from 'use-context-selector'
import { useShallow } from 'zustand/react/shallow'
import HasNotSetAPIKEY from '../base/warning-mask/has-not-set-api'
import FormattingChanged from '../base/warning-mask/formatting-changed'
import GroupName from '../base/group-name'
import CannotQueryDataset from '../base/warning-mask/cannot-query-dataset'
import DebugWithMultipleModel from './debug-with-multiple-model'
import DebugWithSingleModel from './debug-with-single-model'
import type { DebugWithSingleModelRefType } from './debug-with-single-model'
import type { ModelAndParameter } from './types'
import {
  APP_CHAT_WITH_MULTIPLE_MODEL,
  APP_CHAT_WITH_MULTIPLE_MODEL_RESTART,
} from './types'
import { AppType, ModelModeType, TransferMethod } from '@/types/app'
import PromptValuePanel from '@/app/components/app/configuration/prompt-value-panel'
import ConfigContext from '@/context/debug-configuration'
import { ToastContext } from '@/app/components/base/toast'
import { sendCompletionMessage } from '@/service/debug'
import Button from '@/app/components/base/button'
import type { ModelConfig as BackendModelConfig, VisionFile } from '@/types/app'
import { promptVariablesToUserInputsForm } from '@/utils/model-config'
import TextGeneration from '@/app/components/app/text-generate/item'
import { IS_CE_EDITION } from '@/config'
import type { Inputs } from '@/models/debug'
import { fetchFileUploadConfig } from '@/service/common'
import { useDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelFeatureEnum, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ModelParameterModalProps } from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { Plus } from '@/app/components/base/icons/src/vender/line/general'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useProviderContext } from '@/context/provider-context'
import PromptLogModal from '@/app/components/base/prompt-log-modal'
import { useStore as useAppStore } from '@/app/components/app/store'

type IDebug = {
  hasSetAPIKEY: boolean
  onSetting: () => void
  inputs: Inputs
  modelParameterParams: Pick<ModelParameterModalProps, 'setModel' | 'onCompletionParamsChange'>
  debugWithMultipleModel: boolean
  multipleModelConfigs: ModelAndParameter[]
  onMultipleModelConfigsChange: (multiple: boolean, modelConfigs: ModelAndParameter[]) => void
}

const Debug: FC<IDebug> = ({
  hasSetAPIKEY = true,
  onSetting,
  inputs,
  modelParameterParams,
  debugWithMultipleModel,
  multipleModelConfigs,
  onMultipleModelConfigsChange,
}) => {
  const { t } = useTranslation()
  const {
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
    moderationConfig,
    moreLikeThisConfig,
    formattingChanged,
    setFormattingChanged,
    dataSets,
    modelConfig,
    completionParams,
    hasSetContextVar,
    datasetConfigs,
    visionConfig,
    setVisionConfig,
  } = useContext(ConfigContext)
  const { eventEmitter } = useEventEmitterContextContext()
  const { data: text2speechDefaultModel } = useDefaultModel(ModelTypeEnum.textEmbedding)
  const { data: fileUploadConfigResponse } = useSWR({ url: '/files/upload' }, fetchFileUploadConfig)
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

  const debugWithSingleModelRef = React.useRef<DebugWithSingleModelRefType | null>(null)
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
    notify({ type: 'error', message, duration: 3000 })
  }, [notify])
  const [completionFiles, setCompletionFiles] = useState<VisionFile[]>([])

  const checkCanSend = useCallback(() => {
    if (isAdvancedMode && mode !== AppType.completion) {
      if (modelModeType === ModelModeType.completion) {
        if (!hasSetBlockStatus.history) {
          notify({ type: 'error', message: t('appDebug.otherError.historyNoBeEmpty'), duration: 3000 })
          return false
        }
        if (!hasSetBlockStatus.query) {
          notify({ type: 'error', message: t('appDebug.otherError.queryNoBeEmpty'), duration: 3000 })
          return false
        }
      }
    }
    let hasEmptyInput = ''
    const requiredVars = modelConfig.configs.prompt_variables.filter(({ key, name, required, type }) => {
      if (type !== 'string' && type !== 'paragraph' && type !== 'select')
        return false
      const res = (!key || !key.trim()) || (!name || !name.trim()) || (required || required === undefined || required === null)
      return res
    }) // compatible with old version
    // debugger
    requiredVars.forEach(({ key, name }) => {
      if (hasEmptyInput)
        return

      if (!inputs[key])
        hasEmptyInput = name
    })

    if (hasEmptyInput) {
      logError(t('appDebug.errorMessage.valueOfVarRequired', { key: hasEmptyInput }))
      return false
    }

    if (completionFiles.find(item => item.transfer_method === TransferMethod.local_file && !item.upload_file_id)) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForImgUpload') })
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

  const sendTextCompletion = async () => {
    if (isResponding) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForResponse') })
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
      chat_prompt_config: {},
      completion_prompt_config: {},
      user_input_form: promptVariablesToUserInputsForm(modelConfig.configs.prompt_variables),
      dataset_query_variable: contextVar || '',
      opening_statement: introduction,
      suggested_questions_after_answer: suggestedQuestionsAfterAnswerConfig,
      speech_to_text: speechToTextConfig,
      retriever_resource: citationConfig,
      sensitive_word_avoidance: moderationConfig,
      more_like_this: moreLikeThisConfig,
      model: {
        provider: modelConfig.provider,
        name: modelConfig.model_id,
        mode: modelConfig.mode,
        completion_params: completionParams as any,
      },
      text_to_speech: {
        enabled: false,
        voice: '',
        language: '',
      },
      agent_mode: {
        enabled: false,
        tools: [],
      },
      dataset_configs: {
        ...datasetConfigs,
        datasets: {
          datasets: [...postDatasets],
        } as any,
      },
      file_upload: {
        image: visionConfig,
      },
    }

    if (isAdvancedMode) {
      postModelConfig.chat_prompt_config = chatPromptConfig
      postModelConfig.completion_prompt_config = completionPromptConfig
    }

    const data: Record<string, any> = {
      inputs,
      model_config: postModelConfig,
    }

    if (visionConfig.enabled && completionFiles && completionFiles?.length > 0) {
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

  const handleVisionConfigInMultipleModel = () => {
    if (debugWithMultipleModel && mode) {
      const supportedVision = multipleModelConfigs.some((modelConfig) => {
        const currentProvider = textGenerationModelList.find(modelItem => modelItem.provider === modelConfig.provider)
        const currentModel = currentProvider?.models.find(model => model.model === modelConfig.model)

        return currentModel?.features?.includes(ModelFeatureEnum.vision)
      })

      if (supportedVision) {
        setVisionConfig({
          ...visionConfig,
          enabled: true,
        }, true)
      }
      else {
        setVisionConfig({
          ...visionConfig,
          enabled: false,
        }, true)
      }
    }
  }

  useEffect(() => {
    handleVisionConfigInMultipleModel()
  }, [multipleModelConfigs, mode])

  const { currentLogItem, setCurrentLogItem, showPromptLogModal, setShowPromptLogModal } = useAppStore(useShallow(state => ({
    currentLogItem: state.currentLogItem,
    setCurrentLogItem: state.setCurrentLogItem,
    showPromptLogModal: state.showPromptLogModal,
    setShowPromptLogModal: state.setShowPromptLogModal,
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

  return (
    <>
      <div className="shrink-0 pt-4 px-6">
        <div className='flex items-center justify-between mb-2'>
          <div className='h2 '>{t('appDebug.inputs.title')}</div>
          <div className='flex items-center'>
            {
              debugWithMultipleModel
                ? (
                  <>
                    <Button
                      className={`
                        h-8 px-2.5 text-[13px] font-medium text-primary-600 bg-white
                        ${multipleModelConfigs.length >= 4 && 'opacity-30'}
                      `}
                      onClick={() => onMultipleModelConfigsChange(true, [...multipleModelConfigs, { id: `${Date.now()}`, model: '', provider: '', parameters: {} }])}
                      disabled={multipleModelConfigs.length >= 4}
                    >
                      <Plus className='mr-1 w-3.5 h-3.5' />
                      {t('common.modelProvider.addModel')}({multipleModelConfigs.length}/4)
                    </Button>
                    <div className='mx-2 w-[1px] h-[14px] bg-gray-200' />
                  </>
                )
                : null
            }
            {mode !== AppType.completion && (
              <Button className='flex items-center gap-1 !h-8 !bg-white' onClick={clearConversation}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2.66663 2.66629V5.99963H3.05463M3.05463 5.99963C3.49719 4.90505 4.29041 3.98823 5.30998 3.39287C6.32954 2.7975 7.51783 2.55724 8.68861 2.70972C9.85938 2.8622 10.9465 3.39882 11.7795 4.23548C12.6126 5.07213 13.1445 6.16154 13.292 7.33296M3.05463 5.99963H5.99996M13.3333 13.333V9.99963H12.946M12.946 9.99963C12.5028 11.0936 11.7093 12.0097 10.6898 12.6045C9.67038 13.1993 8.48245 13.4393 7.31203 13.2869C6.1416 13.1344 5.05476 12.5982 4.22165 11.7621C3.38854 10.926 2.8562 9.83726 2.70796 8.66629M12.946 9.99963H9.99996" stroke="#1C64F2" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className='text-primary-600 text-[13px] font-semibold'>{t('common.operation.refresh')}</span>
              </Button>
            )}
          </div>
        </div>
        <PromptValuePanel
          appType={mode as AppType}
          onSend={handleSendTextCompletion}
          inputs={inputs}
          visionConfig={{
            ...visionConfig,
            image_file_size_limit: fileUploadConfigResponse?.image_file_size_limit,
          }}
          onVisionFilesChange={setCompletionFiles}
        />
      </div>
      {
        debugWithMultipleModel && (
          <div className='grow mt-3 overflow-hidden'>
            <DebugWithMultipleModel
              multipleModelConfigs={multipleModelConfigs}
              onMultipleModelConfigsChange={onMultipleModelConfigsChange}
              onDebugWithMultipleModelChange={handleChangeToSingleModel}
              checkCanSend={checkCanSend}
            />
          </div>
        )
      }
      {
        !debugWithMultipleModel && (
          <div className="flex flex-col grow" ref={ref}>
            {/* Chat */}
            {mode !== AppType.completion && (
              <div className='grow h-0 overflow-hidden'>
                <DebugWithSingleModel
                  ref={debugWithSingleModelRef}
                  checkCanSend={checkCanSend}
                />
              </div>
            )}
            {/* Text  Generation */}
            {mode === AppType.completion && (
              <div className="mt-6 px-6 pb-4">
                <GroupName name={t('appDebug.result')} />
                {(completionRes || isResponding) && (
                  <TextGeneration
                    className="mt-2"
                    content={completionRes}
                    isLoading={!completionRes && isResponding}
                    isShowTextToSpeech={textToSpeechConfig.enabled && !!text2speechDefaultModel}
                    isResponding={isResponding}
                    isInstalledApp={false}
                    messageId={messageId}
                    isError={false}
                    onRetry={() => { }}
                    supportAnnotation
                    appId={appId}
                    varList={varList}
                  />
                )}
              </div>
            )}
            {mode === AppType.completion && showPromptLogModal && (
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
      {isShowFormattingChangeConfirm && (
        <FormattingChanged
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
      {!hasSetAPIKEY && (<HasNotSetAPIKEY isTrailFinished={!IS_CE_EDITION} onSetting={onSetting} />)}
    </>
  )
}
export default React.memo(Debug)
