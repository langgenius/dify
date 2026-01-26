import type { RefObject } from 'react'
import type { SendCallback, SendParams, UpdateCurrentQAParams } from './types'
import type { InputForm } from '@/app/components/base/chat/chat/type'
import type { ChatItem, ChatItemInTree, Inputs } from '@/app/components/base/chat/types'
import { uniqBy } from 'es-toolkit/compat'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getProcessedInputs } from '@/app/components/base/chat/chat/utils'
import { getProcessedFiles, getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import { useToastContext } from '@/app/components/base/toast'
import { TransferMethod } from '@/types/app'
import { useWorkflowRun } from '../../../hooks'
import { useStore, useWorkflowStore } from '../../../store'
import { createWorkflowEventHandlers } from './use-workflow-event-handlers'

type UseChatMessageSenderParams = {
  threadMessages: ChatItemInTree[]
  config?: {
    suggested_questions_after_answer?: {
      enabled?: boolean
    }
  }
  formSettings?: {
    inputs: Inputs
    inputsForm: InputForm[]
  }
  hasStopResponded: RefObject<boolean>
  taskIdRef: RefObject<string>
  suggestedQuestionsAbortControllerRef: RefObject<AbortController | null>
  handleResponding: (responding: boolean) => void
  updateCurrentQAOnTree: (params: UpdateCurrentQAParams) => void
}

export function useChatMessageSender({
  threadMessages,
  config,
  formSettings,
  hasStopResponded,
  taskIdRef,
  suggestedQuestionsAbortControllerRef,
  handleResponding,
  updateCurrentQAOnTree,
}: UseChatMessageSenderParams) {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const { handleRun } = useWorkflowRun()
  const workflowStore = useWorkflowStore()

  const setConversationId = useStore(s => s.setConversationId)
  const setTargetMessageId = useStore(s => s.setTargetMessageId)
  const setSuggestedQuestions = useStore(s => s.setSuggestedQuestions)

  const handleSend = useCallback((
    params: SendParams,
    { onGetSuggestedQuestions }: SendCallback,
  ) => {
    if (workflowStore.getState().isResponding) {
      notify({ type: 'info', message: t('errorMessage.waitForResponse', { ns: 'appDebug' }) })
      return false
    }

    const parentMessage = threadMessages.find(item => item.id === params.parent_message_id)

    const placeholderQuestionId = `question-${Date.now()}`
    const questionItem: ChatItem = {
      id: placeholderQuestionId,
      content: params.query,
      isAnswer: false,
      message_files: params.files,
      parentMessageId: params.parent_message_id,
    }

    const siblingIndex = parentMessage?.children?.length ?? workflowStore.getState().chatTree.length
    const placeholderAnswerId = `answer-placeholder-${Date.now()}`
    const placeholderAnswerItem: ChatItem = {
      id: placeholderAnswerId,
      content: '',
      isAnswer: true,
      parentMessageId: questionItem.id,
      siblingIndex,
    }

    setTargetMessageId(parentMessage?.id)
    updateCurrentQAOnTree({
      parentId: params.parent_message_id,
      responseItem: placeholderAnswerItem,
      placeholderQuestionId,
      questionItem,
    })

    const responseItem: ChatItem = {
      id: placeholderAnswerId,
      content: '',
      agent_thoughts: [],
      message_files: [],
      isAnswer: true,
      parentMessageId: questionItem.id,
      siblingIndex,
    }

    handleResponding(true)
    hasStopResponded.current = false

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

    const workflowHandlers = createWorkflowEventHandlers({
      responseItem,
      questionItem,
      placeholderQuestionId,
      parentMessageId: params.parent_message_id,
      updateCurrentQAOnTree,
    })

    handleRun(
      bodyParams,
      {
        onData: (message: string, isFirstMessage: boolean, { conversationId: newConversationId, messageId, taskId }) => {
          responseItem.content = responseItem.content + message

          if (messageId && !hasSetResponseId) {
            questionItem.id = `question-${messageId}`
            responseItem.id = messageId
            responseItem.parentMessageId = questionItem.id
            hasSetResponseId = true
          }

          if (isFirstMessage && newConversationId)
            setConversationId(newConversationId)

          if (taskId)
            taskIdRef.current = taskId
          if (messageId)
            responseItem.id = messageId

          updateCurrentQAOnTree({
            placeholderQuestionId,
            questionItem,
            responseItem,
            parentId: params.parent_message_id,
          })
        },
        async onCompleted(hasError?: boolean, errorMessage?: string) {
          handleResponding(false)

          if (hasError) {
            if (errorMessage) {
              responseItem.content = errorMessage
              responseItem.isError = true
              updateCurrentQAOnTree({
                placeholderQuestionId,
                questionItem,
                responseItem,
                parentId: params.parent_message_id,
              })
            }
            return
          }

          if (config?.suggested_questions_after_answer?.enabled && !hasStopResponded.current && onGetSuggestedQuestions) {
            try {
              const result = await onGetSuggestedQuestions(
                responseItem.id,
                newAbortController => suggestedQuestionsAbortControllerRef.current = newAbortController,
              ) as { data: string[] }
              setSuggestedQuestions(result.data)
            }
            catch {
              setSuggestedQuestions([])
            }
          }
        },
        onMessageEnd: (messageEnd) => {
          responseItem.citation = messageEnd.metadata?.retriever_resources || []
          const processedFilesFromResponse = getProcessedFilesFromResponse(messageEnd.files || [])
          responseItem.allFiles = uniqBy([...(responseItem.allFiles || []), ...(processedFilesFromResponse || [])], 'id')

          updateCurrentQAOnTree({
            placeholderQuestionId,
            questionItem,
            responseItem,
            parentId: params.parent_message_id,
          })
        },
        onMessageReplace: (messageReplace) => {
          responseItem.content = messageReplace.answer
        },
        onError() {
          handleResponding(false)
        },
        onWorkflowStarted: (event) => {
          taskIdRef.current = workflowHandlers.onWorkflowStarted(event)
        },
        onWorkflowFinished: workflowHandlers.onWorkflowFinished,
        onIterationStart: workflowHandlers.onIterationStart,
        onIterationFinish: workflowHandlers.onIterationFinish,
        onLoopStart: workflowHandlers.onLoopStart,
        onLoopFinish: workflowHandlers.onLoopFinish,
        onNodeStarted: workflowHandlers.onNodeStarted,
        onNodeRetry: workflowHandlers.onNodeRetry,
        onNodeFinished: workflowHandlers.onNodeFinished,
        onAgentLog: workflowHandlers.onAgentLog,
      },
    )
  }, [
    threadMessages,
    updateCurrentQAOnTree,
    handleResponding,
    formSettings?.inputsForm,
    handleRun,
    notify,
    t,
    config?.suggested_questions_after_answer?.enabled,
    setTargetMessageId,
    setConversationId,
    setSuggestedQuestions,
    workflowStore,
    hasStopResponded,
    taskIdRef,
    suggestedQuestionsAbortControllerRef,
  ])

  return { handleSend }
}
