import type { SendCallback, SendParams, UpdateCurrentQAParams } from './types'
import type { InputForm } from '@/app/components/base/chat/chat/type'
import type { ChatItem, ChatItemInTree, Inputs } from '@/app/components/base/chat/types'
import { uniqBy } from 'es-toolkit/compat'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidV4 } from 'uuid'
import { getProcessedInputs } from '@/app/components/base/chat/chat/utils'
import { getProcessedFiles, getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import { useToastContext } from '@/app/components/base/toast'
import { useInvalidAllLastRun } from '@/service/use-workflow'
import { TransferMethod } from '@/types/app'
import { useSetWorkflowVarsWithValue, useWorkflowRun } from '../../../hooks'
import { useHooksStore } from '../../../hooks-store'
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
  handleResponding: (responding: boolean) => void
  updateCurrentQAOnTree: (params: UpdateCurrentQAParams) => void
}

export function useChatMessageSender({
  threadMessages,
  config,
  formSettings,
  handleResponding,
  updateCurrentQAOnTree,
}: UseChatMessageSenderParams) {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const { handleRun } = useWorkflowRun()
  const workflowStore = useWorkflowStore()

  const configsMap = useHooksStore(s => s.configsMap)
  const invalidAllLastRun = useInvalidAllLastRun(configsMap?.flowType, configsMap?.flowId)
  const { fetchInspectVars } = useSetWorkflowVarsWithValue()
  const setConversationId = useStore(s => s.setConversationId)
  const setTargetMessageId = useStore(s => s.setTargetMessageId)
  const setSuggestedQuestions = useStore(s => s.setSuggestedQuestions)
  const setActiveTaskId = useStore(s => s.setActiveTaskId)
  const setSuggestedQuestionsAbortController = useStore(s => s.setSuggestedQuestionsAbortController)
  const startRun = useStore(s => s.startRun)

  const handleSend = useCallback((
    params: SendParams,
    { onGetSuggestedQuestions }: SendCallback,
  ) => {
    if (workflowStore.getState().isResponding) {
      notify({ type: 'info', message: t('errorMessage.waitForResponse', { ns: 'appDebug' }) })
      return false
    }

    const { suggestedQuestionsAbortController } = workflowStore.getState()
    if (suggestedQuestionsAbortController)
      suggestedQuestionsAbortController.abort()
    setSuggestedQuestionsAbortController(null)

    const runId = startRun()
    const isCurrentRun = () => runId === workflowStore.getState().activeRunId

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
    let toolCallId = ''
    let thoughtId = ''

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
        onData: (message: string, isFirstMessage: boolean, {
          conversationId: newConversationId,
          messageId,
          taskId,
          chunk_type,
          tool_icon,
          tool_icon_dark,
          tool_name,
          tool_arguments,
          tool_files,
          tool_error,
          tool_elapsed_time,
        }) => {
          if (!isCurrentRun())
            return
          if (chunk_type === 'text') {
            // Append text to toolCalls array to preserve order with tool calls
            if (!responseItem.toolCalls)
              responseItem.toolCalls = []

            const lastItem = responseItem.toolCalls.at(-1)
            if (lastItem?.type === 'text') {
              // Merge consecutive text chunks into the same text item
              lastItem.textContent = (lastItem.textContent || '') + message
            }
            else {
              // Create a new text item
              responseItem.toolCalls.push({
                id: uuidV4(),
                type: 'text',
                textContent: message,
              })
            }
            // Also update content for compatibility
            responseItem.content = responseItem.content + message
          }

          if (chunk_type === 'tool_call') {
            if (!responseItem.toolCalls)
              responseItem.toolCalls = []
            toolCallId = uuidV4()
            responseItem.toolCalls?.push({
              id: toolCallId,
              type: 'tool',
              toolName: tool_name,
              toolArguments: tool_arguments,
              toolIcon: tool_icon,
              toolIconDark: tool_icon_dark,
            })
          }

          if (chunk_type === 'tool_result') {
            const currentToolCallIndex = responseItem.toolCalls?.findIndex(item => item.id === toolCallId) ?? -1

            if (currentToolCallIndex > -1) {
              responseItem.toolCalls![currentToolCallIndex].toolError = tool_error
              responseItem.toolCalls![currentToolCallIndex].toolDuration = tool_elapsed_time
              responseItem.toolCalls![currentToolCallIndex].toolFiles = tool_files
              responseItem.toolCalls![currentToolCallIndex].toolOutput = message
            }
          }

          if (chunk_type === 'thought_start') {
            if (!responseItem.toolCalls)
              responseItem.toolCalls = []
            thoughtId = uuidV4()
            responseItem.toolCalls.push({
              id: thoughtId,
              type: 'thought',
              thoughtOutput: '',
            })
          }

          if (chunk_type === 'thought') {
            const currentThoughtIndex = responseItem.toolCalls?.findIndex(item => item.id === thoughtId) ?? -1
            if (currentThoughtIndex > -1) {
              responseItem.toolCalls![currentThoughtIndex].thoughtOutput += message
            }
          }

          if (chunk_type === 'thought_end') {
            const currentThoughtIndex = responseItem.toolCalls?.findIndex(item => item.id === thoughtId) ?? -1
            if (currentThoughtIndex > -1) {
              responseItem.toolCalls![currentThoughtIndex].thoughtOutput += message
              responseItem.toolCalls![currentThoughtIndex].thoughtCompleted = true
            }
          }

          if (messageId && !hasSetResponseId) {
            questionItem.id = `question-${messageId}`
            responseItem.id = messageId
            responseItem.parentMessageId = questionItem.id
            hasSetResponseId = true
          }

          if (isFirstMessage && newConversationId)
            setConversationId(newConversationId)

          if (taskId)
            setActiveTaskId(taskId)
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
          if (!isCurrentRun())
            return
          handleResponding(false)
          fetchInspectVars({})
          invalidAllLastRun()

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

          if (config?.suggested_questions_after_answer?.enabled && !workflowStore.getState().hasStopResponded && onGetSuggestedQuestions) {
            try {
              const result = await onGetSuggestedQuestions(
                responseItem.id,
                newAbortController => setSuggestedQuestionsAbortController(newAbortController),
              ) as { data: string[] }
              setSuggestedQuestions(result.data)
            }
            catch {
              setSuggestedQuestions([])
            }
            finally {
              setSuggestedQuestionsAbortController(null)
            }
          }
        },
        onMessageEnd: (messageEnd) => {
          if (!isCurrentRun())
            return
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
          if (!isCurrentRun())
            return
          responseItem.content = messageReplace.answer
        },
        onError() {
          if (!isCurrentRun())
            return
          handleResponding(false)
        },
        onWorkflowStarted: (event) => {
          if (!isCurrentRun())
            return
          const taskId = workflowHandlers.onWorkflowStarted(event)
          if (taskId)
            setActiveTaskId(taskId)
        },
        onWorkflowFinished: (event) => {
          if (!isCurrentRun())
            return
          workflowHandlers.onWorkflowFinished(event)
        },
        onIterationStart: (event) => {
          if (!isCurrentRun())
            return
          workflowHandlers.onIterationStart(event)
        },
        onIterationFinish: (event) => {
          if (!isCurrentRun())
            return
          workflowHandlers.onIterationFinish(event)
        },
        onLoopStart: (event) => {
          if (!isCurrentRun())
            return
          workflowHandlers.onLoopStart(event)
        },
        onLoopFinish: (event) => {
          if (!isCurrentRun())
            return
          workflowHandlers.onLoopFinish(event)
        },
        onNodeStarted: (event) => {
          if (!isCurrentRun())
            return
          workflowHandlers.onNodeStarted(event)
        },
        onNodeRetry: (event) => {
          if (!isCurrentRun())
            return
          workflowHandlers.onNodeRetry(event)
        },
        onNodeFinished: (event) => {
          if (!isCurrentRun())
            return
          workflowHandlers.onNodeFinished(event)
        },
        onAgentLog: (event) => {
          if (!isCurrentRun())
            return
          workflowHandlers.onAgentLog(event)
        },
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
    setActiveTaskId,
    setSuggestedQuestionsAbortController,
    startRun,
    fetchInspectVars,
    invalidAllLastRun,
    workflowStore,
  ])

  return { handleSend }
}
