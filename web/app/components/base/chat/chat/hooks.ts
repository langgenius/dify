import type {
  ChatConfig,
  ChatItem,
  ChatItemInTree,
  Inputs,
} from '../types'
import type { InputForm } from './type'
import type AudioPlayer from '@/app/components/base/audio-btn/audio'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { Annotation } from '@/models/log'
import type {
  IOnDataMoreInfo,
  IOtherOptions,
} from '@/service/base'
import { uniqBy } from 'es-toolkit/compat'
import { noop } from 'es-toolkit/function'
import { produce, setAutoFreeze } from 'immer'
import { useParams, usePathname } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidV4 } from 'uuid'
import { AudioPlayerManager } from '@/app/components/base/audio-btn/audio.player.manager'
import {
  getProcessedFiles,
  getProcessedFilesFromResponse,
} from '@/app/components/base/file-uploader/utils'
import { useToastContext } from '@/app/components/base/toast'
import { NodeRunningStatus, WorkflowRunningStatus } from '@/app/components/workflow/types'
import useTimestamp from '@/hooks/use-timestamp'
import {
  sseGet,
  ssePost,
} from '@/service/base'
import { TransferMethod } from '@/types/app'
import { getThreadMessages } from '../utils'
import {
  getProcessedInputs,
  processOpeningStatement,
} from './utils'

type GetAbortController = (abortController: AbortController) => void
type SendCallback = {
  onGetConversationMessages?: (conversationId: string, getAbortController: GetAbortController) => Promise<any>
  onGetSuggestedQuestions?: (responseItemId: string, getAbortController: GetAbortController) => Promise<any>
  onConversationComplete?: (conversationId: string) => void
  isPublicAPI?: boolean
}

export const useChat = (
  config?: ChatConfig,
  formSettings?: {
    inputs: Inputs
    inputsForm: InputForm[]
  },
  prevChatTree?: ChatItemInTree[],
  stopChat?: (taskId: string) => void,
  clearChatList?: boolean,
  clearChatListCallback?: (state: boolean) => void,
) => {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()
  const { notify } = useToastContext()
  const conversationId = useRef('')
  const hasStopResponded = useRef(false)
  const [isResponding, setIsResponding] = useState(false)
  const isRespondingRef = useRef(false)
  const taskIdRef = useRef('')
  const pausedStateRef = useRef(false)
  const [suggestedQuestions, setSuggestQuestions] = useState<string[]>([])
  const conversationMessagesAbortControllerRef = useRef<AbortController | null>(null)
  const suggestedQuestionsAbortControllerRef = useRef<AbortController | null>(null)
  const workflowEventsAbortControllerRef = useRef<AbortController | null>(null)
  const params = useParams()
  const pathname = usePathname()

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
          suggestedQuestions: config.suggested_questions?.map(item => getIntroduction(item)),
        }
      }
      else {
        ret.unshift({
          id: 'opening-statement',
          content: getIntroduction(config.opening_statement),
          isAnswer: true,
          isOpeningStatement: true,
          suggestedQuestions: config.suggested_questions?.map(item => getIntroduction(item)),
        })
      }
    }
    return ret
  }, [threadMessages, config, getIntroduction])

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

  const handleResponding = useCallback((isResponding: boolean) => {
    setIsResponding(isResponding)
    isRespondingRef.current = isResponding
  }, [])

  const handleStop = useCallback(() => {
    hasStopResponded.current = true
    handleResponding(false)
    if (stopChat && taskIdRef.current && !pausedStateRef.current)
      stopChat(taskIdRef.current)
    if (conversationMessagesAbortControllerRef.current)
      conversationMessagesAbortControllerRef.current.abort()
    if (suggestedQuestionsAbortControllerRef.current)
      suggestedQuestionsAbortControllerRef.current.abort()
    if (workflowEventsAbortControllerRef.current)
      workflowEventsAbortControllerRef.current.abort()
  }, [stopChat, handleResponding])

  const handleRestart = useCallback((cb?: any) => {
    conversationId.current = ''
    taskIdRef.current = ''
    handleStop()
    setChatTree([])
    setSuggestQuestions([])
    cb?.()
  }, [handleStop])

  const createAudioPlayerManager = useCallback(() => {
    let ttsUrl = ''
    let ttsIsPublic = false
    if (params.token) {
      ttsUrl = '/text-to-audio'
      ttsIsPublic = true
    }
    else if (params.appId) {
      if (pathname.search('explore/installed') > -1)
        ttsUrl = `/installed-apps/${params.appId}/text-to-audio`
      else
        ttsUrl = `/apps/${params.appId}/text-to-audio`
    }

    let player: AudioPlayer | null = null
    const getOrCreatePlayer = () => {
      if (!player)
        player = AudioPlayerManager.getInstance().getAudioPlayer(ttsUrl, ttsIsPublic, uuidV4(), 'none', 'none', noop)

      return player
    }

    return getOrCreatePlayer
  }, [params.token, params.appId, pathname])

  const handleResume = useCallback(async (
    messageId: string,
    workflowRunId: string,
    {
      onGetSuggestedQuestions,
      onConversationComplete,
      isPublicAPI,
    }: SendCallback,
  ) => {
    const getOrCreatePlayer = createAudioPlayerManager()
    // Re-subscribe to workflow events for the specific message
    const url = `/workflow/${workflowRunId}/events?include_state_snapshot=true`

    const otherOptions: IOtherOptions = {
      isPublicAPI,
      getAbortController: (abortController) => {
        workflowEventsAbortControllerRef.current = abortController
      },
      onData: (message: string, isFirstMessage: boolean, { conversationId: newConversationId, messageId, taskId }: IOnDataMoreInfo) => {
        updateChatTreeNode(messageId, (responseItem) => {
          const isAgentMode = responseItem.agent_thoughts && responseItem.agent_thoughts.length > 0
          if (!isAgentMode) {
            responseItem.content = responseItem.content + message
          }
          else {
            const lastThought = responseItem.agent_thoughts?.[responseItem.agent_thoughts?.length - 1]
            if (lastThought)
              lastThought.thought = lastThought.thought + message
          }
          if (messageId)
            responseItem.id = messageId
        })

        if (isFirstMessage && newConversationId)
          conversationId.current = newConversationId

        if (taskId)
          taskIdRef.current = taskId
      },
      async onCompleted(hasError?: boolean) {
        handleResponding(false)

        if (hasError)
          return

        if (onConversationComplete)
          onConversationComplete(conversationId.current)

        if (config?.suggested_questions_after_answer?.enabled && !hasStopResponded.current && onGetSuggestedQuestions) {
          try {
            const { data }: any = await onGetSuggestedQuestions(
              messageId,
              newAbortController => suggestedQuestionsAbortControllerRef.current = newAbortController,
            )
            setSuggestQuestions(data)
          }
          // eslint-disable-next-line unused-imports/no-unused-vars
          catch (e) {
            setSuggestQuestions([])
          }
        }
      },
      onFile(file) {
        // Convert simple file type to MIME type for non-agent mode
        // Backend sends: { id, type: "image", belongs_to, url }
        // Frontend expects: { id, type: "image/png", transferMethod, url, uploadedId, supportFileType, name, size }

        // Determine file type for MIME conversion
        const fileType = (file as { type?: string }).type || 'image'

        // If file already has transferMethod, use it as base and ensure all required fields exist
        // Otherwise, create a new complete file object
        const baseFile = ('transferMethod' in file) ? (file as Partial<FileEntity>) : null

        const convertedFile: FileEntity = {
          id: baseFile?.id || (file as { id: string }).id,
          type: baseFile?.type || (fileType === 'image' ? 'image/png' : fileType === 'video' ? 'video/mp4' : fileType === 'audio' ? 'audio/mpeg' : 'application/octet-stream'),
          transferMethod: (baseFile?.transferMethod as FileEntity['transferMethod']) || (fileType === 'image' ? 'remote_url' : 'local_file'),
          uploadedId: baseFile?.uploadedId || (file as { id: string }).id,
          supportFileType: baseFile?.supportFileType || (fileType === 'image' ? 'image' : fileType === 'video' ? 'video' : fileType === 'audio' ? 'audio' : 'document'),
          progress: baseFile?.progress ?? 100,
          name: baseFile?.name || `generated_${fileType}.${fileType === 'image' ? 'png' : fileType === 'video' ? 'mp4' : fileType === 'audio' ? 'mp3' : 'bin'}`,
          url: baseFile?.url || (file as { url?: string }).url,
          size: baseFile?.size ?? 0, // Generated files don't have a known size
        }
        updateChatTreeNode(messageId, (responseItem) => {
          const lastThought = responseItem.agent_thoughts?.[responseItem.agent_thoughts?.length - 1]
          if (lastThought) {
            responseItem.agent_thoughts![responseItem.agent_thoughts!.length - 1].message_files = [...(lastThought as any).message_files, convertedFile]
          }
          else {
            const currentFiles = (responseItem.message_files as FileEntity[] | undefined) ?? []
            responseItem.message_files = [...currentFiles, convertedFile]
          }
        })
      },
      onThought(thought) {
        updateChatTreeNode(messageId, (responseItem) => {
          if (thought.message_id)
            responseItem.id = thought.message_id
          if (thought.conversation_id)
            responseItem.conversationId = thought.conversation_id

          if (!responseItem.agent_thoughts)
            responseItem.agent_thoughts = []

          if (responseItem.agent_thoughts.length === 0) {
            responseItem.agent_thoughts.push(thought)
          }
          else {
            const lastThought = responseItem.agent_thoughts[responseItem.agent_thoughts.length - 1]
            if (lastThought.id === thought.id) {
              thought.thought = lastThought.thought
              thought.message_files = lastThought.message_files
              responseItem.agent_thoughts[responseItem.agent_thoughts.length - 1] = thought
            }
            else {
              responseItem.agent_thoughts.push(thought)
            }
          }
        })
      },
      onMessageEnd: (messageEnd) => {
        updateChatTreeNode(messageId, (responseItem) => {
          if (messageEnd.metadata?.annotation_reply) {
            responseItem.annotation = ({
              id: messageEnd.metadata.annotation_reply.id,
              authorName: messageEnd.metadata.annotation_reply.account.name,
            })
            return
          }
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
          // if the node is already started, update the node
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
      onTTSChunk: (messageId: string, audio: string) => {
        if (!audio || audio === '')
          return
        const audioPlayer = getOrCreatePlayer()
        if (audioPlayer) {
          audioPlayer.playAudioWithAudio(audio, true)
          AudioPlayerManager.getInstance().resetMsgId(messageId)
        }
      },
      onTTSEnd: (messageId: string, audio: string) => {
        const audioPlayer = getOrCreatePlayer()
        if (audioPlayer)
          audioPlayer.playAudioWithAudio(audio, false)
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
        pausedStateRef.current = true
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
  }, [updateChatTreeNode, handleResponding, createAudioPlayerManager, config?.suggested_questions_after_answer])

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

  const handleSend = useCallback(async (
    url: string,
    data: {
      query: string
      files?: FileEntity[]
      parent_message_id?: string
      [key: string]: any
    },
    {
      onGetConversationMessages,
      onGetSuggestedQuestions,
      onConversationComplete,
      isPublicAPI,
    }: SendCallback,
  ) => {
    setSuggestQuestions([])

    if (isRespondingRef.current) {
      notify({ type: 'info', message: t('errorMessage.waitForResponse', { ns: 'appDebug' }) })
      return false
    }

    const parentMessage = threadMessages.find(item => item.id === data.parent_message_id)

    const placeholderQuestionId = `question-${Date.now()}`
    const questionItem = {
      id: placeholderQuestionId,
      content: data.query,
      isAnswer: false,
      message_files: data.files,
      parentMessageId: data.parent_message_id,
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
      parentId: data.parent_message_id,
      responseItem: placeholderAnswerItem,
      placeholderQuestionId,
      questionItem,
    })

    // answer
    const responseItem: ChatItemInTree = {
      id: placeholderAnswerId,
      content: '',
      agent_thoughts: [],
      message_files: [],
      isAnswer: true,
      parentMessageId: questionItem.id,
      siblingIndex: parentMessage?.children?.length ?? chatTree.length,
    }

    handleResponding(true)
    hasStopResponded.current = false

    const { query, files, inputs, ...restData } = data
    const bodyParams = {
      response_mode: 'streaming',
      conversation_id: conversationId.current,
      files: getProcessedFiles(files || []),
      query,
      inputs: getProcessedInputs(inputs || {}, formSettings?.inputsForm || []),
      ...restData,
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

    let isAgentMode = false
    let hasSetResponseId = false

    const getOrCreatePlayer = createAudioPlayerManager()

    const otherOptions: IOtherOptions = {
      isPublicAPI,
      getAbortController: (abortController) => {
        workflowEventsAbortControllerRef.current = abortController
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
          parentId: data.parent_message_id,
        })
      },
      async onCompleted(hasError?: boolean) {
        handleResponding(false)

        if (hasError)
          return

        if (onConversationComplete)
          onConversationComplete(conversationId.current)

        if (conversationId.current && !hasStopResponded.current && onGetConversationMessages) {
          const { data }: any = await onGetConversationMessages(
            conversationId.current,
            newAbortController => conversationMessagesAbortControllerRef.current = newAbortController,
          )
          const newResponseItem = data.find((item: any) => item.id === responseItem.id)
          if (!newResponseItem)
            return

          const isUseAgentThought = newResponseItem.agent_thoughts?.length > 0 && newResponseItem.agent_thoughts[newResponseItem.agent_thoughts?.length - 1].thought === newResponseItem.answer
          updateChatTreeNode(responseItem.id, {
            content: isUseAgentThought ? '' : newResponseItem.answer,
            log: [
              ...newResponseItem.message,
              ...(newResponseItem.message[newResponseItem.message.length - 1].role !== 'assistant'
                ? [
                    {
                      role: 'assistant',
                      text: newResponseItem.answer,
                      files: newResponseItem.message_files?.filter((file: any) => file.belongs_to === 'assistant') || [],
                    },
                  ]
                : []),
            ],
            more: {
              time: formatTime(newResponseItem.created_at, 'hh:mm A'),
              tokens: newResponseItem.answer_tokens + newResponseItem.message_tokens,
              latency: newResponseItem.provider_response_latency.toFixed(2),
              tokens_per_second: newResponseItem.provider_response_latency > 0 ? (newResponseItem.answer_tokens / newResponseItem.provider_response_latency).toFixed(2) : undefined,
            },
            // for agent log
            conversationId: conversationId.current,
            input: {
              inputs: newResponseItem.inputs,
              query: newResponseItem.query,
            },
          })
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
          catch (e) {
            setSuggestQuestions([])
          }
        }
      },
      onFile(file) {
        // Convert simple file type to MIME type for non-agent mode
        // Backend sends: { id, type: "image", belongs_to, url }
        // Frontend expects: { id, type: "image/png", transferMethod, url, uploadedId, supportFileType, name, size }

        // Determine file type for MIME conversion
        const fileType = (file as { type?: string }).type || 'image'

        // If file already has transferMethod, use it as base and ensure all required fields exist
        // Otherwise, create a new complete file object
        const baseFile = ('transferMethod' in file) ? (file as Partial<FileEntity>) : null

        const convertedFile: FileEntity = {
          id: baseFile?.id || (file as { id: string }).id,
          type: baseFile?.type || (fileType === 'image' ? 'image/png' : fileType === 'video' ? 'video/mp4' : fileType === 'audio' ? 'audio/mpeg' : 'application/octet-stream'),
          transferMethod: (baseFile?.transferMethod as FileEntity['transferMethod']) || (fileType === 'image' ? 'remote_url' : 'local_file'),
          uploadedId: baseFile?.uploadedId || (file as { id: string }).id,
          supportFileType: baseFile?.supportFileType || (fileType === 'image' ? 'image' : fileType === 'video' ? 'video' : fileType === 'audio' ? 'audio' : 'document'),
          progress: baseFile?.progress ?? 100,
          name: baseFile?.name || `generated_${fileType}.${fileType === 'image' ? 'png' : fileType === 'video' ? 'mp4' : fileType === 'audio' ? 'mp3' : 'bin'}`,
          url: baseFile?.url || (file as { url?: string }).url,
          size: baseFile?.size ?? 0, // Generated files don't have a known size
        }

        // For agent mode, add files to the last thought
        const lastThought = responseItem.agent_thoughts?.[responseItem.agent_thoughts?.length - 1]
        if (lastThought) {
          const thought = lastThought as { message_files?: FileEntity[] }
          responseItem.agent_thoughts![responseItem.agent_thoughts!.length - 1].message_files = [...(thought.message_files ?? []), convertedFile]
        }
        // For non-agent mode, add files directly to responseItem.message_files
        else {
          const currentFiles = (responseItem.message_files as FileEntity[] | undefined) ?? []
          responseItem.message_files = [...currentFiles, convertedFile]
        }

        updateCurrentQAOnTree({
          placeholderQuestionId,
          questionItem,
          responseItem,
          parentId: data.parent_message_id,
        })
      },
      onThought(thought) {
        isAgentMode = true
        const response = responseItem as any
        if (thought.message_id && !hasSetResponseId)
          response.id = thought.message_id
        if (thought.conversation_id)
          response.conversationId = thought.conversation_id

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
        updateCurrentQAOnTree({
          placeholderQuestionId,
          questionItem,
          responseItem,
          parentId: data.parent_message_id,
        })
      },
      onMessageEnd: (messageEnd) => {
        if (messageEnd.metadata?.annotation_reply) {
          responseItem.id = messageEnd.id
          responseItem.annotation = ({
            id: messageEnd.metadata.annotation_reply.id,
            authorName: messageEnd.metadata.annotation_reply.account.name,
          })
          updateCurrentQAOnTree({
            placeholderQuestionId,
            questionItem,
            responseItem,
            parentId: data.parent_message_id,
          })
          return
        }
        responseItem.citation = messageEnd.metadata?.retriever_resources || []
        const processedFilesFromResponse = getProcessedFilesFromResponse(messageEnd.files || [])
        responseItem.allFiles = uniqBy([...(responseItem.allFiles || []), ...(processedFilesFromResponse || [])], 'id')

        updateCurrentQAOnTree({
          placeholderQuestionId,
          questionItem,
          responseItem,
          parentId: data.parent_message_id,
        })
      },
      onMessageReplace: (messageReplace) => {
        responseItem.content = messageReplace.answer
      },
      onError() {
        handleResponding(false)
        updateCurrentQAOnTree({
          placeholderQuestionId,
          questionItem,
          responseItem,
          parentId: data.parent_message_id,
        })
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
          parentId: data.parent_message_id,
        })
      },
      onWorkflowFinished: ({ data: workflowFinishedData }) => {
        if (pausedStateRef.current)
          pausedStateRef.current = false
        responseItem.workflowProcess!.status = workflowFinishedData.status as WorkflowRunningStatus
        updateCurrentQAOnTree({
          placeholderQuestionId,
          questionItem,
          responseItem,
          parentId: data.parent_message_id,
        })
      },
      onIterationStart: ({ data: iterationStartedData }) => {
        responseItem.workflowProcess!.tracing!.push({
          ...iterationStartedData,
          status: WorkflowRunningStatus.Running,
        })
        updateCurrentQAOnTree({
          placeholderQuestionId,
          questionItem,
          responseItem,
          parentId: data.parent_message_id,
        })
      },
      onIterationFinish: ({ data: iterationFinishedData }) => {
        const tracing = responseItem.workflowProcess!.tracing!
        const iterationIndex = tracing.findIndex(item => item.node_id === iterationFinishedData.node_id
          && (item.execution_metadata?.parallel_id === iterationFinishedData.execution_metadata?.parallel_id || item.parallel_id === iterationFinishedData.execution_metadata?.parallel_id))!
        tracing[iterationIndex] = {
          ...tracing[iterationIndex],
          ...iterationFinishedData,
          status: WorkflowRunningStatus.Succeeded,
        }

        updateCurrentQAOnTree({
          placeholderQuestionId,
          questionItem,
          responseItem,
          parentId: data.parent_message_id,
        })
      },
      onNodeStarted: ({ data: nodeStartedData }) => {
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

          if (data.loop_id)
            return

          responseItem.workflowProcess.tracing.push({
            ...nodeStartedData,
            status: WorkflowRunningStatus.Running,
          })
        }
        updateCurrentQAOnTree({
          placeholderQuestionId,
          questionItem,
          responseItem,
          parentId: data.parent_message_id,
        })
      },
      onNodeFinished: ({ data: nodeFinishedData }) => {
        if (nodeFinishedData.iteration_id)
          return

        if (data.loop_id)
          return

        const currentIndex = responseItem.workflowProcess!.tracing!.findIndex((item) => {
          if (!item.execution_metadata?.parallel_id)
            return item.id === nodeFinishedData.id

          return item.id === nodeFinishedData.id && (item.execution_metadata?.parallel_id === nodeFinishedData.execution_metadata?.parallel_id)
        })
        responseItem.workflowProcess!.tracing[currentIndex] = nodeFinishedData as any

        updateCurrentQAOnTree({
          placeholderQuestionId,
          questionItem,
          responseItem,
          parentId: data.parent_message_id,
        })
      },
      onTTSChunk: (messageId: string, audio: string) => {
        if (!audio || audio === '')
          return
        const audioPlayer = getOrCreatePlayer()
        if (audioPlayer) {
          audioPlayer.playAudioWithAudio(audio, true)
          AudioPlayerManager.getInstance().resetMsgId(messageId)
        }
      },
      onTTSEnd: (messageId: string, audio: string) => {
        const audioPlayer = getOrCreatePlayer()
        if (audioPlayer)
          audioPlayer.playAudioWithAudio(audio, false)
      },
      onLoopStart: ({ data: loopStartedData }) => {
        responseItem.workflowProcess!.tracing!.push({
          ...loopStartedData,
          status: WorkflowRunningStatus.Running,
        })
        updateCurrentQAOnTree({
          placeholderQuestionId,
          questionItem,
          responseItem,
          parentId: data.parent_message_id,
        })
      },
      onLoopFinish: ({ data: loopFinishedData }) => {
        const tracing = responseItem.workflowProcess!.tracing!
        const loopIndex = tracing.findIndex(item => item.node_id === loopFinishedData.node_id
          && (item.execution_metadata?.parallel_id === loopFinishedData.execution_metadata?.parallel_id || item.parallel_id === loopFinishedData.execution_metadata?.parallel_id))!
        tracing[loopIndex] = {
          ...tracing[loopIndex],
          ...loopFinishedData,
          status: WorkflowRunningStatus.Succeeded,
        }

        updateCurrentQAOnTree({
          placeholderQuestionId,
          questionItem,
          responseItem,
          parentId: data.parent_message_id,
        })
      },
      onHumanInputRequired: ({ data: humanInputRequiredData }) => {
        if (!responseItem.humanInputFormDataList) {
          responseItem.humanInputFormDataList = [humanInputRequiredData]
        }
        else {
          const currentFormIndex = responseItem.humanInputFormDataList!.findIndex(item => item.node_id === humanInputRequiredData.node_id)
          if (currentFormIndex > -1) {
            responseItem.humanInputFormDataList[currentFormIndex] = humanInputRequiredData
          }
          else {
            responseItem.humanInputFormDataList.push(humanInputRequiredData)
          }
        }
        const currentTracingIndex = responseItem.workflowProcess!.tracing!.findIndex(item => item.node_id === humanInputRequiredData.node_id)
        if (currentTracingIndex > -1) {
          responseItem.workflowProcess!.tracing[currentTracingIndex].status = NodeRunningStatus.Paused
          updateCurrentQAOnTree({
            placeholderQuestionId,
            questionItem,
            responseItem,
            parentId: data.parent_message_id,
          })
        }
      },
      onHumanInputFormFilled: ({ data: humanInputFilledFormData }) => {
        if (responseItem.humanInputFormDataList?.length) {
          const currentFormIndex = responseItem.humanInputFormDataList!.findIndex(item => item.node_id === humanInputFilledFormData.node_id)
          responseItem.humanInputFormDataList.splice(currentFormIndex, 1)
        }
        if (!responseItem.humanInputFilledFormDataList) {
          responseItem.humanInputFilledFormDataList = [humanInputFilledFormData]
        }
        else {
          responseItem.humanInputFilledFormDataList.push(humanInputFilledFormData)
        }
        updateCurrentQAOnTree({
          placeholderQuestionId,
          questionItem,
          responseItem,
          parentId: data.parent_message_id,
        })
      },
      onHumanInputFormTimeout: ({ data: humanInputFormTimeoutData }) => {
        if (responseItem.humanInputFormDataList?.length) {
          const currentFormIndex = responseItem.humanInputFormDataList!.findIndex(item => item.node_id === humanInputFormTimeoutData.node_id)
          responseItem.humanInputFormDataList[currentFormIndex].expiration_time = humanInputFormTimeoutData.expiration_time
        }
        updateCurrentQAOnTree({
          placeholderQuestionId,
          questionItem,
          responseItem,
          parentId: data.parent_message_id,
        })
      },
      onWorkflowPaused: ({ data: workflowPausedData }) => {
        const url = `/workflow/${workflowPausedData.workflow_run_id}/events`
        pausedStateRef.current = true
        sseGet(
          url,
          {},
          otherOptions,
        )
        responseItem.workflowProcess!.status = WorkflowRunningStatus.Paused
        updateCurrentQAOnTree({
          placeholderQuestionId,
          questionItem,
          responseItem,
          parentId: data.parent_message_id,
        })
      },
    }

    // Abort the previous workflow events SSE request
    if (workflowEventsAbortControllerRef.current)
      workflowEventsAbortControllerRef.current.abort()

    ssePost(
      url,
      {
        body: bodyParams,
      },
      otherOptions,
    )
    return true
  }, [
    t,
    chatTree.length,
    threadMessages,
    config?.suggested_questions_after_answer,
    updateCurrentQAOnTree,
    updateChatTreeNode,
    notify,
    handleResponding,
    formatTime,
    createAudioPlayerManager,
    formSettings,
  ])

  const handleAnnotationEdited = useCallback((query: string, answer: string, index: number) => {
    const targetQuestionId = chatList[index - 1].id
    const targetAnswerId = chatList[index].id

    updateChatTreeNode(targetQuestionId, {
      content: query,
    })
    updateChatTreeNode(targetAnswerId, {
      content: answer,
      annotation: {
        ...chatList[index].annotation,
        logAnnotation: undefined,
      } as any,
    })
  }, [chatList, updateChatTreeNode])

  const handleAnnotationAdded = useCallback((annotationId: string, authorName: string, query: string, answer: string, index: number) => {
    const targetQuestionId = chatList[index - 1].id
    const targetAnswerId = chatList[index].id

    updateChatTreeNode(targetQuestionId, {
      content: query,
    })

    updateChatTreeNode(targetAnswerId, {
      content: chatList[index].content,
      annotation: {
        id: annotationId,
        authorName,
        logAnnotation: {
          content: answer,
          account: {
            id: '',
            name: authorName,
            email: '',
          },
        },
      } as Annotation,
    })
  }, [chatList, updateChatTreeNode])

  const handleAnnotationRemoved = useCallback((index: number) => {
    const targetAnswerId = chatList[index].id

    updateChatTreeNode(targetAnswerId, {
      content: chatList[index].content,
      annotation: {
        ...chatList[index].annotation,
        id: '',
      } as Annotation,
    })
  }, [chatList, updateChatTreeNode])

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
  }, [setTargetMessageId, handleResume])

  useEffect(() => {
    if (clearChatList)
      handleRestart(() => clearChatListCallback?.(false))
  }, [clearChatList, clearChatListCallback, handleRestart])

  return {
    chatList,
    setTargetMessageId,
    isResponding,
    setIsResponding,
    handleSend,
    handleResume,
    handleSwitchSibling,
    suggestedQuestions,
    handleRestart,
    handleStop,
    handleAnnotationEdited,
    handleAnnotationAdded,
    handleAnnotationRemoved,
  }
}
