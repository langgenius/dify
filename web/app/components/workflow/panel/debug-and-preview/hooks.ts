import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { produce, setAutoFreeze } from 'immer'
import { useWorkflowRun } from '../../hooks'
import { NodeRunningStatus, WorkflowRunningStatus } from '../../types'
import type {
  ChatItem,
  Inputs,
  PromptVariable,
} from '@/app/components/base/chat/types'
import { useToastContext } from '@/app/components/base/toast'
import { TransferMethod } from '@/types/app'
import type { VisionFile } from '@/types/app'
import { replaceStringWithValues } from '@/app/components/app/configuration/prompt-value-panel'

type GetAbortController = (abortController: AbortController) => void
type SendCallback = {
  onGetSuggestedQuestions?: (responseItemId: string, getAbortController: GetAbortController) => Promise<any>
}
export const useChat = (
  config: any,
  promptVariablesConfig?: {
    inputs: Inputs
    promptVariables: PromptVariable[]
  },
  prevChatList?: ChatItem[],
  stopChat?: (taskId: string) => void,
) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const { handleRun } = useWorkflowRun()
  const hasStopResponded = useRef(false)
  const connversationId = useRef('')
  const taskIdRef = useRef('')
  const [chatList, setChatList] = useState<ChatItem[]>(prevChatList || [])
  const chatListRef = useRef<ChatItem[]>(prevChatList || [])
  const [isResponding, setIsResponding] = useState(false)
  const isRespondingRef = useRef(false)
  const [suggestedQuestions, setSuggestQuestions] = useState<string[]>([])
  const suggestedQuestionsAbortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    setAutoFreeze(false)
    return () => {
      setAutoFreeze(true)
    }
  }, [])

  const handleUpdateChatList = useCallback((newChatList: ChatItem[]) => {
    setChatList(newChatList)
    chatListRef.current = newChatList
  }, [])

  const handleResponding = useCallback((isResponding: boolean) => {
    setIsResponding(isResponding)
    isRespondingRef.current = isResponding
  }, [])

  const getIntroduction = useCallback((str: string) => {
    return replaceStringWithValues(str, promptVariablesConfig?.promptVariables || [], promptVariablesConfig?.inputs || {})
  }, [promptVariablesConfig?.inputs, promptVariablesConfig?.promptVariables])
  useEffect(() => {
    if (config?.opening_statement) {
      handleUpdateChatList(produce(chatListRef.current, (draft) => {
        const index = draft.findIndex(item => item.isOpeningStatement)

        if (index > -1) {
          draft[index] = {
            ...draft[index],
            content: getIntroduction(config.opening_statement),
            suggestedQuestions: config.suggested_questions,
          }
        }
        else {
          draft.unshift({
            id: `${Date.now()}`,
            content: getIntroduction(config.opening_statement),
            isAnswer: true,
            isOpeningStatement: true,
            suggestedQuestions: config.suggested_questions,
          })
        }
      }))
    }
  }, [config?.opening_statement, getIntroduction, config?.suggested_questions, handleUpdateChatList])

  const handleStop = useCallback(() => {
    hasStopResponded.current = true
    handleResponding(false)
    if (stopChat && taskIdRef.current)
      stopChat(taskIdRef.current)

    if (suggestedQuestionsAbortControllerRef.current)
      suggestedQuestionsAbortControllerRef.current.abort()
  }, [handleResponding, stopChat])

  const handleRestart = useCallback(() => {
    connversationId.current = ''
    taskIdRef.current = ''
    handleStop()
    const newChatList = config?.opening_statement
      ? [{
        id: `${Date.now()}`,
        content: config.opening_statement,
        isAnswer: true,
        isOpeningStatement: true,
        suggestedQuestions: config.suggested_questions,
      }]
      : []
    handleUpdateChatList(newChatList)
    setSuggestQuestions([])
  }, [
    config,
    handleStop,
    handleUpdateChatList,
  ])

  const updateCurrentQA = useCallback(({
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
    const newListWithAnswer = produce(
      chatListRef.current.filter(item => item.id !== responseItem.id && item.id !== placeholderAnswerId),
      (draft) => {
        if (!draft.find(item => item.id === questionId))
          draft.push({ ...questionItem })

        draft.push({ ...responseItem })
      })
    handleUpdateChatList(newListWithAnswer)
  }, [handleUpdateChatList])

  const handleSend = useCallback((
    params: any,
    {
      onGetSuggestedQuestions,
    }: SendCallback,
  ) => {
    if (isRespondingRef.current) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForResponse') })
      return false
    }

    const questionId = `question-${Date.now()}`
    const questionItem = {
      id: questionId,
      content: params.query,
      isAnswer: false,
      message_files: params.files,
    }

    const placeholderAnswerId = `answer-placeholder-${Date.now()}`
    const placeholderAnswerItem = {
      id: placeholderAnswerId,
      content: '',
      isAnswer: true,
    }

    const newList = [...chatListRef.current, questionItem, placeholderAnswerItem]
    handleUpdateChatList(newList)

    // answer
    const responseItem: ChatItem = {
      id: placeholderAnswerId,
      content: '',
      agent_thoughts: [],
      message_files: [],
      isAnswer: true,
    }

    let isInIteration = false

    handleResponding(true)

    const bodyParams = {
      conversation_id: connversationId.current,
      ...params,
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

    let hasSetResponseId = false

    handleRun(
      params,
      {
        onData: (message: string, isFirstMessage: boolean, { conversationId: newConversationId, messageId, taskId }: any) => {
          responseItem.content = responseItem.content + message

          if (messageId && !hasSetResponseId) {
            responseItem.id = messageId
            hasSetResponseId = true
          }

          if (isFirstMessage && newConversationId)
            connversationId.current = newConversationId

          taskIdRef.current = taskId
          if (messageId)
            responseItem.id = messageId

          updateCurrentQA({
            responseItem,
            questionId,
            placeholderAnswerId,
            questionItem,
          })
        },
        async onCompleted(hasError?: boolean, errorMessage?: string) {
          handleResponding(false)

          if (hasError) {
            if (errorMessage) {
              responseItem.content = errorMessage
              responseItem.isError = true
              const newListWithAnswer = produce(
                chatListRef.current.filter(item => item.id !== responseItem.id && item.id !== placeholderAnswerId),
                (draft) => {
                  if (!draft.find(item => item.id === questionId))
                    draft.push({ ...questionItem })

                  draft.push({ ...responseItem })
                })
              handleUpdateChatList(newListWithAnswer)
            }
            return
          }

          if (config?.suggested_questions_after_answer?.enabled && !hasStopResponded.current && onGetSuggestedQuestions) {
            const { data }: any = await onGetSuggestedQuestions(
              responseItem.id,
              newAbortController => suggestedQuestionsAbortControllerRef.current = newAbortController,
            )
            setSuggestQuestions(data)
          }
        },
        onMessageEnd: (messageEnd) => {
          responseItem.citation = messageEnd.metadata?.retriever_resources || []

          const newListWithAnswer = produce(
            chatListRef.current.filter(item => item.id !== responseItem.id && item.id !== placeholderAnswerId),
            (draft) => {
              if (!draft.find(item => item.id === questionId))
                draft.push({ ...questionItem })

              draft.push({ ...responseItem })
            })
          handleUpdateChatList(newListWithAnswer)
        },
        onMessageReplace: (messageReplace) => {
          responseItem.content = messageReplace.answer
        },
        onError() {
          handleResponding(false)
        },
        onWorkflowStarted: ({ workflow_run_id, task_id }) => {
          taskIdRef.current = task_id
          responseItem.workflow_run_id = workflow_run_id
          responseItem.workflowProcess = {
            status: WorkflowRunningStatus.Running,
            tracing: [],
          }
          handleUpdateChatList(produce(chatListRef.current, (draft) => {
            const currentIndex = draft.findIndex(item => item.id === responseItem.id)
            draft[currentIndex] = {
              ...draft[currentIndex],
              ...responseItem,
            }
          }))
        },
        onWorkflowFinished: ({ data }) => {
          responseItem.workflowProcess!.status = data.status as WorkflowRunningStatus
          handleUpdateChatList(produce(chatListRef.current, (draft) => {
            const currentIndex = draft.findIndex(item => item.id === responseItem.id)
            draft[currentIndex] = {
              ...draft[currentIndex],
              ...responseItem,
            }
          }))
        },
        onIterationStart: ({ data }) => {
          responseItem.workflowProcess!.tracing!.push({
            ...data,
            status: NodeRunningStatus.Running,
            details: [],
          } as any)
          handleUpdateChatList(produce(chatListRef.current, (draft) => {
            const currentIndex = draft.findIndex(item => item.id === responseItem.id)
            draft[currentIndex] = {
              ...draft[currentIndex],
              ...responseItem,
            }
          }))
          isInIteration = true
        },
        onIterationNext: () => {
          const tracing = responseItem.workflowProcess!.tracing!
          const iterations = tracing[tracing.length - 1]
          iterations.details!.push([])

          handleUpdateChatList(produce(chatListRef.current, (draft) => {
            const currentIndex = draft.length - 1
            draft[currentIndex] = responseItem
          }))
        },
        onIterationFinish: ({ data }) => {
          const tracing = responseItem.workflowProcess!.tracing!
          const iterations = tracing[tracing.length - 1]
          tracing[tracing.length - 1] = {
            ...iterations,
            ...data,
            status: NodeRunningStatus.Succeeded,
          } as any
          handleUpdateChatList(produce(chatListRef.current, (draft) => {
            const currentIndex = draft.length - 1
            draft[currentIndex] = responseItem
          }))

          isInIteration = false
        },
        onNodeStarted: ({ data }) => {
          if (isInIteration) {
            const tracing = responseItem.workflowProcess!.tracing!
            const iterations = tracing[tracing.length - 1]
            const currIteration = iterations.details![iterations.details!.length - 1]
            currIteration.push({
              ...data,
              status: NodeRunningStatus.Running,
            } as any)
            handleUpdateChatList(produce(chatListRef.current, (draft) => {
              const currentIndex = draft.length - 1
              draft[currentIndex] = responseItem
            }))
          }
          else {
            responseItem.workflowProcess!.tracing!.push({
              ...data,
              status: NodeRunningStatus.Running,
            } as any)
            handleUpdateChatList(produce(chatListRef.current, (draft) => {
              const currentIndex = draft.findIndex(item => item.id === responseItem.id)
              draft[currentIndex] = {
                ...draft[currentIndex],
                ...responseItem,
              }
            }))
          }
        },
        onNodeFinished: ({ data }) => {
          if (isInIteration) {
            const tracing = responseItem.workflowProcess!.tracing!
            const iterations = tracing[tracing.length - 1]
            const currIteration = iterations.details![iterations.details!.length - 1]
            currIteration[currIteration.length - 1] = {
              ...data,
              status: NodeRunningStatus.Succeeded,
            } as any
            handleUpdateChatList(produce(chatListRef.current, (draft) => {
              const currentIndex = draft.length - 1
              draft[currentIndex] = responseItem
            }))
          }
          else {
            const currentIndex = responseItem.workflowProcess!.tracing!.findIndex(item => item.node_id === data.node_id)
            responseItem.workflowProcess!.tracing[currentIndex] = {
              ...(responseItem.workflowProcess!.tracing[currentIndex].extras
                ? { extras: responseItem.workflowProcess!.tracing[currentIndex].extras }
                : {}),
              ...data,
            } as any
            handleUpdateChatList(produce(chatListRef.current, (draft) => {
              const currentIndex = draft.findIndex(item => item.id === responseItem.id)
              draft[currentIndex] = {
                ...draft[currentIndex],
                ...responseItem,
              }
            }))
          }
        },
      },
    )
  }, [handleRun, handleResponding, handleUpdateChatList, notify, t, updateCurrentQA, config.suggested_questions_after_answer?.enabled])

  return {
    conversationId: connversationId.current,
    chatList,
    handleSend,
    handleStop,
    handleRestart,
    isResponding,
    suggestedQuestions,
  }
}
