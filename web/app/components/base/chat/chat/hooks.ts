import {
  useEffect,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { produce } from 'immer'
import { useGetState } from 'ahooks'
import dayjs from 'dayjs'
import type {
  ChatConfig,
  ChatItem,
  Inputs,
  PromptVariable,
  VisionFile,
} from '../types'
import { useChatContext } from './context'
import { TransferMethod } from '@/types/app'
import { useToastContext } from '@/app/components/base/toast'
import { ssePost } from '@/service/base'
import { replaceStringWithValues } from '@/app/components/app/configuration/prompt-value-panel'

type GetAbortController = (abortController: AbortController) => void
type SendCallback = {
  onGetConvesationMessages: (conversationId: string, getAbortController: GetAbortController) => Promise<any>
  onGetSuggestedQuestions?: (responseItemId: string, getAbortController: GetAbortController) => Promise<any>
}
export const useChat = (
  config: ChatConfig,
  promptVariablesConfig?: {
    inputs: Inputs
    promptVariables: PromptVariable[]
  },
  prevChatList?: ChatItem[],
  stopChat?: (taskId: string) => void,
) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const connversationId = useRef('')
  const hasStopResponded = useRef(false)
  const [isResponsing, setIsResponsing] = useState(false)
  const [chatList, setChatList, getChatList] = useGetState<ChatItem[]>(prevChatList || [])
  const [taskId, setTaskId] = useState('')
  const [suggestedQuestions, setSuggestQuestions] = useState<string[]>([])
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const [conversationMessagesAbortController, setConversationMessagesAbortController] = useState<AbortController | null>(null)
  const [suggestedQuestionsAbortController, setSuggestedQuestionsAbortController] = useState<AbortController | null>(null)

  const getIntroduction = (str: string) => {
    return replaceStringWithValues(str, promptVariablesConfig?.promptVariables || [], promptVariablesConfig?.inputs || {})
  }
  useEffect(() => {
    if (config.opening_statement && !chatList.some(item => !item.isAnswer)) {
      setChatList([{
        id: `${Date.now()}`,
        content: getIntroduction(config.opening_statement),
        isAnswer: true,
        isOpeningStatement: true,
        suggestedQuestions: config.suggested_questions,
      }])
    }
  }, [config.opening_statement, config.suggested_questions, promptVariablesConfig?.inputs])

  const handleStop = () => {
    if (stopChat && taskId)
      stopChat(taskId)
    if (abortController)
      abortController.abort()
    if (conversationMessagesAbortController)
      conversationMessagesAbortController.abort()
    if (suggestedQuestionsAbortController)
      suggestedQuestionsAbortController.abort()
  }

  const handleRestart = () => {
    handleStop()
    hasStopResponded.current = true
    connversationId.current = ''
    setIsResponsing(false)
    setChatList(config.opening_statement
      ? [{
        id: `${Date.now()}`,
        content: config.opening_statement,
        isAnswer: true,
        isOpeningStatement: true,
        suggestedQuestions: config.suggested_questions,
      }]
      : [])
    setSuggestQuestions([])
  }
  const handleSend = async (
    url: string,
    data: any,
    {
      onGetConvesationMessages,
      onGetSuggestedQuestions,
    }: SendCallback,
  ) => {
    setSuggestQuestions([])
    if (isResponsing) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForResponse') })
      return false
    }

    if (promptVariablesConfig?.inputs && promptVariablesConfig?.promptVariables) {
      const {
        promptVariables,
        inputs,
      } = promptVariablesConfig
      let hasEmptyInput = ''
      const requiredVars = promptVariables.filter(({ key, name, required, type }) => {
        if (type === 'api')
          return false
        const res = (!key || !key.trim()) || (!name || !name.trim()) || (required || required === undefined || required === null)
        return res
      })

      if (requiredVars?.length) {
        requiredVars.forEach(({ key, name }) => {
          if (hasEmptyInput)
            return

          if (!inputs[key])
            hasEmptyInput = name
        })
      }

      if (hasEmptyInput) {
        notify({ type: 'error', message: t('appDebug.errorMessage.valueOfVarRequired', { key: hasEmptyInput }) })
        return false
      }
    }

    const updateCurrentQA = ({
      responseItem,
      questionId,
      placeholderAnswerId,
      questionItem,
    }: {
      responseItem: ChatItem
      questionId: string
      placeholderAnswerId: string
      questionItem: ChatItem
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

    const questionId = `question-${Date.now()}`
    const questionItem = {
      id: questionId,
      content: data.query,
      isAnswer: false,
      message_files: data.files,
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
    const responseItem: ChatItem = {
      id: `${Date.now()}`,
      content: '',
      agent_thoughts: [],
      message_files: [],
      isAnswer: true,
    }

    setIsResponsing(true)
    hasStopResponded.current = false

    const bodyParams = {
      response_mode: 'streaming',
      conversation_id: connversationId.current,
      ...data,
    }
    if (bodyParams?.files?.length) {
      bodyParams.files = bodyParams.files.map((item: VisionFile) => {
        if (item.transfer_method === TransferMethod.local_file) {
          return {
            ...item,
            url: '',
          }
        }
        return item
      })
    }

    let isAgentMode = false
    let hasSetResponseId = false

    ssePost(
      url,
      {
        body: bodyParams,
      },
      {
        getAbortController: (abortController) => {
          setAbortController(abortController)
        },
        onData: (message: string, isFirstMessage: boolean, { conversationId: newConversationId, messageId, taskId }: any) => {
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

          if (isFirstMessage && newConversationId)
            connversationId.current = newConversationId

          setTaskId(taskId)
          if (messageId)
            responseItem.id = messageId

          updateCurrentQA({
            responseItem,
            questionId,
            placeholderAnswerId,
            questionItem,
          })
        },
        async onCompleted(hasError?: boolean) {
          setIsResponsing(false)

          if (hasError)
            return

          if (connversationId.current) {
            const { data }: any = await onGetConvesationMessages(
              connversationId.current,
              newAbortController => setConversationMessagesAbortController(newAbortController),
            )
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
          if (config.suggested_questions_after_answer?.enabled && !hasStopResponded.current && onGetSuggestedQuestions) {
            const { data }: any = await onGetSuggestedQuestions(
              responseItem.id,
              newAbortController => setSuggestedQuestionsAbortController(newAbortController),
            )
            setSuggestQuestions(data)
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
            })
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
          setIsResponsing(false)
          // role back placeholder answer
          setChatList(produce(getChatList(), (draft) => {
            draft.splice(draft.findIndex(item => item.id === placeholderAnswerId), 1)
          }))
        },
      })
    return true
  }

  return {
    chatList,
    getChatList,
    setChatList,
    conversationId: connversationId.current,
    isResponsing,
    setIsResponsing,
    handleSend,
    suggestedQuestions,
    handleRestart,
    handleStop,
  }
}

export const useCurrentAnswerIsResponsing = (answerId: string) => {
  const {
    isResponsing,
    chatList,
  } = useChatContext()

  const isLast = answerId === chatList[chatList.length - 1]?.id

  return isLast && isResponsing
}
