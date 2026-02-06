import type {
  SendCallback,
  SendParams,
  UpdateCurrentQAParams,
} from './types'
import type { InputForm } from '@/app/components/base/chat/chat/type'
import type {
  ChatItem,
  ChatItemInTree,
  Inputs,
} from '@/app/components/base/chat/types'
import type { IOnDataMoreInfo, IOtherOptions } from '@/service/base'
import type {
  HumanInputFilledFormData,
  HumanInputFormData,
  HumanInputFormTimeoutData,
  NodeTracing,
} from '@/types/workflow'
import { uniqBy } from 'es-toolkit/compat'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidV4 } from 'uuid'
import { getProcessedInputs } from '@/app/components/base/chat/chat/utils'
import {
  getProcessedFiles,
  getProcessedFilesFromResponse,
} from '@/app/components/base/file-uploader/utils'
import { useToastContext } from '@/app/components/base/toast'
import {
  sseGet,
} from '@/service/base'
import { useInvalidateSandboxFiles } from '@/service/use-sandbox-file'
import { useInvalidAllLastRun } from '@/service/use-workflow'
import { submitHumanInputForm } from '@/service/workflow'
import { TransferMethod } from '@/types/app'
import {
  useSetWorkflowVarsWithValue,
  useWorkflowRun,
} from '../../../hooks'
import { useHooksStore } from '../../../hooks-store'
import { useStore, useWorkflowStore } from '../../../store'
import {
  NodeRunningStatus,
  WorkflowRunningStatus,
} from '../../../types'
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

type StreamChunkMeta = IOnDataMoreInfo

type WorkflowStartedEvent = {
  workflow_run_id: string
  task_id: string
  conversation_id?: string
  message_id?: string
}

const getSuggestedQuestionsFromResult = (result: unknown): string[] => {
  if (!result || typeof result !== 'object' || !('data' in result))
    return []

  const data = (result as { data: unknown }).data
  if (!Array.isArray(data))
    return []

  return data.filter((item): item is string => typeof item === 'string')
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
  const invalidateSandboxFiles = useInvalidateSandboxFiles()
  const { fetchInspectVars } = useSetWorkflowVarsWithValue()

  const chatTree = useStore(s => s.chatTree)
  const updateChatTree = useStore(s => s.updateChatTree)
  const setConversationId = useStore(s => s.setConversationId)
  const setTargetMessageId = useStore(s => s.setTargetMessageId)
  const setSuggestedQuestions = useStore(s => s.setSuggestedQuestions)
  const setActiveTaskId = useStore(s => s.setActiveTaskId)
  const setHasStopResponded = useStore(s => s.setHasStopResponded)
  const setSuggestedQuestionsAbortController = useStore(s => s.setSuggestedQuestionsAbortController)
  const setWorkflowEventsAbortController = useStore(s => s.setWorkflowEventsAbortController)
  const startRun = useStore(s => s.startRun)

  const updateChatTreeNode = useCallback((messageId: string, updater: (item: ChatItemInTree) => void) => {
    updateChatTree((currentTree) => {
      return produce(currentTree, (draft) => {
        const queue: ChatItemInTree[] = [...draft]
        while (queue.length > 0) {
          const current = queue.shift()!
          if (current.id === messageId) {
            updater(current)
            break
          }
          if (current.children)
            queue.push(...current.children)
        }
      })
    })
  }, [updateChatTree])

  const handleSend = useCallback((
    params: SendParams,
    { onGetSuggestedQuestions }: SendCallback,
  ) => {
    if (workflowStore.getState().isResponding) {
      notify({ type: 'info', message: t('errorMessage.waitForResponse', { ns: 'appDebug' }) })
      return false
    }

    const {
      suggestedQuestionsAbortController,
      workflowEventsAbortController,
    } = workflowStore.getState()

    if (suggestedQuestionsAbortController)
      suggestedQuestionsAbortController.abort()
    if (workflowEventsAbortController)
      workflowEventsAbortController.abort()

    setSuggestedQuestionsAbortController(null)
    setWorkflowEventsAbortController(null)

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

    const siblingIndex = parentMessage?.children?.length ?? chatTree.length
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
      humanInputFormDataList: [],
      humanInputFilledFormDataList: [],
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
        getAbortController: (abortController) => {
          setWorkflowEventsAbortController(abortController)
        },
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
        }: StreamChunkMeta) => {
          if (!isCurrentRun())
            return

          if (chunk_type === 'text' || !chunk_type) {
            responseItem.content = `${responseItem.content}${message}`

            if (!responseItem.llmGenerationItems)
              responseItem.llmGenerationItems = []

            const isNotCompletedTextItemIndex = responseItem.llmGenerationItems.findIndex(item => item.type === 'text' && !item.textCompleted)
            if (isNotCompletedTextItemIndex > -1) {
              responseItem.llmGenerationItems[isNotCompletedTextItemIndex].text += message
            }
            else {
              toolCallId = uuidV4()
              responseItem.llmGenerationItems.push({
                id: toolCallId,
                type: 'text',
                text: message,
              })
            }
          }

          if (chunk_type === 'tool_call') {
            if (!responseItem.llmGenerationItems)
              responseItem.llmGenerationItems = []

            const isNotCompletedTextItemIndex = responseItem.llmGenerationItems.findIndex(item => item.type === 'text' && !item.textCompleted)
            if (isNotCompletedTextItemIndex > -1)
              responseItem.llmGenerationItems[isNotCompletedTextItemIndex].textCompleted = true

            toolCallId = uuidV4()
            responseItem.llmGenerationItems.push({
              id: toolCallId,
              type: 'tool',
              toolName: tool_name,
              toolArguments: tool_arguments,
              toolIcon: tool_icon,
              toolIconDark: tool_icon_dark,
            })
          }

          if (chunk_type === 'tool_result') {
            const currentToolCallIndex = responseItem.llmGenerationItems?.findIndex(item => item.id === toolCallId) ?? -1
            if (currentToolCallIndex > -1) {
              responseItem.llmGenerationItems![currentToolCallIndex].toolError = tool_error
              responseItem.llmGenerationItems![currentToolCallIndex].toolDuration = tool_elapsed_time
              responseItem.llmGenerationItems![currentToolCallIndex].toolFiles = tool_files
              responseItem.llmGenerationItems![currentToolCallIndex].toolOutput = message
            }
          }

          if (chunk_type === 'thought_start') {
            if (!responseItem.llmGenerationItems)
              responseItem.llmGenerationItems = []

            const isNotCompletedTextItemIndex = responseItem.llmGenerationItems.findIndex(item => item.type === 'text' && !item.textCompleted)
            if (isNotCompletedTextItemIndex > -1)
              responseItem.llmGenerationItems[isNotCompletedTextItemIndex].textCompleted = true

            thoughtId = uuidV4()
            responseItem.llmGenerationItems.push({
              id: thoughtId,
              type: 'thought',
              thoughtOutput: '',
            })
          }

          if (chunk_type === 'thought') {
            const currentThoughtIndex = responseItem.llmGenerationItems?.findIndex(item => item.id === thoughtId) ?? -1
            if (currentThoughtIndex > -1)
              responseItem.llmGenerationItems![currentThoughtIndex].thoughtOutput += message
          }

          if (chunk_type === 'thought_end') {
            const currentThoughtIndex = responseItem.llmGenerationItems?.findIndex(item => item.id === thoughtId) ?? -1
            if (currentThoughtIndex > -1) {
              responseItem.llmGenerationItems![currentThoughtIndex].thoughtOutput += message
              responseItem.llmGenerationItems![currentThoughtIndex].thoughtCompleted = true
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

          const { workflowRunningData } = workflowStore.getState()
          handleResponding(false)
          setWorkflowEventsAbortController(null)

          if (workflowRunningData?.result.status !== WorkflowRunningStatus.Paused) {
            fetchInspectVars({})
            invalidAllLastRun()
            invalidateSandboxFiles()

            if (hasError) {
              if (errorMessage) {
                responseItem.content = errorMessage
                responseItem.isError = true
                responseItem.llmGenerationItems?.forEach((item) => {
                  if (item.type === 'text')
                    item.isError = true
                })
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
                )
                setSuggestedQuestions(getSuggestedQuestionsFromResult(result))
              }
              catch {
                setSuggestedQuestions([])
              }
              finally {
                setSuggestedQuestionsAbortController(null)
              }
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
          setWorkflowEventsAbortController(null)
        },
        onWorkflowStarted: (event) => {
          if (!isCurrentRun())
            return

          const workflowStartEvent = event as WorkflowStartedEvent
          if (workflowStartEvent.conversation_id)
            setConversationId(workflowStartEvent.conversation_id)

          if (workflowStartEvent.message_id && !hasSetResponseId) {
            questionItem.id = `question-${workflowStartEvent.message_id}`
            responseItem.id = workflowStartEvent.message_id
            responseItem.parentMessageId = questionItem.id
            hasSetResponseId = true
          }

          const taskId = workflowHandlers.onWorkflowStarted(workflowStartEvent)
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
        onHumanInputRequired: (event) => {
          if (!isCurrentRun())
            return
          workflowHandlers.onHumanInputRequired(event)
        },
        onHumanInputFormFilled: (event) => {
          if (!isCurrentRun())
            return
          workflowHandlers.onHumanInputFormFilled(event)
        },
        onHumanInputFormTimeout: (event) => {
          if (!isCurrentRun())
            return
          workflowHandlers.onHumanInputFormTimeout(event)
        },
        onWorkflowPaused: () => {
          if (!isCurrentRun())
            return
          workflowHandlers.onWorkflowPaused()
        },
      },
    )
    return true
  }, [
    workflowStore,
    notify,
    t,
    setSuggestedQuestionsAbortController,
    setWorkflowEventsAbortController,
    startRun,
    threadMessages,
    chatTree.length,
    setTargetMessageId,
    updateCurrentQAOnTree,
    handleResponding,
    formSettings?.inputsForm,
    handleRun,
    setConversationId,
    setActiveTaskId,
    fetchInspectVars,
    invalidAllLastRun,
    invalidateSandboxFiles,
    config?.suggested_questions_after_answer?.enabled,
    setSuggestedQuestions,
  ])

  const handleSubmitHumanInputForm = useCallback(async (formToken: string, formData: {
    inputs: Record<string, string>
    action: string
  }) => {
    await submitHumanInputForm(formToken, formData)
  }, [])

  const handleResume = useCallback((
    messageId: string,
    workflowRunId: string,
    {
      onGetSuggestedQuestions,
    }: SendCallback,
  ) => {
    const url = `/workflow/${workflowRunId}/events?include_state_snapshot=true`
    let toolCallId = ''
    let thoughtId = ''

    const otherOptions: IOtherOptions = {
      getAbortController: (abortController) => {
        setWorkflowEventsAbortController(abortController)
      },
      onData: (message: string, _isFirstMessage: boolean, {
        conversationId: newConversationId,
        messageId: msgId,
        taskId,
        chunk_type,
        tool_icon,
        tool_icon_dark,
        tool_name,
        tool_arguments,
        tool_files,
        tool_error,
        tool_elapsed_time,
      }: StreamChunkMeta) => {
        updateChatTreeNode(messageId, (responseItem) => {
          if (chunk_type === 'text' || !chunk_type) {
            responseItem.content = `${responseItem.content}${message}`
            if (!responseItem.llmGenerationItems)
              responseItem.llmGenerationItems = []

            const isNotCompletedTextItemIndex = responseItem.llmGenerationItems.findIndex(item => item.type === 'text' && !item.textCompleted)
            if (isNotCompletedTextItemIndex > -1) {
              responseItem.llmGenerationItems[isNotCompletedTextItemIndex].text += message
            }
            else {
              toolCallId = uuidV4()
              responseItem.llmGenerationItems.push({
                id: toolCallId,
                type: 'text',
                text: message,
              })
            }
          }

          if (chunk_type === 'tool_call') {
            if (!responseItem.llmGenerationItems)
              responseItem.llmGenerationItems = []

            const isNotCompletedTextItemIndex = responseItem.llmGenerationItems.findIndex(item => item.type === 'text' && !item.textCompleted)
            if (isNotCompletedTextItemIndex > -1)
              responseItem.llmGenerationItems[isNotCompletedTextItemIndex].textCompleted = true

            toolCallId = uuidV4()
            responseItem.llmGenerationItems.push({
              id: toolCallId,
              type: 'tool',
              toolName: tool_name,
              toolArguments: tool_arguments,
              toolIcon: tool_icon,
              toolIconDark: tool_icon_dark,
            })
          }

          if (chunk_type === 'tool_result') {
            const currentToolCallIndex = responseItem.llmGenerationItems?.findIndex(item => item.id === toolCallId) ?? -1
            if (currentToolCallIndex > -1) {
              responseItem.llmGenerationItems![currentToolCallIndex].toolError = tool_error
              responseItem.llmGenerationItems![currentToolCallIndex].toolDuration = tool_elapsed_time
              responseItem.llmGenerationItems![currentToolCallIndex].toolFiles = tool_files
              responseItem.llmGenerationItems![currentToolCallIndex].toolOutput = message
            }
          }

          if (chunk_type === 'thought_start') {
            if (!responseItem.llmGenerationItems)
              responseItem.llmGenerationItems = []

            const isNotCompletedTextItemIndex = responseItem.llmGenerationItems.findIndex(item => item.type === 'text' && !item.textCompleted)
            if (isNotCompletedTextItemIndex > -1)
              responseItem.llmGenerationItems[isNotCompletedTextItemIndex].textCompleted = true

            thoughtId = uuidV4()
            responseItem.llmGenerationItems.push({
              id: thoughtId,
              type: 'thought',
              thoughtOutput: '',
            })
          }

          if (chunk_type === 'thought') {
            const currentThoughtIndex = responseItem.llmGenerationItems?.findIndex(item => item.id === thoughtId) ?? -1
            if (currentThoughtIndex > -1)
              responseItem.llmGenerationItems![currentThoughtIndex].thoughtOutput += message
          }

          if (chunk_type === 'thought_end') {
            const currentThoughtIndex = responseItem.llmGenerationItems?.findIndex(item => item.id === thoughtId) ?? -1
            if (currentThoughtIndex > -1) {
              responseItem.llmGenerationItems![currentThoughtIndex].thoughtOutput += message
              responseItem.llmGenerationItems![currentThoughtIndex].thoughtCompleted = true
            }
          }

          if (msgId)
            responseItem.id = msgId
        })

        if (newConversationId)
          setConversationId(newConversationId)
        if (taskId)
          setActiveTaskId(taskId)
      },
      async onCompleted(hasError?: boolean) {
        const { workflowRunningData, hasStopResponded } = workflowStore.getState()
        handleResponding(false)
        setWorkflowEventsAbortController(null)

        if (workflowRunningData?.result.status !== WorkflowRunningStatus.Paused) {
          fetchInspectVars({})
          invalidAllLastRun()
          invalidateSandboxFiles()

          if (hasError)
            return

          if (config?.suggested_questions_after_answer?.enabled && !hasStopResponded && onGetSuggestedQuestions) {
            try {
              const result = await onGetSuggestedQuestions(
                messageId,
                newAbortController => setSuggestedQuestionsAbortController(newAbortController),
              )
              setSuggestedQuestions(getSuggestedQuestionsFromResult(result))
            }
            catch {
              setSuggestedQuestions([])
            }
            finally {
              setSuggestedQuestionsAbortController(null)
            }
          }
        }
      },
      onMessageEnd: (messageEnd) => {
        updateChatTreeNode(messageId, (responseItem) => {
          responseItem.citation = messageEnd.metadata?.retriever_resources || []
          const processedFilesFromResponse = getProcessedFilesFromResponse(messageEnd.files || [])
          responseItem.allFiles = uniqBy([...(responseItem.allFiles || []), ...(processedFilesFromResponse || [])], 'id')
        })
      },
      onMessageReplace: (messageReplace) => {
        updateChatTreeNode(messageId, (responseItem) => {
          responseItem.content = messageReplace.answer
        })
      },
      onError() {
        handleResponding(false)
        setWorkflowEventsAbortController(null)
      },
      onWorkflowStarted: ({ workflow_run_id, task_id }: WorkflowStartedEvent) => {
        handleResponding(true)
        setHasStopResponded(false)
        updateChatTreeNode(messageId, (responseItem) => {
          if (responseItem.workflowProcess && responseItem.workflowProcess.tracing.length > 0) {
            responseItem.workflowProcess.status = WorkflowRunningStatus.Running
          }
          else {
            if (task_id)
              setActiveTaskId(task_id)
            responseItem.workflow_run_id = workflow_run_id
            responseItem.workflowProcess = {
              status: WorkflowRunningStatus.Running,
              tracing: [],
            }
          }
        })
      },
      onWorkflowFinished: ({ data: workflowFinishedData }) => {
        updateChatTreeNode(messageId, (responseItem) => {
          if (responseItem.workflowProcess)
            responseItem.workflowProcess.status = workflowFinishedData.status as WorkflowRunningStatus
        })
      },
      onIterationStart: ({ data: iterationStartedData }) => {
        updateChatTreeNode(messageId, (responseItem) => {
          if (!responseItem.workflowProcess)
            return
          if (!responseItem.workflowProcess.tracing)
            responseItem.workflowProcess.tracing = []
          responseItem.workflowProcess.tracing.push({
            ...iterationStartedData,
            status: WorkflowRunningStatus.Running,
          } as NodeTracing)
        })
      },
      onIterationFinish: ({ data: iterationFinishedData }) => {
        updateChatTreeNode(messageId, (responseItem) => {
          if (!responseItem.workflowProcess?.tracing)
            return
          const tracing = responseItem.workflowProcess.tracing
          const iterationIndex = tracing.findIndex(item => item.node_id === iterationFinishedData.node_id
            && (item.execution_metadata?.parallel_id === iterationFinishedData.execution_metadata?.parallel_id || item.parallel_id === iterationFinishedData.execution_metadata?.parallel_id))
          if (iterationIndex > -1) {
            tracing[iterationIndex] = {
              ...tracing[iterationIndex],
              ...iterationFinishedData,
              status: WorkflowRunningStatus.Succeeded,
            }
          }
        })
      },
      onNodeStarted: ({ data: nodeStartedData }) => {
        updateChatTreeNode(messageId, (responseItem) => {
          if (!responseItem.workflowProcess)
            return
          if (!responseItem.workflowProcess.tracing)
            responseItem.workflowProcess.tracing = []

          const currentIndex = responseItem.workflowProcess.tracing.findIndex(item => item.node_id === nodeStartedData.node_id)
          if (currentIndex > -1) {
            responseItem.workflowProcess.tracing[currentIndex] = {
              ...nodeStartedData,
              status: NodeRunningStatus.Running,
            } as NodeTracing
          }
          else {
            if (nodeStartedData.iteration_id)
              return

            responseItem.workflowProcess.tracing.push({
              ...nodeStartedData,
              status: WorkflowRunningStatus.Running,
            } as NodeTracing)
          }
        })
      },
      onNodeFinished: ({ data: nodeFinishedData }) => {
        updateChatTreeNode(messageId, (responseItem) => {
          if (!responseItem.workflowProcess?.tracing)
            return
          if (nodeFinishedData.iteration_id)
            return

          const currentIndex = responseItem.workflowProcess.tracing.findIndex((item) => {
            if (!item.execution_metadata?.parallel_id)
              return item.id === nodeFinishedData.id

            return item.id === nodeFinishedData.id && item.execution_metadata.parallel_id === nodeFinishedData.execution_metadata?.parallel_id
          })

          if (currentIndex > -1)
            responseItem.workflowProcess.tracing[currentIndex] = nodeFinishedData as NodeTracing
        })
      },
      onLoopStart: ({ data: loopStartedData }) => {
        updateChatTreeNode(messageId, (responseItem) => {
          if (!responseItem.workflowProcess)
            return
          if (!responseItem.workflowProcess.tracing)
            responseItem.workflowProcess.tracing = []
          responseItem.workflowProcess.tracing.push({
            ...loopStartedData,
            status: WorkflowRunningStatus.Running,
          } as NodeTracing)
        })
      },
      onLoopFinish: ({ data: loopFinishedData }) => {
        updateChatTreeNode(messageId, (responseItem) => {
          if (!responseItem.workflowProcess?.tracing)
            return
          const tracing = responseItem.workflowProcess.tracing
          const loopIndex = tracing.findIndex(item => item.node_id === loopFinishedData.node_id
            && (item.execution_metadata?.parallel_id === loopFinishedData.execution_metadata?.parallel_id || item.parallel_id === loopFinishedData.execution_metadata?.parallel_id))
          if (loopIndex > -1) {
            tracing[loopIndex] = {
              ...tracing[loopIndex],
              ...loopFinishedData,
              status: WorkflowRunningStatus.Succeeded,
            }
          }
        })
      },
      onHumanInputRequired: ({ data: humanInputRequiredData }: { data: HumanInputFormData }) => {
        updateChatTreeNode(messageId, (responseItem) => {
          if (!responseItem.humanInputFormDataList) {
            responseItem.humanInputFormDataList = [humanInputRequiredData]
          }
          else {
            const currentFormIndex = responseItem.humanInputFormDataList.findIndex(item => item.node_id === humanInputRequiredData.node_id)
            if (currentFormIndex > -1)
              responseItem.humanInputFormDataList[currentFormIndex] = humanInputRequiredData
            else
              responseItem.humanInputFormDataList.push(humanInputRequiredData)
          }

          if (responseItem.workflowProcess?.tracing) {
            const currentTracingIndex = responseItem.workflowProcess.tracing.findIndex(item => item.node_id === humanInputRequiredData.node_id)
            if (currentTracingIndex > -1)
              responseItem.workflowProcess.tracing[currentTracingIndex].status = NodeRunningStatus.Paused
          }
        })
      },
      onHumanInputFormFilled: ({ data: humanInputFilledFormData }: { data: HumanInputFilledFormData }) => {
        updateChatTreeNode(messageId, (responseItem) => {
          if (responseItem.humanInputFormDataList?.length) {
            const currentFormIndex = responseItem.humanInputFormDataList.findIndex(item => item.node_id === humanInputFilledFormData.node_id)
            if (currentFormIndex > -1)
              responseItem.humanInputFormDataList.splice(currentFormIndex, 1)
          }
          if (!responseItem.humanInputFilledFormDataList)
            responseItem.humanInputFilledFormDataList = [humanInputFilledFormData]
          else
            responseItem.humanInputFilledFormDataList.push(humanInputFilledFormData)
        })
      },
      onHumanInputFormTimeout: ({ data: humanInputFormTimeoutData }: { data: HumanInputFormTimeoutData }) => {
        updateChatTreeNode(messageId, (responseItem) => {
          if (responseItem.humanInputFormDataList?.length) {
            const currentFormIndex = responseItem.humanInputFormDataList.findIndex(item => item.node_id === humanInputFormTimeoutData.node_id)
            if (currentFormIndex > -1)
              responseItem.humanInputFormDataList[currentFormIndex].expiration_time = humanInputFormTimeoutData.expiration_time
          }
        })
      },
      onWorkflowPaused: ({ data: workflowPausedData }: { data: { workflow_run_id: string } }) => {
        const resumeUrl = `/workflow/${workflowPausedData.workflow_run_id}/events`
        sseGet(
          resumeUrl,
          {},
          otherOptions,
        )
        updateChatTreeNode(messageId, (responseItem) => {
          if (responseItem.workflowProcess)
            responseItem.workflowProcess.status = WorkflowRunningStatus.Paused
        })
      },
    }

    const { workflowEventsAbortController } = workflowStore.getState()
    if (workflowEventsAbortController)
      workflowEventsAbortController.abort()

    setWorkflowEventsAbortController(null)

    sseGet(
      url,
      {},
      otherOptions,
    )
  }, [
    workflowStore,
    setWorkflowEventsAbortController,
    updateChatTreeNode,
    setConversationId,
    setActiveTaskId,
    handleResponding,
    setHasStopResponded,
    fetchInspectVars,
    invalidAllLastRun,
    invalidateSandboxFiles,
    config?.suggested_questions_after_answer?.enabled,
    setSuggestedQuestions,
    setSuggestedQuestionsAbortController,
  ])

  return {
    handleSend,
    handleResume,
    handleSubmitHumanInputForm,
  }
}
