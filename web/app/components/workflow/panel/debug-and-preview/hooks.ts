import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { produce, setAutoFreeze } from 'immer'
import { uniqBy } from 'lodash-es'
import { useWorkflowRun } from '../../hooks'
import { NodeRunningStatus, WorkflowRunningStatus } from '../../types'
import { useWorkflowStore } from '../../store'
import { DEFAULT_ITER_TIMES, DEFAULT_LOOP_TIMES } from '../../constants'
import type {
  ChatItem,
  Inputs,
} from '@/app/components/base/chat/types'
import type { InputForm } from '@/app/components/base/chat/chat/type'
import {
  getProcessedInputs,
  processOpeningStatement,
} from '@/app/components/base/chat/chat/utils'
import { useToastContext } from '@/app/components/base/toast'
import { TransferMethod } from '@/types/app'
import {
  getProcessedFiles,
  getProcessedFilesFromResponse,
} from '@/app/components/base/file-uploader/utils'
import type { FileEntity } from '@/app/components/base/file-uploader/types'

type GetAbortController = (abortController: AbortController) => void
type SendCallback = {
  onGetSuggestedQuestions?: (responseItemId: string, getAbortController: GetAbortController) => Promise<any>
}
export const useChat = (
  config: any,
  formSettings?: {
    inputs: Inputs
    inputsForm: InputForm[]
  },
  prevChatList?: ChatItem[],
  stopChat?: (taskId: string) => void,
) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const { handleRun } = useWorkflowRun()
  const hasStopResponded = useRef(false)
  const workflowStore = useWorkflowStore()
  const conversationId = useRef('')
  const taskIdRef = useRef('')
  const [chatList, setChatList] = useState<ChatItem[]>(prevChatList || [])
  const chatListRef = useRef<ChatItem[]>(prevChatList || [])
  const [isResponding, setIsResponding] = useState(false)
  const isRespondingRef = useRef(false)
  const [suggestedQuestions, setSuggestQuestions] = useState<string[]>([])
  const suggestedQuestionsAbortControllerRef = useRef<AbortController | null>(null)

  const {
    setIterTimes,
    setLoopTimes,
  } = workflowStore.getState()
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
    return processOpeningStatement(str, formSettings?.inputs || {}, formSettings?.inputsForm || [])
  }, [formSettings?.inputs, formSettings?.inputsForm])

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
    setIterTimes(DEFAULT_ITER_TIMES)
    setLoopTimes(DEFAULT_LOOP_TIMES)
    if (suggestedQuestionsAbortControllerRef.current)
      suggestedQuestionsAbortControllerRef.current.abort()
  }, [handleResponding, setIterTimes, setLoopTimes, stopChat])

  const handleRestart = useCallback(() => {
    conversationId.current = ''
    taskIdRef.current = ''
    handleStop()
    setIterTimes(DEFAULT_ITER_TIMES)
    setLoopTimes(DEFAULT_LOOP_TIMES)
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
    setIterTimes,
    setLoopTimes,
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
    params: {
      query: string
      files?: FileEntity[]
      [key: string]: any
    },
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

    handleResponding(true)

    const { files, inputs, ...restParams } = params
    const bodyParams = {
      files: getProcessedFiles(files || []),
      inputs: getProcessedInputs(inputs || {}, formSettings?.inputsForm || []),
      ...restParams,
    }
    if (bodyParams?.files?.length) {
      bodyParams.files = bodyParams.files.map((item) => {
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
      bodyParams,
      {
        onData: (message: string, isFirstMessage: boolean, { conversationId: newConversationId, messageId, taskId }: any) => {
          responseItem.content = responseItem.content + message

          if (messageId && !hasSetResponseId) {
            responseItem.id = messageId
            hasSetResponseId = true
          }

          if (isFirstMessage && newConversationId)
            conversationId.current = newConversationId

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
            try {
              const { data }: any = await onGetSuggestedQuestions(
                responseItem.id,
                newAbortController => suggestedQuestionsAbortControllerRef.current = newAbortController,
              )
              setSuggestQuestions(data)
            }
            // eslint-disable-next-line unused-imports/no-unused-vars
            catch (error) {
              setSuggestQuestions([])
            }
          }
        },
        onMessageEnd: (messageEnd) => {
          responseItem.citation = messageEnd.metadata?.retriever_resources || []
          const processedFilesFromResponse = getProcessedFilesFromResponse(messageEnd.files || [])
          responseItem.allFiles = uniqBy([...(responseItem.allFiles || []), ...(processedFilesFromResponse || [])], 'id')

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
          })
          handleUpdateChatList(produce(chatListRef.current, (draft) => {
            const currentIndex = draft.findIndex(item => item.id === responseItem.id)
            draft[currentIndex] = {
              ...draft[currentIndex],
              ...responseItem,
            }
          }))
        },
        onIterationFinish: ({ data }) => {
          const currentTracingIndex = responseItem.workflowProcess!.tracing!.findIndex(item => item.id === data.id)
          if (currentTracingIndex > -1) {
            responseItem.workflowProcess!.tracing[currentTracingIndex] = {
              ...responseItem.workflowProcess!.tracing[currentTracingIndex],
              ...data,
            }
            handleUpdateChatList(produce(chatListRef.current, (draft) => {
              const currentIndex = draft.findIndex(item => item.id === responseItem.id)
              draft[currentIndex] = {
                ...draft[currentIndex],
                ...responseItem,
              }
            }))
          }
        },
        onLoopStart: ({ data }) => {
          responseItem.workflowProcess!.tracing!.push({
            ...data,
            status: NodeRunningStatus.Running,
          })
          handleUpdateChatList(produce(chatListRef.current, (draft) => {
            const currentIndex = draft.findIndex(item => item.id === responseItem.id)
            draft[currentIndex] = {
              ...draft[currentIndex],
              ...responseItem,
            }
          }))
        },
        onLoopFinish: ({ data }) => {
          const currentTracingIndex = responseItem.workflowProcess!.tracing!.findIndex(item => item.id === data.id)
          if (currentTracingIndex > -1) {
            responseItem.workflowProcess!.tracing[currentTracingIndex] = {
              ...responseItem.workflowProcess!.tracing[currentTracingIndex],
              ...data,
            }
            handleUpdateChatList(produce(chatListRef.current, (draft) => {
              const currentIndex = draft.findIndex(item => item.id === responseItem.id)
              draft[currentIndex] = {
                ...draft[currentIndex],
                ...responseItem,
              }
            }))
          }
        },
        onNodeStarted: ({ data }) => {
          if (data.iteration_id || data.loop_id)
            return

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
        },
        onNodeRetry: ({ data }) => {
          if (data.iteration_id || data.loop_id)
            return

          responseItem.workflowProcess!.tracing!.push(data)
          handleUpdateChatList(produce(chatListRef.current, (draft) => {
            const currentIndex = draft.findIndex(item => item.id === responseItem.id)
            draft[currentIndex] = {
              ...draft[currentIndex],
              ...responseItem,
            }
          }))
        },
        onNodeFinished: ({ data }) => {
          if (data.iteration_id || data.loop_id)
            return

          const currentTracingIndex = responseItem.workflowProcess!.tracing!.findIndex(item => item.id === data.id)
          if (currentTracingIndex > -1) {
            responseItem.workflowProcess!.tracing[currentTracingIndex] = {
              ...responseItem.workflowProcess!.tracing[currentTracingIndex],
              ...data,
            }
            handleUpdateChatList(produce(chatListRef.current, (draft) => {
              const currentIndex = draft.findIndex(item => item.id === responseItem.id)
              draft[currentIndex] = {
                ...draft[currentIndex],
                ...responseItem,
              }
            }))
          }
        },
        onAgentLog: ({ data }) => {
          const currentNodeIndex = responseItem.workflowProcess!.tracing!.findIndex(item => item.node_id === data.node_id)
          if (currentNodeIndex > -1) {
            const current = responseItem.workflowProcess!.tracing![currentNodeIndex]

            if (current.execution_metadata) {
              if (current.execution_metadata.agent_log) {
                const currentLogIndex = current.execution_metadata.agent_log.findIndex(log => log.id === data.id)
                if (currentLogIndex > -1) {
                  current.execution_metadata.agent_log[currentLogIndex] = {
                    ...current.execution_metadata.agent_log[currentLogIndex],
                    ...data,
                  }
                }
                else {
                  current.execution_metadata.agent_log.push(data)
                }
              }
              else {
                current.execution_metadata.agent_log = [data]
              }
            }
            else {
              current.execution_metadata = {
                agent_log: [data],
              } as any
            }
            // if (current.agentLog) {
            //   const currentLogIndex = current.agentLog.findIndex(log => log.id === data.id)

            //   if (currentLogIndex > -1) {
            //     current.agentLog[currentLogIndex] = {
            //       ...current.agentLog[currentLogIndex],
            //       ...data,
            //     }
            //   }
            //   else {
            //     current.agentLog.push(data)
            //   }
            // }
            // else {
            //   current.agentLog = [data]
            // }

            responseItem.workflowProcess!.tracing[currentNodeIndex] = {
              ...current,
            }

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
  }, [handleRun, handleResponding, handleUpdateChatList, notify, t, updateCurrentQA, config.suggested_questions_after_answer?.enabled, formSettings])

  return {
    conversationId: conversationId.current,
    chatList,
    chatListRef,
    handleUpdateChatList,
    handleSend,
    handleStop,
    handleRestart,
    isResponding,
    suggestedQuestions,
  }
}
