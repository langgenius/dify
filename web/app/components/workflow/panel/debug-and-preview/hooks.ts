import type { InputForm } from '@/app/components/base/chat/chat/type'
import type {
  ChatItem,
  ChatItemInTree,
  Inputs,
} from '@/app/components/base/chat/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { IOtherOptions } from '@/service/base'
import { uniqBy } from 'es-toolkit/compat'
import { produce, setAutoFreeze } from 'immer'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import {
  getProcessedInputs,
  processOpeningStatement,
} from '@/app/components/base/chat/chat/utils'
import { getThreadMessages } from '@/app/components/base/chat/utils'
import {
  getProcessedFiles,
  getProcessedFilesFromResponse,
} from '@/app/components/base/file-uploader/utils'
import { useToastContext } from '@/app/components/base/toast'
import {
  CUSTOM_NODE,
} from '@/app/components/workflow/constants'
import { sseGet } from '@/service/base'
import { useInvalidAllLastRun } from '@/service/use-workflow'
import { submitHumanInputForm } from '@/service/workflow'
import { TransferMethod } from '@/types/app'
import { DEFAULT_ITER_TIMES, DEFAULT_LOOP_TIMES } from '../../constants'
import {
  useSetWorkflowVarsWithValue,
  useWorkflowRun,
} from '../../hooks'
import { useHooksStore } from '../../hooks-store'
import { useWorkflowStore } from '../../store'
import { NodeRunningStatus, WorkflowRunningStatus } from '../../types'

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
  prevChatTree?: ChatItemInTree[],
  stopChat?: (taskId: string) => void,
) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const { handleRun } = useWorkflowRun()
  const hasStopResponded = useRef(false)
  const workflowStore = useWorkflowStore()
  const conversationId = useRef('')
  const taskIdRef = useRef('')
  const [isResponding, setIsResponding] = useState(false)
  const isRespondingRef = useRef(false)
  const workflowEventsAbortControllerRef = useRef<AbortController | null>(null)
  const configsMap = useHooksStore(s => s.configsMap)
  const invalidAllLastRun = useInvalidAllLastRun(configsMap?.flowType, configsMap?.flowId)
  const { fetchInspectVars } = useSetWorkflowVarsWithValue()
  const [suggestedQuestions, setSuggestQuestions] = useState<string[]>([])
  const suggestedQuestionsAbortControllerRef = useRef<AbortController | null>(null)
  const {
    setIterTimes,
    setLoopTimes,
  } = workflowStore.getState()
  const store = useStoreApi()

  const handleResponding = useCallback((isResponding: boolean) => {
    setIsResponding(isResponding)
    isRespondingRef.current = isResponding
  }, [])

  const [chatTree, setChatTree] = useState<ChatItemInTree[]>(prevChatTree || [])
  const chatTreeRef = useRef<ChatItemInTree[]>(chatTree)
  const [targetMessageId, setTargetMessageId] = useState<string>()
  const threadMessages = useMemo(() => getThreadMessages(chatTree, targetMessageId), [chatTree, targetMessageId])

  const getIntroduction = useCallback((str: string) => {
    return processOpeningStatement(str, formSettings?.inputs || {}, formSettings?.inputsForm || [])
  }, [formSettings?.inputs, formSettings?.inputsForm])

  /** Final chat list that will be rendered */
  const chatList = useMemo(() => {
    const ret = [...threadMessages]
    if (config?.opening_statement) {
      const index = threadMessages.findIndex(item => item.isOpeningStatement)

      if (index > -1) {
        ret[index] = {
          ...ret[index],
          content: getIntroduction(config.opening_statement),
          suggestedQuestions: config.suggested_questions?.map((item: string) => getIntroduction(item)),
        }
      }
      else {
        ret.unshift({
          id: `${Date.now()}`,
          content: getIntroduction(config.opening_statement),
          isAnswer: true,
          isOpeningStatement: true,
          suggestedQuestions: config.suggested_questions?.map((item: string) => getIntroduction(item)),
        })
      }
    }
    return ret
  }, [threadMessages, config?.opening_statement, getIntroduction, config?.suggested_questions])

  useEffect(() => {
    setAutoFreeze(false)
    return () => {
      setAutoFreeze(true)
    }
  }, [])

  /** Find the target node by bfs and then operate on it */
  const produceChatTreeNode = useCallback((targetId: string, operation: (node: ChatItemInTree) => void) => {
    return produce(chatTreeRef.current, (draft) => {
      const queue: ChatItemInTree[] = [...draft]
      while (queue.length > 0) {
        const current = queue.shift()!
        if (current.id === targetId) {
          operation(current)
          break
        }
        if (current.children)
          queue.push(...current.children)
      }
    })
  }, [])

  type UpdateChatTreeNode = {
    (id: string, fields: Partial<ChatItemInTree>): void
    (id: string, update: (node: ChatItemInTree) => void): void
  }

  const updateChatTreeNode: UpdateChatTreeNode = useCallback((
    id: string,
    fieldsOrUpdate: Partial<ChatItemInTree> | ((node: ChatItemInTree) => void),
  ) => {
    const nextState = produceChatTreeNode(id, (node) => {
      if (typeof fieldsOrUpdate === 'function') {
        fieldsOrUpdate(node)
      }
      else {
        Object.keys(fieldsOrUpdate).forEach((key) => {
          (node as any)[key] = (fieldsOrUpdate as any)[key]
        })
      }
    })
    setChatTree(nextState)
    chatTreeRef.current = nextState
  }, [produceChatTreeNode])

  const handleStop = useCallback(() => {
    hasStopResponded.current = true
    handleResponding(false)
    if (stopChat && taskIdRef.current)
      stopChat(taskIdRef.current)
    setIterTimes(DEFAULT_ITER_TIMES)
    setLoopTimes(DEFAULT_LOOP_TIMES)
    if (suggestedQuestionsAbortControllerRef.current)
      suggestedQuestionsAbortControllerRef.current.abort()
    if (workflowEventsAbortControllerRef.current)
      workflowEventsAbortControllerRef.current.abort()
  }, [handleResponding, setIterTimes, setLoopTimes, stopChat])

  const handleRestart = useCallback(() => {
    conversationId.current = ''
    taskIdRef.current = ''
    handleStop()
    setIterTimes(DEFAULT_ITER_TIMES)
    setLoopTimes(DEFAULT_LOOP_TIMES)
    setChatTree([])
    setSuggestQuestions([])
  }, [
    handleStop,
    setIterTimes,
    setLoopTimes,
  ])

  const updateCurrentQAOnTree = useCallback(({
    parentId,
    responseItem,
    placeholderQuestionId,
    questionItem,
  }: {
    parentId?: string
    responseItem: ChatItem
    placeholderQuestionId: string
    questionItem: ChatItem
  }) => {
    let nextState: ChatItemInTree[]
    const currentQA = { ...questionItem, children: [{ ...responseItem, children: [] }] }
    if (!parentId && !chatTree.some(item => [placeholderQuestionId, questionItem.id].includes(item.id))) {
      // QA whose parent is not provided is considered as a first message of the conversation,
      // and it should be a root node of the chat tree
      nextState = produce(chatTree, (draft) => {
        draft.push(currentQA)
      })
    }
    else {
      // find the target QA in the tree and update it; if not found, insert it to its parent node
      nextState = produceChatTreeNode(parentId!, (parentNode) => {
        const questionNodeIndex = parentNode.children!.findIndex(item => [placeholderQuestionId, questionItem.id].includes(item.id))
        if (questionNodeIndex === -1)
          parentNode.children!.push(currentQA)
        else
          parentNode.children![questionNodeIndex] = currentQA
      })
    }
    setChatTree(nextState)
    chatTreeRef.current = nextState
  }, [chatTree, produceChatTreeNode])

  const handleSend = useCallback((
    params: {
      query: string
      files?: FileEntity[]
      parent_message_id?: string
      [key: string]: any
    },
    {
      onGetSuggestedQuestions,
    }: SendCallback,
  ) => {
    if (isRespondingRef.current) {
      notify({ type: 'info', message: t('errorMessage.waitForResponse', { ns: 'appDebug' }) })
      return false
    }

    // Abort previous handleResume SSE connection if any
    if (workflowEventsAbortControllerRef.current)
      workflowEventsAbortControllerRef.current.abort()

    const parentMessage = threadMessages.find(item => item.id === params.parent_message_id)

    const placeholderQuestionId = `question-${Date.now()}`
    const questionItem = {
      id: placeholderQuestionId,
      content: params.query,
      isAnswer: false,
      message_files: params.files,
      parentMessageId: params.parent_message_id,
    }

    const placeholderAnswerId = `answer-placeholder-${Date.now()}`
    const placeholderAnswerItem = {
      id: placeholderAnswerId,
      content: '',
      isAnswer: true,
      parentMessageId: questionItem.id,
      siblingIndex: parentMessage?.children?.length ?? chatTree.length,
    }

    setTargetMessageId(parentMessage?.id)
    updateCurrentQAOnTree({
      parentId: params.parent_message_id,
      responseItem: placeholderAnswerItem,
      placeholderQuestionId,
      questionItem,
    })

    // answer
    const responseItem: ChatItem = {
      id: placeholderAnswerId,
      content: '',
      agent_thoughts: [],
      message_files: [],
      isAnswer: true,
      parentMessageId: questionItem.id,
      siblingIndex: parentMessage?.children?.length ?? chatTree.length,
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

    handleRun(
      bodyParams,
      {
        getAbortController: (abortController) => {
          workflowEventsAbortControllerRef.current = abortController
        },
        onData: (message: string, isFirstMessage: boolean, { conversationId: newConversationId, messageId, taskId }: any) => {
          responseItem.content = responseItem.content + message

          if (messageId && !hasSetResponseId) {
            questionItem.id = `question-${messageId}`
            responseItem.id = messageId
            responseItem.parentMessageId = questionItem.id
            hasSetResponseId = true
          }

          if (isFirstMessage && newConversationId)
            conversationId.current = newConversationId

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
          const { workflowRunningData } = workflowStore.getState()
          handleResponding(false)
          if (workflowRunningData?.result.status !== WorkflowRunningStatus.Paused) {
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
        onWorkflowStarted: ({ workflow_run_id, task_id, conversation_id, message_id }) => {
          // If there are no streaming messages, we still need to set the conversation_id to avoid create a new conversation when regeneration in chat-flow.
          if (conversation_id) {
            conversationId.current = conversation_id
          }
          if (message_id && !hasSetResponseId) {
            questionItem.id = `question-${message_id}`
            responseItem.id = message_id
            responseItem.parentMessageId = questionItem.id
            hasSetResponseId = true
          }

          if (responseItem.workflowProcess && responseItem.workflowProcess.tracing.length > 0) {
            handleResponding(true)
            responseItem.workflowProcess.status = WorkflowRunningStatus.Running
          }
          else {
            taskIdRef.current = task_id
            responseItem.workflow_run_id = workflow_run_id
            responseItem.workflowProcess = {
              status: WorkflowRunningStatus.Running,
              tracing: [],
            }
          }
          updateCurrentQAOnTree({
            placeholderQuestionId,
            questionItem,
            responseItem,
            parentId: params.parent_message_id,
          })
        },
        onWorkflowFinished: ({ data }) => {
          responseItem.workflowProcess!.status = data.status as WorkflowRunningStatus
          updateCurrentQAOnTree({
            placeholderQuestionId,
            questionItem,
            responseItem,
            parentId: params.parent_message_id,
          })
        },
        onIterationStart: ({ data }) => {
          responseItem.workflowProcess!.tracing!.push({
            ...data,
            status: NodeRunningStatus.Running,
          })
          updateCurrentQAOnTree({
            placeholderQuestionId,
            questionItem,
            responseItem,
            parentId: params.parent_message_id,
          })
        },
        onIterationFinish: ({ data }) => {
          const currentTracingIndex = responseItem.workflowProcess!.tracing!.findIndex(item => item.id === data.id)
          if (currentTracingIndex > -1) {
            responseItem.workflowProcess!.tracing[currentTracingIndex] = {
              ...responseItem.workflowProcess!.tracing[currentTracingIndex],
              ...data,
            }
            updateCurrentQAOnTree({
              placeholderQuestionId,
              questionItem,
              responseItem,
              parentId: params.parent_message_id,
            })
          }
        },
        onLoopStart: ({ data }) => {
          responseItem.workflowProcess!.tracing!.push({
            ...data,
            status: NodeRunningStatus.Running,
          })
          updateCurrentQAOnTree({
            placeholderQuestionId,
            questionItem,
            responseItem,
            parentId: params.parent_message_id,
          })
        },
        onLoopFinish: ({ data }) => {
          const currentTracingIndex = responseItem.workflowProcess!.tracing!.findIndex(item => item.id === data.id)
          if (currentTracingIndex > -1) {
            responseItem.workflowProcess!.tracing[currentTracingIndex] = {
              ...responseItem.workflowProcess!.tracing[currentTracingIndex],
              ...data,
            }
            updateCurrentQAOnTree({
              placeholderQuestionId,
              questionItem,
              responseItem,
              parentId: params.parent_message_id,
            })
          }
        },
        onNodeStarted: ({ data }) => {
          const currentIndex = responseItem.workflowProcess!.tracing!.findIndex(item => item.node_id === data.node_id)
          if (currentIndex > -1) {
            responseItem.workflowProcess!.tracing![currentIndex] = {
              ...data,
              status: NodeRunningStatus.Running,
            }
          }
          else {
            responseItem.workflowProcess!.tracing!.push({
              ...data,
              status: NodeRunningStatus.Running,
            })
          }
          updateCurrentQAOnTree({
            placeholderQuestionId,
            questionItem,
            responseItem,
            parentId: params.parent_message_id,
          })
        },
        onNodeRetry: ({ data }) => {
          responseItem.workflowProcess!.tracing!.push(data)

          updateCurrentQAOnTree({
            placeholderQuestionId,
            questionItem,
            responseItem,
            parentId: params.parent_message_id,
          })
        },
        onNodeFinished: ({ data }) => {
          const currentTracingIndex = responseItem.workflowProcess!.tracing!.findIndex(item => item.id === data.id)
          if (currentTracingIndex > -1) {
            responseItem.workflowProcess!.tracing[currentTracingIndex] = {
              ...responseItem.workflowProcess!.tracing[currentTracingIndex],
              ...data,
            }
            updateCurrentQAOnTree({
              placeholderQuestionId,
              questionItem,
              responseItem,
              parentId: params.parent_message_id,
            })
          }
        },
        onAgentLog: ({ data }) => {
          const currentNodeIndex = responseItem.workflowProcess!.tracing!.findIndex(item => item.node_id === data.node_id)
          if (currentNodeIndex > -1) {
            const current = responseItem.workflowProcess!.tracing![currentNodeIndex]

            if (current.execution_metadata) {
              if (current.execution_metadata.agent_log) {
                const currentLogIndex = current.execution_metadata.agent_log.findIndex(log => log.message_id === data.message_id)
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

            responseItem.workflowProcess!.tracing[currentNodeIndex] = {
              ...current,
            }

            updateCurrentQAOnTree({
              placeholderQuestionId,
              questionItem,
              responseItem,
              parentId: params.parent_message_id,
            })
          }
        },
        onHumanInputRequired: ({ data }) => {
          if (!responseItem.humanInputFormDataList) {
            responseItem.humanInputFormDataList = [data]
          }
          else {
            const currentFormIndex = responseItem.humanInputFormDataList.findIndex(item => item.node_id === data.node_id)
            if (currentFormIndex > -1) {
              responseItem.humanInputFormDataList[currentFormIndex] = data
            }
            else {
              responseItem.humanInputFormDataList.push(data)
            }
          }
          const currentTracingIndex = responseItem.workflowProcess!.tracing!.findIndex(item => item.node_id === data.node_id)
          if (currentTracingIndex > -1) {
            responseItem.workflowProcess!.tracing[currentTracingIndex].status = NodeRunningStatus.Paused
            updateCurrentQAOnTree({
              placeholderQuestionId,
              questionItem,
              responseItem,
              parentId: params.parent_message_id,
            })
          }
        },
        onHumanInputFormFilled: ({ data }) => {
          if (responseItem.humanInputFormDataList?.length) {
            const currentFormIndex = responseItem.humanInputFormDataList.findIndex(item => item.node_id === data.node_id)
            responseItem.humanInputFormDataList.splice(currentFormIndex, 1)
          }
          if (!responseItem.humanInputFilledFormDataList) {
            responseItem.humanInputFilledFormDataList = [data]
          }
          else {
            responseItem.humanInputFilledFormDataList.push(data)
          }
          updateCurrentQAOnTree({
            placeholderQuestionId,
            questionItem,
            responseItem,
            parentId: params.parent_message_id,
          })
        },
        onHumanInputFormTimeout: ({ data }) => {
          if (responseItem.humanInputFormDataList?.length) {
            const currentFormIndex = responseItem.humanInputFormDataList.findIndex(item => item.node_id === data.node_id)
            responseItem.humanInputFormDataList[currentFormIndex].expiration_time = data.expiration_time
          }
          updateCurrentQAOnTree({
            placeholderQuestionId,
            questionItem,
            responseItem,
            parentId: params.parent_message_id,
          })
        },
        onWorkflowPaused: ({ data: _data }) => {
          responseItem.workflowProcess!.status = WorkflowRunningStatus.Paused
          updateCurrentQAOnTree({
            placeholderQuestionId,
            questionItem,
            responseItem,
            parentId: params.parent_message_id,
          })
        },
      },
    )
  }, [threadMessages, chatTree.length, updateCurrentQAOnTree, handleResponding, formSettings?.inputsForm, handleRun, notify, t, workflowStore, fetchInspectVars, invalidAllLastRun, config?.suggested_questions_after_answer?.enabled])

  const handleSubmitHumanInputForm = async (formToken: string, formData: any) => {
    await submitHumanInputForm(formToken, formData)
  }

  const getHumanInputNodeData = (nodeID: string) => {
    const {
      getNodes,
    } = store.getState()
    const nodes = getNodes().filter(node => node.type === CUSTOM_NODE)
    const node = nodes.find(n => n.id === nodeID)
    return node
  }

  const handleResume = useCallback((
    messageId: string,
    workflowRunId: string,
    {
      onGetSuggestedQuestions,
    }: SendCallback,
  ) => {
    // Re-subscribe to workflow events for the specific message
    const url = `/workflow/${workflowRunId}/events?include_state_snapshot=true`

    const otherOptions: IOtherOptions = {
      getAbortController: (abortController) => {
        workflowEventsAbortControllerRef.current = abortController
      },
      onData: (message: string, _isFirstMessage: boolean, { conversationId: newConversationId, messageId: msgId, taskId }: any) => {
        updateChatTreeNode(messageId, (responseItem) => {
          responseItem.content = responseItem.content + message
          if (msgId)
            responseItem.id = msgId
        })

        if (newConversationId)
          conversationId.current = newConversationId

        if (taskId)
          taskIdRef.current = taskId
      },
      async onCompleted(hasError?: boolean) {
        const { workflowRunningData } = workflowStore.getState()
        handleResponding(false)

        if (workflowRunningData?.result.status !== WorkflowRunningStatus.Paused) {
          fetchInspectVars({})
          invalidAllLastRun()

          if (hasError)
            return

          if (config?.suggested_questions_after_answer?.enabled && !hasStopResponded.current && onGetSuggestedQuestions) {
            try {
              const { data }: any = await onGetSuggestedQuestions(
                messageId,
                newAbortController => suggestedQuestionsAbortControllerRef.current = newAbortController,
              )
              setSuggestQuestions(data)
            }
            catch {
              setSuggestQuestions([])
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
      },
      onWorkflowStarted: ({ workflow_run_id, task_id }) => {
        handleResponding(true)
        hasStopResponded.current = false
        updateChatTreeNode(messageId, (responseItem) => {
          if (responseItem.workflowProcess && responseItem.workflowProcess.tracing.length > 0) {
            responseItem.workflowProcess.status = WorkflowRunningStatus.Running
          }
          else {
            taskIdRef.current = task_id
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
          })
        })
      },
      onIterationFinish: ({ data: iterationFinishedData }) => {
        updateChatTreeNode(messageId, (responseItem) => {
          if (!responseItem.workflowProcess?.tracing)
            return
          const tracing = responseItem.workflowProcess.tracing
          const iterationIndex = tracing.findIndex(item => item.node_id === iterationFinishedData.node_id
            && (item.execution_metadata?.parallel_id === iterationFinishedData.execution_metadata?.parallel_id || item.parallel_id === iterationFinishedData.execution_metadata?.parallel_id))!
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
            }
          }
          else {
            if (nodeStartedData.iteration_id)
              return

            responseItem.workflowProcess.tracing.push({
              ...nodeStartedData,
              status: WorkflowRunningStatus.Running,
            })
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

            return item.id === nodeFinishedData.id && (item.execution_metadata?.parallel_id === nodeFinishedData.execution_metadata?.parallel_id)
          })
          if (currentIndex > -1)
            responseItem.workflowProcess.tracing[currentIndex] = nodeFinishedData as any
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
          })
        })
      },
      onLoopFinish: ({ data: loopFinishedData }) => {
        updateChatTreeNode(messageId, (responseItem) => {
          if (!responseItem.workflowProcess?.tracing)
            return
          const tracing = responseItem.workflowProcess.tracing
          const loopIndex = tracing.findIndex(item => item.node_id === loopFinishedData.node_id
            && (item.execution_metadata?.parallel_id === loopFinishedData.execution_metadata?.parallel_id || item.parallel_id === loopFinishedData.execution_metadata?.parallel_id))!
          if (loopIndex > -1) {
            tracing[loopIndex] = {
              ...tracing[loopIndex],
              ...loopFinishedData,
              status: WorkflowRunningStatus.Succeeded,
            }
          }
        })
      },
      onHumanInputRequired: ({ data: humanInputRequiredData }) => {
        updateChatTreeNode(messageId, (responseItem) => {
          if (!responseItem.humanInputFormDataList) {
            responseItem.humanInputFormDataList = [humanInputRequiredData]
          }
          else {
            const currentFormIndex = responseItem.humanInputFormDataList.findIndex(item => item.node_id === humanInputRequiredData.node_id)
            if (currentFormIndex > -1) {
              responseItem.humanInputFormDataList[currentFormIndex] = humanInputRequiredData
            }
            else {
              responseItem.humanInputFormDataList.push(humanInputRequiredData)
            }
          }
          if (responseItem.workflowProcess?.tracing) {
            const currentTracingIndex = responseItem.workflowProcess.tracing.findIndex(item => item.node_id === humanInputRequiredData.node_id)
            if (currentTracingIndex > -1)
              responseItem.workflowProcess.tracing[currentTracingIndex].status = NodeRunningStatus.Paused
          }
        })
      },
      onHumanInputFormFilled: ({ data: humanInputFilledFormData }) => {
        updateChatTreeNode(messageId, (responseItem) => {
          if (responseItem.humanInputFormDataList?.length) {
            const currentFormIndex = responseItem.humanInputFormDataList.findIndex(item => item.node_id === humanInputFilledFormData.node_id)
            if (currentFormIndex > -1)
              responseItem.humanInputFormDataList.splice(currentFormIndex, 1)
          }
          if (!responseItem.humanInputFilledFormDataList) {
            responseItem.humanInputFilledFormDataList = [humanInputFilledFormData]
          }
          else {
            responseItem.humanInputFilledFormDataList.push(humanInputFilledFormData)
          }
        })
      },
      onHumanInputFormTimeout: ({ data: humanInputFormTimeoutData }) => {
        updateChatTreeNode(messageId, (responseItem) => {
          if (responseItem.humanInputFormDataList?.length) {
            const currentFormIndex = responseItem.humanInputFormDataList.findIndex(item => item.node_id === humanInputFormTimeoutData.node_id)
            responseItem.humanInputFormDataList[currentFormIndex].expiration_time = humanInputFormTimeoutData.expiration_time
          }
        })
      },
      onWorkflowPaused: ({ data: workflowPausedData }) => {
        const resumeUrl = `/workflow/${workflowPausedData.workflow_run_id}/events`
        sseGet(
          resumeUrl,
          {},
          otherOptions,
        )
        updateChatTreeNode(messageId, (responseItem) => {
          responseItem.workflowProcess!.status = WorkflowRunningStatus.Paused
        })
      },
    }

    if (workflowEventsAbortControllerRef.current)
      workflowEventsAbortControllerRef.current.abort()

    sseGet(
      url,
      {},
      otherOptions,
    )
  }, [updateChatTreeNode, handleResponding, workflowStore, fetchInspectVars, invalidAllLastRun, config?.suggested_questions_after_answer])

  const handleSwitchSibling = useCallback((
    siblingMessageId: string,
    callbacks: SendCallback,
  ) => {
    setTargetMessageId(siblingMessageId)

    // Helper to find message in tree
    const findMessageInTree = (nodes: ChatItemInTree[], targetId: string): ChatItemInTree | undefined => {
      for (const node of nodes) {
        if (node.id === targetId)
          return node
        if (node.children) {
          const found = findMessageInTree(node.children, targetId)
          if (found)
            return found
        }
      }
      return undefined
    }

    const targetMessage = findMessageInTree(chatTreeRef.current, siblingMessageId)
    if (targetMessage?.workflow_run_id && targetMessage.humanInputFormDataList && targetMessage.humanInputFormDataList.length > 0) {
      handleResume(
        targetMessage.id,
        targetMessage.workflow_run_id,
        callbacks,
      )
    }
  }, [handleResume])

  return {
    conversationId: conversationId.current,
    chatList,
    setTargetMessageId,
    handleSwitchSibling,
    handleSend,
    handleStop,
    handleRestart,
    handleResume,
    handleSubmitHumanInputForm,
    getHumanInputNodeData,
    isResponding,
    suggestedQuestions,
  }
}
