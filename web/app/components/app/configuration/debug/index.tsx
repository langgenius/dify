'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import React, { useEffect, useRef, useState } from 'react'
import cn from 'classnames'
import produce from 'immer'
import { useBoolean, useGetState } from 'ahooks'
import { useContext } from 'use-context-selector'
import dayjs from 'dayjs'
import HasNotSetAPIKEY from '../base/warning-mask/has-not-set-api'
import FormattingChanged from '../base/warning-mask/formatting-changed'
import GroupName from '../base/group-name'
import { AppType } from '@/types/app'
import PromptValuePanel, { replaceStringWithValues } from '@/app/components/app/configuration/prompt-value-panel'
import type { IChatItem } from '@/app/components/app/chat'
import Chat from '@/app/components/app/chat'
import ConfigContext from '@/context/debug-configuration'
import { ToastContext } from '@/app/components/base/toast'
import { fetchConvesationMessages, fetchSuggestedQuestions, sendChatMessage, sendCompletionMessage, stopChatMessageResponding } from '@/service/debug'
import Button from '@/app/components/base/button'
import type { ModelConfig as BackendModelConfig } from '@/types/app'
import { promptVariablesToUserInputsForm } from '@/utils/model-config'
import TextGeneration from '@/app/components/app/text-generate/item'
import { IS_CE_EDITION } from '@/config'

type IDebug = {
  hasSetAPIKEY: boolean
  onSetting: () => void
}

const Debug: FC<IDebug> = ({
  hasSetAPIKEY = true,
  onSetting,
}) => {
  const { t } = useTranslation()
  const {
    appId,
    mode,
    introduction,
    suggestedQuestionsAfterAnswerConfig,
    moreLikeThisConfig,
    inputs,
    // setInputs,
    formattingChanged,
    setFormattingChanged,
    conversationId,
    setConversationId,
    controlClearChatMessage,
    dataSets,
    modelConfig,
    completionParams,
  } = useContext(ConfigContext)

  const [chatList, setChatList, getChatList] = useGetState<IChatItem[]>([])
  const chatListDomRef = useRef<HTMLDivElement>(null)
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
      }])
    }
  }, [introduction, modelConfig.configs.prompt_variables, inputs])

  const [isResponsing, { setTrue: setResponsingTrue, setFalse: setResponsingFalse }] = useBoolean(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const [isShowFormattingChangeConfirm, setIsShowFormattingChangeConfirm] = useState(false)
  const [isShowSuggestion, setIsShowSuggestion] = useState(false)
  const [messageTaskId, setMessageTaskId] = useState('')
  const [hasStopResponded, setHasStopResponded, getHasStopResponded] = useGetState(false)

  useEffect(() => {
    if (formattingChanged && chatList.some(item => !item.isAnswer))
      setIsShowFormattingChangeConfirm(true)

    setFormattingChanged(false)
  }, [formattingChanged])

  const clearConversation = async () => {
    setConversationId(null)
    abortController?.abort()
    setResponsingFalse()
    setChatList(introduction
      ? [{
        id: `${Date.now()}`,
        content: getIntroduction(),
        isAnswer: true,
        isOpeningStatement: true,
      }]
      : [])
    setIsShowSuggestion(false)
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
    let hasEmptyInput = false
    const requiredVars = modelConfig.configs.prompt_variables.filter(({ key, name, required }) => {
      const res = (!key || !key.trim()) || (!name || !name.trim()) || (required || required === undefined || required === null)
      return res
    }) // compatible with old version
    // debugger
    requiredVars.forEach(({ key }) => {
      if (hasEmptyInput)
        return

      if (!inputs[key])
        hasEmptyInput = true
    })

    if (hasEmptyInput) {
      logError(t('appDebug.errorMessage.valueOfVarRequired'))
      return false
    }
    return !hasEmptyInput
  }

  const doShowSuggestion = isShowSuggestion && !isResponsing
  const [suggestQuestions, setSuggestQuestions] = useState<string[]>([])
  const onSend = async (message: string) => {
    if (isResponsing) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForResponse') })
      return false
    }

    const postDatasets = dataSets.map(({ id }) => ({
      dataset: {
        enabled: true,
        id,
      },
    }))

    const postModelConfig: BackendModelConfig = {
      pre_prompt: modelConfig.configs.prompt_template,
      user_input_form: promptVariablesToUserInputsForm(modelConfig.configs.prompt_variables),
      opening_statement: introduction,
      more_like_this: {
        enabled: false,
      },
      suggested_questions_after_answer: suggestedQuestionsAfterAnswerConfig,
      agent_mode: {
        enabled: true,
        tools: [...postDatasets],
      },
      model: {
        provider: modelConfig.provider,
        name: modelConfig.model_id,
        completion_params: completionParams as any,
      },
    }

    const data = {
      conversation_id: conversationId,
      inputs,
      query: message,
      model_config: postModelConfig,
    }

    // qustion
    const questionId = `question-${Date.now()}`
    const questionItem = {
      id: questionId,
      content: message,
      isAnswer: false,
    }

    const placeholderAnswerId = `answer-placeholder-${Date.now()}`
    const placeholderAnswerItem = {
      id: placeholderAnswerId,
      content: '',
      isAnswer: true,
    }

    const newList = [...getChatList(), questionItem, placeholderAnswerItem]
    setChatList(newList)

    // answer
    const responseItem = {
      id: `${Date.now()}`,
      content: '',
      isAnswer: true,
    }

    let _newConversationId: null | string = null

    setHasStopResponded(false)
    setResponsingTrue()
    setIsShowSuggestion(false)
    sendChatMessage(appId, data, {
      getAbortController: (abortController) => {
        setAbortController(abortController)
      },
      onData: (message: string, isFirstMessage: boolean, { conversationId: newConversationId, messageId, taskId }: any) => {
        responseItem.content = responseItem.content + message
        if (isFirstMessage && newConversationId) {
          setConversationId(newConversationId)
          _newConversationId = newConversationId
        }
        setMessageTaskId(taskId)
        if (messageId)
          responseItem.id = messageId

        // closesure new list is outdated.
        const newListWithAnswer = produce(
          getChatList().filter(item => item.id !== responseItem.id && item.id !== placeholderAnswerId),
          (draft) => {
            if (!draft.find(item => item.id === questionId))
              draft.push({ ...questionItem })

            draft.push({ ...responseItem })
          })
        setChatList(newListWithAnswer)
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

  const [completionQuery, setCompletionQuery] = useState('')
  const [completionRes, setCompletionRes] = useState('')

  const sendTextCompletion = async () => {
    if (isResponsing) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForResponse') })
      return false
    }

    if (!checkCanSend())
      return

    if (!completionQuery) {
      logError(t('appDebug.errorMessage.queryRequired'))
      return false
    }

    const postDatasets = dataSets.map(({ id }) => ({
      dataset: {
        enabled: true,
        id,
      },
    }))

    const postModelConfig: BackendModelConfig = {
      pre_prompt: modelConfig.configs.prompt_template,
      user_input_form: promptVariablesToUserInputsForm(modelConfig.configs.prompt_variables),
      opening_statement: introduction,
      suggested_questions_after_answer: suggestedQuestionsAfterAnswerConfig,
      more_like_this: moreLikeThisConfig,
      agent_mode: {
        enabled: true,
        tools: [...postDatasets],
      },
      model: {
        provider: modelConfig.provider,
        name: modelConfig.model_id,
        completion_params: completionParams as any,
      },
    }

    const data = {
      inputs,
      query: completionQuery,
      model_config: postModelConfig,
    }

    setCompletionRes('')
    const res: string[] = []

    setResponsingTrue()
    sendCompletionMessage(appId, data, {
      onData: (data: string) => {
        res.push(data)
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

  return (
    <>
      <div className="shrink-0">
        <div className='flex items-center justify-between mb-2'>
          <div className='h2 '>{t('appDebug.inputs.title')}</div>
          {mode === 'chat' && (
            <Button className='flex items-center gap-1 !h-8 !bg-white' onClick={clearConversation}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2.66663 2.66629V5.99963H3.05463M3.05463 5.99963C3.49719 4.90505 4.29041 3.98823 5.30998 3.39287C6.32954 2.7975 7.51783 2.55724 8.68861 2.70972C9.85938 2.8622 10.9465 3.39882 11.7795 4.23548C12.6126 5.07213 13.1445 6.16154 13.292 7.33296M3.05463 5.99963H5.99996M13.3333 13.333V9.99963H12.946M12.946 9.99963C12.5028 11.0936 11.7093 12.0097 10.6898 12.6045C9.67038 13.1993 8.48245 13.4393 7.31203 13.2869C6.1416 13.1344 5.05476 12.5982 4.22165 11.7621C3.38854 10.926 2.8562 9.83726 2.70796 8.66629M12.946 9.99963H9.99996" stroke="#1C64F2" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className='text-primary-600 text-[13px] font-semibold'>{t('common.operation.refresh')}</span>
            </Button>
          )}
        </div>
        <PromptValuePanel
          appType={mode as AppType}
          value={completionQuery}
          onChange={setCompletionQuery}
          onSend={sendTextCompletion}
        />
      </div>
      <div className="flex flex-col grow">
        {/* Chat */}
        {mode === AppType.chat && (
          <div className="mt-[34px] h-full flex flex-col">
            <div className={cn(doShowSuggestion ? 'pb-[140px]' : (isResponsing ? 'pb-[113px]' : 'pb-[66px]'), 'relative mt-1.5 grow h-[200px] overflow-hidden')}>
              <div className="h-full overflow-y-auto" ref={chatListDomRef}>
                {/* {JSON.stringify(chatList)} */}
                <Chat
                  chatList={chatList}
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
                isInstalledApp={false}
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
      </div>

      {!hasSetAPIKEY && (<HasNotSetAPIKEY isTrailFinished={!IS_CE_EDITION} onSetting={onSetting} />)}
    </>
  )
}
export default React.memo(Debug)
