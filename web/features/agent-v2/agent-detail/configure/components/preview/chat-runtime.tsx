'use client'

import type {
  AgentCliToolConfig,
  AgentIconType,
  AgentSoulConfig,
  AgentSoulDifyToolConfig,
  AgentThought,
  MessageDetailResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import type {
  ReactNode,
} from 'react'
import type { FeedbackType, IChatItem, InputForm, ThoughtItem } from '@/app/components/base/chat/chat/type'
import type { ChatConfig, ChatItem, ChatItemInTree, OnSend } from '@/app/components/base/chat/types'
import type { FileUpload } from '@/app/components/base/features/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { AgentComposerModel } from '@/features/agent-v2/agent-composer/form-state'
import type { Inputs } from '@/models/debug'
import type { MessageRating } from '@/models/log'
import type { FileResponse } from '@/types/workflow'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChatInputArea from '@/app/components/base/chat/chat/chat-input-area'
import { useChat } from '@/app/components/base/chat/chat/hooks'
import { buildChatItemTree, getLastAnswer, isValidGeneratedAnswer } from '@/app/components/base/chat/utils'
import { getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import Loading from '@/app/components/base/loading'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { addFileInfos, sortAgentSorts } from '@/app/components/tools/utils'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import { useAppContext } from '@/context/app-context'
import { agentComposerModelAtom } from '@/features/agent-v2/agent-composer/store-modules/model'
import { agentComposerPromptAtom } from '@/features/agent-v2/agent-composer/store-modules/prompt'
import { ENABLE_AGENT_CLI_TOOLS } from '@/features/agent-v2/agent-detail/configure/feature-flags'
import { PromptMode } from '@/models/debug'
import dynamic from '@/next/dynamic'
import { consoleClient, consoleQuery } from '@/service/client'
import { AgentStrategy, ModelModeType, RETRIEVE_TYPE, TransferMethod } from '@/types/app'

const Chat = dynamic(() => import('@/app/components/base/chat/chat'), { ssr: false })

type AgentPreviewChatConfig = ChatConfig & {
  model: {
    provider: string
    name: string
    mode: ModelModeType
    completion_params: {
      max_tokens: number
      temperature: number
      top_p: number
      echo: boolean
      stop: string[]
      presence_penalty: number
      frequency_penalty: number
    }
  }
}

const defaultSystemParameters: ChatConfig['system_parameters'] = {
  audio_file_size_limit: 0,
  file_size_limit: 0,
  image_file_size_limit: 0,
  video_file_size_limit: 0,
  workflow_file_upload_limit: 0,
}

const disabledFileUploadConfig = {
  enabled: false,
  allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
  allowed_file_types: [],
  fileUploadConfig: defaultSystemParameters,
  image: {
    enabled: false,
    transfer_methods: [],
    number_limits: 0,
    image_file_size_limit: 0,
    detail: 'low',
  },
  max_length: 0,
  number_limits: 0,
} as ChatConfig['file_upload'] & {
  fileUploadConfig: ChatConfig['system_parameters']
}

const defaultFileUploadMethods = [TransferMethod.local_file, TransferMethod.remote_url]

const toPreviewFileUploadConfig = (fileUpload: FileUpload | undefined) => {
  if (!fileUpload?.enabled)
    return disabledFileUploadConfig

  const allowedFileUploadMethods = fileUpload.allowed_file_upload_methods?.length
    ? fileUpload.allowed_file_upload_methods
    : defaultFileUploadMethods
  const numberLimits = fileUpload.number_limits ?? fileUpload.image?.number_limits ?? 3

  return {
    ...disabledFileUploadConfig,
    ...fileUpload,
    enabled: true,
    allowed_file_types: fileUpload.allowed_file_types?.length
      ? fileUpload.allowed_file_types
      : [SupportUploadFileTypes.image],
    allowed_file_upload_methods: allowedFileUploadMethods,
    number_limits: numberLimits,
    fileUploadConfig: fileUpload.fileUploadConfig ?? defaultSystemParameters,
    image: {
      ...disabledFileUploadConfig.image,
      ...fileUpload.image,
      enabled: fileUpload.image?.enabled ?? true,
      transfer_methods: fileUpload.image?.transfer_methods?.length
        ? fileUpload.image.transfer_methods
        : allowedFileUploadMethods,
      number_limits: numberLimits,
    },
  } as ChatConfig['file_upload']
}

const getModelSettings = (agentSoulConfig?: AgentSoulConfig) => agentSoulConfig?.model?.model_settings ?? {}

const toEnabledConfig = (config?: { enabled?: boolean } | null) => ({
  ...config,
  enabled: config?.enabled ?? false,
})

const toInputType = (type: string): InputVarType => {
  if (type === InputVarType.paragraph)
    return InputVarType.paragraph
  if (type === InputVarType.select)
    return InputVarType.select
  if (type === InputVarType.number)
    return InputVarType.number
  if (type === InputVarType.json || type === InputVarType.jsonObject)
    return InputVarType.json

  return InputVarType.textInput
}

const toInputForm = (variable: NonNullable<AgentSoulConfig['app_variables']>[number]) => {
  const variableKey = String(variable.name)

  return {
    ...variable,
    key: variableKey,
    label: variableKey,
    variable: variableKey,
    type: toInputType(variable.type),
    required: variable.required ?? true,
    hide: false,
  }
}

const getAgentSoulInputsForm = (agentSoulConfig?: AgentSoulConfig) => (agentSoulConfig?.app_variables ?? []).map(toInputForm)

const getAgentSoulInputs = (inputsForm: InputForm[]) => {
  return inputsForm.reduce<Inputs>((acc, input) => {
    acc[input.variable] = (input.default ?? '') as Inputs[string]
    return acc
  }, {})
}

const toAgentTool = (tool: AgentSoulDifyToolConfig) => ({
  provider_id: tool.provider_id ?? tool.provider ?? tool.plugin_id ?? '',
  provider_type: tool.provider_type ?? 'builtin',
  provider_name: tool.provider ?? '',
  tool_name: tool.tool_name,
  tool_label: tool.name ?? tool.tool_name,
  tool_parameters: tool.runtime_parameters ?? {},
  enabled: tool.enabled ?? true,
  credential_id: tool.credential_ref?.id,
})

const toCliTool = (tool: AgentCliToolConfig) => ({
  provider_id: 'agent-v2-cli',
  provider_type: 'builtin',
  provider_name: 'CLI',
  tool_name: tool.tool_name ?? tool.name ?? '',
  tool_label: tool.name ?? tool.tool_name ?? '',
  tool_parameters: {
    command: tool.command,
  },
  enabled: tool.enabled ?? true,
})

const toLegacyPreviewDatasetConfigs = (
  knowledge?: AgentSoulConfig['knowledge'],
): NonNullable<ChatConfig['dataset_configs']> => {
  // Temporary preview adapter: composer state is knowledge.sets, but this
  // legacy chat preview contract still accepts one flat dataset_configs block.
  // Preview currently flattens the first configured set only.
  const previewKnowledgeSet = knowledge?.sets?.[0]
  const datasets = previewKnowledgeSet?.datasets ?? []
  const retrieval = previewKnowledgeSet?.retrieval

  return {
    retrieval_model: retrieval?.mode === 'single' ? RETRIEVE_TYPE.oneWay : RETRIEVE_TYPE.multiWay,
    reranking_model: {
      reranking_provider_name: retrieval?.reranking_model?.provider ?? '',
      reranking_model_name: retrieval?.reranking_model?.model ?? '',
    },
    top_k: retrieval?.top_k ?? 4,
    score_threshold_enabled: retrieval?.score_threshold !== undefined && retrieval?.score_threshold !== null,
    score_threshold: retrieval?.score_threshold ?? 0.8,
    datasets: {
      datasets: datasets.map(dataset => ({
        enabled: true,
        id: dataset.id ?? '',
      })).filter(dataset => dataset.id),
    },
  }
}

const stopAgentChatMessageResponding = (agentId: string, taskId: string) => {
  return consoleClient.agent.byAgentId.chatMessages.byTaskId.stop.post({
    params: {
      agent_id: agentId,
      task_id: taskId,
    },
  })
}

const toFileResponse = (file: NonNullable<MessageDetailResponse['message_files']>[number]): FileResponse => ({
  related_id: file.id ?? file.upload_file_id,
  extension: '',
  filename: file.filename,
  size: file.size ?? 0,
  mime_type: file.mime_type ?? '',
  transfer_method: file.transfer_method as TransferMethod,
  type: file.type,
  url: file.url ?? '',
  upload_file_id: file.upload_file_id ?? '',
  remote_url: file.url ?? '',
})

const toLogMessages = (message: MessageDetailResponse['message'], answer: string, files: MessageDetailResponse['message_files']) => {
  if (!Array.isArray(message))
    return []

  const logMessages = message as IChatItem['log']
  if (logMessages?.at(-1)?.role === 'assistant')
    return logMessages

  return [
    ...(logMessages ?? []),
    {
      role: 'assistant',
      text: answer,
      files: getProcessedFilesFromResponse((files?.filter(file => file.belongs_to === 'assistant') || []).map(toFileResponse)),
    },
  ]
}

const toAgentThoughtItem = (thought: AgentThought, conversationId: string): ThoughtItem => ({
  id: thought.id,
  tool: thought.tool ?? '',
  thought: thought.thought ?? '',
  tool_input: thought.tool_input ?? '',
  message_id: thought.message_id,
  conversation_id: conversationId,
  observation: thought.observation ?? '',
  position: thought.position,
  files: thought.files,
})

const toFeedback = (feedback: NonNullable<MessageDetailResponse['feedbacks']>[number] | undefined): FeedbackType | undefined => {
  if (!feedback)
    return undefined

  const rating = feedback.rating as MessageRating
  if (rating !== 'like' && rating !== 'dislike' && rating !== null)
    return undefined

  return {
    rating,
    content: feedback.content,
  }
}

const getAgentDebugMessageAnswer = (message: MessageDetailResponse) => {
  return message.answer ?? ''
}

function getLastWorkflowRunId(messages: MessageDetailResponse[]) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const workflowRunId = messages[index]?.workflow_run_id
    if (workflowRunId)
      return workflowRunId
  }

  return null
}

function getFormattedAgentDebugChatTree(messages: MessageDetailResponse[]): ChatItemInTree[] {
  const chatList: IChatItem[] = []

  messages.forEach((item) => {
    const answer = getAgentDebugMessageAnswer(item)
    const questionFiles = item.message_files?.filter(file => file.belongs_to === 'user') || []
    const answerFiles = item.message_files?.filter(file => file.belongs_to === 'assistant') || []
    const answerTokens = item.answer_tokens ?? 0
    const messageTokens = item.message_tokens ?? 0
    const latency = item.provider_response_latency ?? 0

    chatList.push({
      id: `question-${item.id}`,
      content: item.query,
      isAnswer: false,
      message_files: getProcessedFilesFromResponse(questionFiles.map(toFileResponse)),
      parentMessageId: item.parent_message_id || undefined,
    })
    chatList.push({
      id: item.id,
      content: answer,
      agent_thoughts: addFileInfos(
        sortAgentSorts((item.agent_thoughts ?? []).map(thought => toAgentThoughtItem(thought, item.conversation_id))),
        item.message_files as unknown as FileEntity[],
      ),
      feedback: toFeedback(item.feedbacks?.find(feedback => feedback.from_source === 'user')),
      isAnswer: true,
      log: toLogMessages(item.message, answer, item.message_files),
      message_files: getProcessedFilesFromResponse(answerFiles.map(toFileResponse)),
      parentMessageId: `question-${item.id}`,
      workflow_run_id: item.workflow_run_id ?? undefined,
      conversationId: item.conversation_id,
      input: {
        inputs: item.inputs,
        query: item.query,
      },
      more: {
        time: '',
        tokens: answerTokens + messageTokens,
        latency: latency.toFixed(2),
        tokens_per_second: latency > 0 ? (answerTokens / latency).toFixed(2) : undefined,
      },
    })
  })

  return buildChatItemTree(chatList)
}

const fetchAgentSuggestedQuestions = (agentId: string, messageId: string) => {
  return consoleClient.agent.byAgentId.chatMessages.byMessageId.suggestedQuestions.get({
    params: {
      agent_id: agentId,
      message_id: messageId,
    },
  })
}

const buildChatConfig = ({
  agentSoulConfig,
  currentModel,
  prompt,
}: {
  agentSoulConfig?: AgentSoulConfig
  currentModel?: AgentComposerModel
  prompt: string
}): AgentPreviewChatConfig => {
  const modelSettings = currentModel?.model_settings ?? getModelSettings(agentSoulConfig)
  const appFeatures = agentSoulConfig?.app_features ?? {}
  const difyTools = agentSoulConfig?.tools?.dify_tools ?? []
  const cliTools = ENABLE_AGENT_CLI_TOOLS ? (agentSoulConfig?.tools?.cli_tools ?? []) : []

  return {
    pre_prompt: prompt || agentSoulConfig?.prompt?.system_prompt || '',
    prompt_type: PromptMode.simple,
    chat_prompt_config: DEFAULT_CHAT_PROMPT_CONFIG,
    completion_prompt_config: DEFAULT_COMPLETION_PROMPT_CONFIG,
    user_input_form: (agentSoulConfig?.app_variables ?? []).map(variable => ({
      'text-input': {
        default: String(variable.default ?? ''),
        label: variable.name,
        variable: variable.name,
        required: variable.required ?? true,
        max_length: 48,
        hide: false,
      },
    })),
    dataset_query_variable: '',
    opening_statement: appFeatures.opening_statement ?? '',
    suggested_questions: appFeatures.suggested_questions ?? [],
    suggested_questions_after_answer: toEnabledConfig(appFeatures.suggested_questions_after_answer) as ChatConfig['suggested_questions_after_answer'],
    more_like_this: { enabled: false },
    text_to_speech: toEnabledConfig(appFeatures.text_to_speech) as ChatConfig['text_to_speech'],
    speech_to_text: toEnabledConfig(appFeatures.speech_to_text),
    retriever_resource: toEnabledConfig(appFeatures.retriever_resource),
    sensitive_word_avoidance: toEnabledConfig(appFeatures.sensitive_word_avoidance),
    annotation_reply: {
      id: '',
      enabled: false,
      score_threshold: 0.9,
      embedding_model: {
        embedding_provider_name: '',
        embedding_model_name: '',
      },
    },
    agent_mode: {
      enabled: difyTools.length > 0 || cliTools.length > 0,
      strategy: AgentStrategy.functionCall,
      tools: [
        ...difyTools.map(toAgentTool),
        ...cliTools.map(toCliTool),
      ] as ChatConfig['agent_mode']['tools'],
    },
    model: {
      provider: currentModel?.provider ?? agentSoulConfig?.model?.model_provider ?? '',
      name: currentModel?.model ?? agentSoulConfig?.model?.model ?? '',
      mode: ModelModeType.chat,
      completion_params: {
        temperature: modelSettings.temperature ?? 0.7,
        top_p: modelSettings.top_p ?? 1,
        max_tokens: modelSettings.max_tokens ?? 512,
        presence_penalty: modelSettings.presence_penalty ?? 0,
        frequency_penalty: modelSettings.frequency_penalty ?? 0,
        stop: modelSettings.stop ?? [],
        echo: false,
      },
    },
    dataset_configs: toLegacyPreviewDatasetConfigs(agentSoulConfig?.knowledge),
    file_upload: toPreviewFileUploadConfig(appFeatures.file_upload as FileUpload | undefined),
    system_parameters: defaultSystemParameters,
    supportCitationHitInfo: true,
  }
}

export type AgentChatRuntimeEmptyStateProps = {
  agentIcon?: string | null
  agentIconBackground?: string | null
  agentIconType?: AgentIconType | null
  agentName?: string
  hasInstructions: boolean
  inputNode: ReactNode
}

export type AgentChatRuntimeProps = {
  agentId: string
  agentIcon?: string | null
  agentIconBackground?: string | null
  agentIconType?: AgentIconType | null
  agentName?: string
  agentSoulConfig?: AgentSoulConfig
  clearChatList: boolean
  conversationId?: string | null
  draftType?: 'debug_build'
  inputPlaceholder: string
  sendButtonLabel?: string
  renderEmptyState: (props: AgentChatRuntimeEmptyStateProps) => ReactNode
  onClearChatListChange: (clearChatList: boolean) => void
  onConversationComplete?: (conversationId: string, workflowRunId?: string) => void
  onConversationIdChange?: (conversationId: string) => void
  onWorkflowRunIdChange?: (workflowRunId: string | null) => void
  onSaveDraftBeforeRun?: () => Promise<AgentSoulConfig | void>
  onSendInterrupted?: () => void
}

export function AgentChatRuntime({
  agentId,
  agentIcon,
  agentIconBackground,
  agentIconType,
  agentName,
  agentSoulConfig,
  clearChatList,
  conversationId,
  draftType,
  inputPlaceholder,
  sendButtonLabel,
  renderEmptyState,
  onClearChatListChange,
  onConversationComplete,
  onConversationIdChange,
  onWorkflowRunIdChange,
  onSendInterrupted,
  onSaveDraftBeforeRun,
}: AgentChatRuntimeProps) {
  const [currentSessionConversationId, setCurrentSessionConversationId] = useState<string | null>(null)
  const handleClearChatListChange = useCallback((nextClearChatList: boolean) => {
    if (!nextClearChatList)
      setCurrentSessionConversationId(null)
    onClearChatListChange(nextClearChatList)
  }, [onClearChatListChange])
  const historyQuery = useQuery(consoleQuery.agent.byAgentId.chatMessages.get.queryOptions({
    input: conversationId
      ? {
          params: {
            agent_id: agentId,
          },
          query: {
            conversation_id: conversationId,
          },
        }
      : skipToken,
  }))
  const conversationBelongsToCurrentSession = !!conversationId && conversationId === currentSessionConversationId
  const initialChatTree = useMemo(
    () => getFormattedAgentDebugChatTree(historyQuery.data?.data ?? []),
    [historyQuery.data?.data],
  )
  useEffect(() => {
    if (!conversationId || !historyQuery.data)
      return

    onWorkflowRunIdChange?.(getLastWorkflowRunId(historyQuery.data.data ?? []))
  }, [conversationId, historyQuery.data, onWorkflowRunIdChange])

  if (conversationId && historyQuery.isPending && !conversationBelongsToCurrentSession) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loading type="app" />
      </div>
    )
  }
  const chatSessionKey = !conversationId || conversationBelongsToCurrentSession
    ? 'current-session'
    : `${conversationId}-${historyQuery.dataUpdatedAt}`

  return (
    <AgentPreviewChatSession
      key={chatSessionKey}
      agentId={agentId}
      agentIcon={agentIcon}
      agentIconBackground={agentIconBackground}
      agentIconType={agentIconType}
      agentName={agentName}
      agentSoulConfig={agentSoulConfig}
      clearChatList={clearChatList}
      conversationId={conversationId}
      draftType={draftType}
      initialChatTree={initialChatTree}
      inputPlaceholder={inputPlaceholder}
      sendButtonLabel={sendButtonLabel}
      renderEmptyState={renderEmptyState}
      onClearChatListChange={handleClearChatListChange}
      onConversationComplete={onConversationComplete}
      onConversationIdChange={onConversationIdChange}
      onCurrentSessionConversationIdChange={setCurrentSessionConversationId}
      onSendInterrupted={onSendInterrupted}
      onSaveDraftBeforeRun={onSaveDraftBeforeRun}
    />
  )
}

function AgentPreviewChatSession({
  agentId,
  agentIcon,
  agentIconBackground,
  agentIconType,
  agentName,
  agentSoulConfig,
  clearChatList,
  conversationId,
  draftType,
  initialChatTree,
  inputPlaceholder,
  sendButtonLabel,
  renderEmptyState,
  onClearChatListChange,
  onConversationComplete,
  onConversationIdChange,
  onCurrentSessionConversationIdChange,
  onSendInterrupted,
  onSaveDraftBeforeRun,
}: {
  agentId: string
  agentIcon?: string | null
  agentIconBackground?: string | null
  agentIconType?: AgentIconType | null
  agentName?: string
  agentSoulConfig?: AgentSoulConfig
  clearChatList: boolean
  conversationId?: string | null
  draftType?: 'debug_build'
  initialChatTree: ChatItemInTree[]
  inputPlaceholder: string
  sendButtonLabel?: string
  renderEmptyState: (props: AgentChatRuntimeEmptyStateProps) => ReactNode
  onClearChatListChange: (clearChatList: boolean) => void
  onConversationComplete?: (conversationId: string, workflowRunId?: string) => void
  onConversationIdChange?: (conversationId: string) => void
  onCurrentSessionConversationIdChange: (conversationId: string) => void
  onSaveDraftBeforeRun?: () => Promise<AgentSoulConfig | void>
  onSendInterrupted?: () => void
}) {
  const queryClient = useQueryClient()
  const { userProfile } = useAppContext()
  const prompt = useAtomValue(agentComposerPromptAtom)
  const currentModel = useAtomValue(agentComposerModelAtom)
  const config = useMemo(() => buildChatConfig({
    agentSoulConfig,
    currentModel,
    prompt,
  }), [agentSoulConfig, currentModel, prompt])
  const inputsForm = useMemo(() => getAgentSoulInputsForm(agentSoulConfig), [agentSoulConfig])
  const inputs = useMemo(() => getAgentSoulInputs(inputsForm), [inputsForm])
  const sendInterruptedRef = useRef(false)
  const [isSendPending, setIsSendPending] = useState(false)
  const notifySendInterrupted = useCallback(() => {
    if (sendInterruptedRef.current)
      return

    sendInterruptedRef.current = true
    onSendInterrupted?.()
  }, [onSendInterrupted])
  const {
    textGenerationModelList,
  } = useTextGenerationCurrentProviderAndModelAndModelList(currentModel)
  const {
    chatList,
    setTargetMessageId,
    isResponding,
    handleSend,
    suggestedQuestions,
    handleStop,
    handleAnnotationAdded,
    handleAnnotationEdited,
    handleAnnotationRemoved,
  } = useChat(
    config,
    {
      inputs,
      inputsForm,
    },
    initialChatTree,
    (taskId) => {
      void stopAgentChatMessageResponding(agentId, taskId)
    },
    clearChatList,
    onClearChatListChange,
    conversationId ?? undefined,
  )

  const doSend: OnSend = useCallback(async (message, files, isRegenerate = false, parentAnswer: ChatItem | null = null) => {
    sendInterruptedRef.current = false
    setIsSendPending(true)
    let sendStarted = false

    try {
      const preparedAgentSoulConfig = await onSaveDraftBeforeRun?.()
      const runtimeAgentSoulConfig = preparedAgentSoulConfig || agentSoulConfig
      const runtimeInputsForm = preparedAgentSoulConfig ? getAgentSoulInputsForm(runtimeAgentSoulConfig) : inputsForm
      const runtimeInputs = preparedAgentSoulConfig ? getAgentSoulInputs(runtimeInputsForm) : inputs
      const runtimeConfig = preparedAgentSoulConfig
        ? buildChatConfig({
            agentSoulConfig: runtimeAgentSoulConfig,
            currentModel: undefined,
            prompt: runtimeAgentSoulConfig?.prompt?.system_prompt ?? '',
          })
        : config

      const currentProvider = textGenerationModelList.find(item => item.provider === runtimeConfig.model.provider)
      const selectedModel = currentProvider?.models.find(model => model.model === runtimeConfig.model.name)
      const supportVision = selectedModel?.features?.includes(ModelFeatureEnum.vision)
      const data: Record<string, unknown> = {
        query: message,
        inputs: runtimeInputs,
        overrideInputsForm: runtimeInputsForm,
        parent_message_id: (isRegenerate ? parentAnswer?.id : getLastAnswer(chatList)?.id) || null,
      }
      if (draftType)
        data.draft_type = draftType

      if (files?.length && supportVision)
        data.files = files

      handleSend(
        `agent/${agentId}/chat-messages`,
        data as Parameters<typeof handleSend>[1],
        {
          onGetConversationMessages: async (conversationId) => {
            return queryClient.fetchQuery({
              ...consoleQuery.agent.byAgentId.chatMessages.get.queryOptions({
                input: {
                  params: {
                    agent_id: agentId,
                  },
                  query: {
                    conversation_id: conversationId,
                  },
                },
              }),
              staleTime: 0,
            })
          },
          onGetSuggestedQuestions: responseItemId => fetchAgentSuggestedQuestions(agentId, responseItemId),
          onConversationComplete: (completedConversationId, workflowRunId) => {
            if (completedConversationId && completedConversationId !== conversationId)
              onCurrentSessionConversationIdChange(completedConversationId)
            onConversationIdChange?.(completedConversationId)
            onConversationComplete?.(completedConversationId, workflowRunId)
          },
          onSendSettled: (hasError) => {
            setIsSendPending(false)
            if (hasError)
              notifySendInterrupted()
          },
        },
      )
      sendStarted = true
    }
    catch {
      return false
    }
    finally {
      if (!sendStarted)
        setIsSendPending(false)
    }
  }, [agentId, agentSoulConfig, chatList, config, conversationId, draftType, handleSend, inputs, inputsForm, notifySendInterrupted, onConversationComplete, onConversationIdChange, onCurrentSessionConversationIdChange, onSaveDraftBeforeRun, queryClient, textGenerationModelList])

  const doStopResponding = useCallback(() => {
    handleStop()
    notifySendInterrupted()
  }, [handleStop, notifySendInterrupted])

  const doRegenerate = useCallback((chatItem: ChatItem, editedQuestion?: { message: string, files?: FileEntity[] }) => {
    const question = editedQuestion ? chatItem : chatList.find(item => item.id === chatItem.parentMessageId)
    if (!question)
      return

    const parentAnswer = chatList.find(item => item.id === question.parentMessageId)
    doSend(
      editedQuestion ? editedQuestion.message : question.content,
      editedQuestion ? editedQuestion.files : question.message_files,
      true,
      isValidGeneratedAnswer(parentAnswer) ? parentAnswer : null,
    )
  }, [chatList, doSend])
  const isEmptyChat = chatList.length === 0
  const hasInstructions = !!config.pre_prompt.trim()
  const sendButtonLoading = isEmptyChat && !!sendButtonLabel && (isSendPending || isResponding)
  const emptyChatInputNode = (
    <div className="pointer-events-auto mt-5 w-full">
      <ChatInputArea
        botName={agentName || 'Agent'}
        customPlaceholder={inputPlaceholder}
        disabled={isResponding}
        sendButtonLoading={sendButtonLoading}
        showFileUpload={false}
        visionConfig={config.file_upload}
        speechToTextConfig={config.speech_to_text}
        onSend={doSend}
        inputs={inputs}
        inputsForm={inputsForm}
        sendButtonLabel={sendButtonLabel}
      />
    </div>
  )

  return (
    <Chat
      config={config}
      chatList={chatList}
      isResponding={isResponding}
      sendButtonLoading={sendButtonLoading}
      chatNode={isEmptyChat
        ? renderEmptyState({
            agentIcon,
            agentIconBackground,
            agentIconType,
            agentName,
            hasInstructions,
            inputNode: emptyChatInputNode,
          })
        : null}
      chatContainerClassName={cn('pt-6', isEmptyChat ? 'px-12 pt-2 !pb-[88px]' : 'px-3')}
      chatFooterClassName={cn(
        '!bottom-2 pb-0',
        isEmptyChat ? 'hidden' : 'px-3 pt-10',
      )}
      inputPlaceholder={inputPlaceholder}
      sendButtonLabel={isEmptyChat ? sendButtonLabel : undefined}
      showFileUpload={false}
      suggestedQuestions={suggestedQuestions}
      onSend={doSend}
      inputs={inputs}
      inputsForm={inputsForm}
      onRegenerate={doRegenerate}
      switchSibling={siblingMessageId => setTargetMessageId(siblingMessageId)}
      onStopResponding={doStopResponding}
      noChatInput={isEmptyChat}
      showPromptLog
      questionIcon={<Avatar avatar={userProfile.avatar_url} name={userProfile.name} size="xl" />}
      onAnnotationEdited={handleAnnotationEdited}
      onAnnotationAdded={handleAnnotationAdded}
      onAnnotationRemoved={handleAnnotationRemoved}
      noSpacing
    />
  )
}
