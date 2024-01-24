'use client'
import type { FC } from 'react'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import React, { useEffect, useRef, useState } from 'react'
import cn from 'classnames'
import produce, { setAutoFreeze } from 'immer'
import { useBoolean, useGetState } from 'ahooks'
import { useContext } from 'use-context-selector'
import dayjs from 'dayjs'
import HasNotSetAPIKEY from '../base/warning-mask/has-not-set-api'
import FormattingChanged from '../base/warning-mask/formatting-changed'
import GroupName from '../base/group-name'
import CannotQueryDataset from '../base/warning-mask/cannot-query-dataset'
import DebugWithMultipleModel from './debug-with-multiple-model'
import type { ModelAndParameter } from './types'
import {
  APP_CHAT_WITH_MULTIPLE_MODEL,
  APP_CHAT_WITH_MULTIPLE_MODEL_RESTART,
} from './types'
import { AgentStrategy, AppType, ModelModeType, TransferMethod } from '@/types/app'
import PromptValuePanel, { replaceStringWithValues } from '@/app/components/app/configuration/prompt-value-panel'
import type { IChatItem } from '@/app/components/app/chat/type'
import Chat from '@/app/components/app/chat'
import ConfigContext from '@/context/debug-configuration'
import { ToastContext } from '@/app/components/base/toast'
import { fetchConvesationMessages, fetchSuggestedQuestions, sendChatMessage, sendCompletionMessage, stopChatMessageResponding } from '@/service/debug'
import Button from '@/app/components/base/button'
import type { ModelConfig as BackendModelConfig, VisionFile } from '@/types/app'
import { promptVariablesToUserInputsForm } from '@/utils/model-config'
import TextGeneration from '@/app/components/app/text-generate/item'
import { IS_CE_EDITION } from '@/config'
import type { Inputs } from '@/models/debug'
import { fetchFileUploadConfig } from '@/service/common'
import type { Annotation as AnnotationType } from '@/models/log'
import { useDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ModelParameterModalProps } from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { Plus } from '@/app/components/base/icons/src/vender/line/general'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useProviderContext } from '@/context/provider-context'

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
    isFunctionCall,
    collectionList,
    modelModeType,
    hasSetBlockStatus,
    isAdvancedMode,
    promptMode,
    chatPromptConfig,
    completionPromptConfig,
    introduction,
    suggestedQuestions,
    suggestedQuestionsAfterAnswerConfig,
    speechToTextConfig,
    textToSpeechConfig,
    citationConfig,
    moderationConfig,
    moreLikeThisConfig,
    formattingChanged,
    setFormattingChanged,
    conversationId,
    setConversationId,
    controlClearChatMessage,
    dataSets,
    modelConfig,
    completionParams,
    hasSetContextVar,
    datasetConfigs,
    visionConfig,
    annotationConfig,
    setVisionConfig,
  } = useContext(ConfigContext)
  const { eventEmitter } = useEventEmitterContextContext()
  const { data: speech2textDefaultModel } = useDefaultModel(4)
  const { data: text2speechDefaultModel } = useDefaultModel(5)
  const [chatList, setChatList, getChatList] = useGetState<IChatItem[]>([])
  const chatListDomRef = useRef<HTMLDivElement>(null)
  const { data: fileUploadConfigResponse } = useSWR({ url: '/files/upload' }, fetchFileUploadConfig)
  // onData change thought (the produce obj). https://github.com/immerjs/immer/issues/576
  useEffect(() => {
    setAutoFreeze(false)
    return () => {
      setAutoFreeze(true)
    }
  }, [])
  useEffect(() => {
    // scroll to bottom
    if (chatListDomRef.current)
      chatListDomRef.current.scrollTop = chatListDomRef.current.scrollHeight
  }, [chatList])

  const getIntroduction = () => replaceStringWithValues(introduction, modelConfig.configs.prompt_variables, inputs)
  useEffect(() => {
    if (introduction && !chatList.some(item => !item.isAnswer)) {
      setChatList([{
        id: `${Date.now()}`,
        content: getIntroduction(),
        isAnswer: true,
        isOpeningStatement: true,
        suggestedQuestions,
      }])
    }
  }, [introduction, suggestedQuestions, modelConfig.configs.prompt_variables, inputs])

  const [isResponsing, { setTrue: setResponsingTrue, setFalse: setResponsingFalse }] = useBoolean(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const [isShowFormattingChangeConfirm, setIsShowFormattingChangeConfirm] = useState(false)
  const [isShowCannotQueryDataset, setShowCannotQueryDataset] = useState(false)
  const [isShowSuggestion, setIsShowSuggestion] = useState(false)
  const [messageTaskId, setMessageTaskId] = useState('')
  const [hasStopResponded, setHasStopResponded, getHasStopResponded] = useGetState(false)

  useEffect(() => {
    if (formattingChanged && chatList.some(item => !item.isAnswer))
      setIsShowFormattingChangeConfirm(true)

    setFormattingChanged(false)
  }, [formattingChanged])

  const handleClearConversation = () => {
    setConversationId(null)
    abortController?.abort()
    setResponsingFalse()
    setChatList(introduction
      ? [{
        id: `${Date.now()}`,
        content: getIntroduction(),
        isAnswer: true,
        isOpeningStatement: true,
        suggestedQuestions,
      }]
      : [])
    setIsShowSuggestion(false)
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
  }

  const handleCancel = () => {
    setIsShowFormattingChangeConfirm(false)
  }

  const { notify } = useContext(ToastContext)
  const logError = (message: string) => {
    notify({ type: 'error', message })
  }

  const checkCanSend = () => {
    if (isAdvancedMode && mode === AppType.chat) {
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
      if (type === 'api')
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

    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    if (completionFiles.find(item => item.transfer_method === TransferMethod.local_file && !item.upload_file_id)) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForImgUpload') })
      return false
    }
    return !hasEmptyInput
  }

  const doShowSuggestion = isShowSuggestion && !isResponsing
  const [suggestQuestions, setSuggestQuestions] = useState<string[]>([])
  const [userQuery, setUserQuery] = useState('')
  const onSend = async (message: string, files?: VisionFile[]) => {
    if (isResponsing) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForResponse') })
      return false
    }

    if (files?.find(item => item.transfer_method === TransferMethod.local_file && !item.upload_file_id)) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForImgUpload') })
      return false
    }

    const postDatasets = dataSets.map(({ id }) => ({
      dataset: {
        enabled: true,
        id,
      },
    }))
    const contextVar = modelConfig.configs.prompt_variables.find(item => item.is_context_var)?.key
    const updateCurrentQA = ({
      responseItem,
      questionId,
      placeholderAnswerId,
      questionItem,
    }: {
      responseItem: IChatItem
      questionId: string
      placeholderAnswerId: string
      questionItem: IChatItem
    }) => {
      // closesure new list is outdated.
      const newListWithAnswer = produce(
        getChatList().filter(item => item.id !== responseItem.id && item.id !== placeholderAnswerId),
        (draft) => {
          if (!draft.find(item => item.id === questionId))
            draft.push({ ...questionItem })

          draft.push({ ...responseItem })
        })
      setChatList(newListWithAnswer)
    }
    const postModelConfig: BackendModelConfig = {
      text_to_speech: {
        enabled: false,
      },
      pre_prompt: !isAdvancedMode ? modelConfig.configs.prompt_template : '',
      prompt_type: promptMode,
      chat_prompt_config: {},
      completion_prompt_config: {},
      user_input_form: promptVariablesToUserInputsForm(modelConfig.configs.prompt_variables),
      dataset_query_variable: contextVar || '',
      opening_statement: introduction,
      more_like_this: {
        enabled: false,
      },
      suggested_questions_after_answer: suggestedQuestionsAfterAnswerConfig,
      speech_to_text: speechToTextConfig,
      retriever_resource: citationConfig,
      sensitive_word_avoidance: moderationConfig,
      agent_mode: {
        ...modelConfig.agentConfig,
        strategy: isFunctionCall ? AgentStrategy.functionCall : AgentStrategy.react,
      },
      model: {
        provider: modelConfig.provider,
        name: modelConfig.model_id,
        mode: modelConfig.mode,
        completion_params: completionParams as any,
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
      annotation_reply: annotationConfig,
    }

    if (isAdvancedMode) {
      postModelConfig.chat_prompt_config = chatPromptConfig
      postModelConfig.completion_prompt_config = completionPromptConfig
    }

    const data: Record<string, any> = {
      conversation_id: conversationId,
      inputs,
      query: message,
      model_config: postModelConfig,
    }

    if (visionConfig.enabled && files && files?.length > 0) {
      data.files = files.map((item) => {
        if (item.transfer_method === TransferMethod.local_file) {
          return {
            ...item,
            url: '',
          }
        }
        return item
      })
    }

    // qustion
    const questionId = `question-${Date.now()}`
    const questionItem = {
      id: questionId,
      content: message,
      isAnswer: false,
      message_files: files,
    }

    const placeholderAnswerId = `answer-placeholder-${Date.now()}`
    const placeholderAnswerItem = {
      id: placeholderAnswerId,
      content: '',
      isAnswer: true,
    }

    const newList = [...getChatList(), questionItem, placeholderAnswerItem]
    setChatList(newList)

    let isAgentMode = false

    // answer
    const responseItem: IChatItem = {
      id: `${Date.now()}`,
      content: '',
      agent_thoughts: [],
      message_files: [],
      isAnswer: true,
    }
    let hasSetResponseId = false

    let _newConversationId: null | string = null

    setHasStopResponded(false)
    setResponsingTrue()
    setIsShowSuggestion(false)
    sendChatMessage(appId, data, {
      getAbortController: (abortController) => {
        setAbortController(abortController)
      },
      onData: (message: string, isFirstMessage: boolean, { conversationId: newConversationId, messageId, taskId }: any) => {
        // console.log('onData', message)
        if (!isAgentMode) {
          responseItem.content = responseItem.content + message
        }
        else {
          const lastThought = responseItem.agent_thoughts?.[responseItem.agent_thoughts?.length - 1]
          if (lastThought)
            lastThought.thought = lastThought.thought + message // need immer setAutoFreeze
        }
        if (messageId && !hasSetResponseId) {
          responseItem.id = messageId
          hasSetResponseId = true
        }

        if (isFirstMessage && newConversationId) {
          setConversationId(newConversationId)
          _newConversationId = newConversationId
        }
        setMessageTaskId(taskId)

        updateCurrentQA({
          responseItem,
          questionId,
          placeholderAnswerId,
          questionItem,
        })
      },
      async onCompleted(hasError?: boolean) {
        setResponsingFalse()
        if (hasError)
          return

        if (_newConversationId) {
          const { data }: any = await fetchConvesationMessages(appId, _newConversationId as string)
          const newResponseItem = data.find((item: any) => item.id === responseItem.id)
          if (!newResponseItem)
            return

          setChatList(produce(getChatList(), (draft) => {
            const index = draft.findIndex(item => item.id === responseItem.id)
            if (index !== -1) {
              const requestion = draft[index - 1]
              draft[index - 1] = {
                ...requestion,
                log: newResponseItem.message,
              }
              draft[index] = {
                ...draft[index],
                more: {
                  time: dayjs.unix(newResponseItem.created_at).format('hh:mm A'),
                  tokens: newResponseItem.answer_tokens + newResponseItem.message_tokens,
                  latency: newResponseItem.provider_response_latency.toFixed(2),
                },
              }
            }
          }))
        }
        if (suggestedQuestionsAfterAnswerConfig.enabled && !getHasStopResponded()) {
          const { data }: any = await fetchSuggestedQuestions(appId, responseItem.id)
          setSuggestQuestions(data)
          setIsShowSuggestion(true)
        }
      },
      onFile(file) {
        const lastThought = responseItem.agent_thoughts?.[responseItem.agent_thoughts?.length - 1]
        if (lastThought)
          responseItem.agent_thoughts![responseItem.agent_thoughts!.length - 1].message_files = [...(lastThought as any).message_files, file]

        updateCurrentQA({
          responseItem,
          questionId,
          placeholderAnswerId,
          questionItem,
        })
      },
      onThought(thought) {
        isAgentMode = true
        const response = responseItem as any
        if (thought.message_id && !hasSetResponseId)
          response.id = thought.message_id
        if (response.agent_thoughts.length === 0) {
          response.agent_thoughts.push(thought)
        }
        else {
          const lastThought = response.agent_thoughts[response.agent_thoughts.length - 1]
          // thought changed but still the same thought, so update.
          if (lastThought.id === thought.id) {
            thought.thought = lastThought.thought
            thought.message_files = lastThought.message_files
            responseItem.agent_thoughts![response.agent_thoughts.length - 1] = thought
          }
          else {
            responseItem.agent_thoughts!.push(thought)
          }
        }
        updateCurrentQA({
          responseItem,
          questionId,
          placeholderAnswerId,
          questionItem,
        })
      },
      onMessageEnd: (messageEnd) => {
        if (messageEnd.metadata?.annotation_reply) {
          responseItem.id = messageEnd.id
          responseItem.annotation = ({
            id: messageEnd.metadata.annotation_reply.id,
            authorName: messageEnd.metadata.annotation_reply.account.name,
          } as AnnotationType)
          const newListWithAnswer = produce(
            getChatList().filter(item => item.id !== responseItem.id && item.id !== placeholderAnswerId),
            (draft) => {
              if (!draft.find(item => item.id === questionId))
                draft.push({ ...questionItem })

              draft.push({
                ...responseItem,
              })
            })
          setChatList(newListWithAnswer)
          return
        }
        responseItem.citation = messageEnd.metadata?.retriever_resources || []

        const newListWithAnswer = produce(
          getChatList().filter(item => item.id !== responseItem.id && item.id !== placeholderAnswerId),
          (draft) => {
            if (!draft.find(item => item.id === questionId))
              draft.push({ ...questionItem })

            draft.push({ ...responseItem })
          })
        setChatList(newListWithAnswer)
      },
      onMessageReplace: (messageReplace) => {
        responseItem.content = messageReplace.answer
      },
      onError() {
        setResponsingFalse()
        // role back placeholder answer
        setChatList(produce(getChatList(), (draft) => {
          draft.splice(draft.findIndex(item => item.id === placeholderAnswerId), 1)
        }))
      },
    })
    return true
  }

  useEffect(() => {
    if (controlClearChatMessage)
      setChatList([])
  }, [controlClearChatMessage])

  const [completionRes, setCompletionRes] = useState('')
  const [messageId, setMessageId] = useState<string | null>(null)

  const [completionFiles, setCompletionFiles] = useState<VisionFile[]>([])
  const sendTextCompletion = async () => {
    if (isResponsing) {
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
      text_to_speech: {
        enabled: false,
      },
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

    setResponsingTrue()
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
        setResponsingFalse()
      },
      onError() {
        setResponsingFalse()
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
    if (debugWithMultipleModel && !visionConfig.enabled) {
      const supportedVision = multipleModelConfigs.some((modelConfig) => {
        const currentProvider = textGenerationModelList.find(modelItem => modelItem.provider === modelConfig.provider)
        const currentModel = currentProvider?.models.find(model => model.model === modelConfig.model)

        return currentModel?.features?.includes(ModelFeatureEnum.vision)
      })

      if (supportedVision) {
        setVisionConfig({
          ...visionConfig,
          enabled: true,
        })
      }
      else {
        setVisionConfig({
          ...visionConfig,
          enabled: false,
        })
      }
    }
  }

  useEffect(() => {
    handleVisionConfigInMultipleModel()
  }, [multipleModelConfigs])
  const allToolIcons = (() => {
    const icons: Record<string, any> = {}
    modelConfig.agentConfig.tools?.forEach((item: any) => {
      icons[item.tool_name] = collectionList.find((collection: any) => collection.id === item.provider_id)?.icon
    })
    return icons
  })()

  return (
    <>
      <div className="shrink-0">
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
            {mode === 'chat' && (
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
            />
          </div>
        )
      }
      {
        !debugWithMultipleModel && (
          <div className="flex flex-col grow">
            {/* Chat */}
            {mode === AppType.chat && (
              <div className="mt-[34px] h-full flex flex-col">
                <div className={cn(doShowSuggestion ? 'pb-[140px]' : (isResponsing ? 'pb-[113px]' : 'pb-[76px]'), 'relative mt-1.5 grow h-[200px] overflow-hidden')}>
                  <div className="h-full overflow-y-auto overflow-x-hidden" ref={chatListDomRef}>
                    <Chat
                      chatList={chatList}
                      query={userQuery}
                      onQueryChange={setUserQuery}
                      onSend={onSend}
                      checkCanSend={checkCanSend}
                      feedbackDisabled
                      useCurrentUserAvatar
                      isResponsing={isResponsing}
                      canStopResponsing={!!messageTaskId}
                      abortResponsing={async () => {
                        await stopChatMessageResponding(appId, messageTaskId)
                        setHasStopResponded(true)
                        setResponsingFalse()
                      }}
                      isShowSuggestion={doShowSuggestion}
                      suggestionList={suggestQuestions}
                      isShowSpeechToText={speechToTextConfig.enabled && !!speech2textDefaultModel}
                      isShowTextToSpeech={textToSpeechConfig.enabled && !!text2speechDefaultModel}
                      isShowCitation={citationConfig.enabled}
                      isShowCitationHitInfo
                      isShowPromptLog
                      visionConfig={{
                        ...visionConfig,
                        image_file_size_limit: fileUploadConfigResponse?.image_file_size_limit,
                      }}
                      supportAnnotation
                      appId={appId}
                      onChatListChange={setChatList}
                      allToolIcons={allToolIcons}
                    />
                  </div>
                </div>
              </div>
            )}
            {/* Text  Generation */}
            {mode === AppType.completion && (
              <div className="mt-6">
                <GroupName name={t('appDebug.result')} />
                {(completionRes || isResponsing) && (
                  <TextGeneration
                    className="mt-2"
                    content={completionRes}
                    isLoading={!completionRes && isResponsing}
                    isShowTextToSpeech={textToSpeechConfig.enabled && !!text2speechDefaultModel}
                    isResponsing={isResponsing}
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
            {isShowFormattingChangeConfirm && (
              <FormattingChanged
                onConfirm={handleConfirm}
                onCancel={handleCancel}
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
      {!hasSetAPIKEY && (<HasNotSetAPIKEY isTrailFinished={!IS_CE_EDITION} onSetting={onSetting} />)}
    </>
  )
}
export default React.memo(Debug)
