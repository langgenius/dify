'use client'

import type {
  AgentCliToolConfig,
  AgentIconType,
  AgentSoulConfig,
  AgentSoulDifyToolConfig,
  AgentThought,
  MessageDetailResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import type { FeedbackType, IChatItem, ThoughtItem } from '@/app/components/base/chat/chat/type'
import type { ChatConfig, ChatItem, ChatItemInTree, OnSend } from '@/app/components/base/chat/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Inputs } from '@/models/debug'
import type { MessageRating } from '@/models/log'
import type { FileResponse } from '@/types/workflow'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { useChat } from '@/app/components/base/chat/chat/hooks'
import { buildChatItemTree, getLastAnswer, isValidGeneratedAnswer } from '@/app/components/base/chat/utils'
import { getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import Loading from '@/app/components/base/loading'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { addFileInfos, sortAgentSorts } from '@/app/components/tools/utils'
import { InputVarType } from '@/app/components/workflow/types'
import { DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import { useAppContext } from '@/context/app-context'
import { agentComposerModelAtom } from '@/features/agent-v2/agent-composer/store-modules/model'
import { agentComposerPromptAtom } from '@/features/agent-v2/agent-composer/store-modules/prompt'
import { PromptMode } from '@/models/debug'
import dynamic from '@/next/dynamic'
import { consoleClient } from '@/service/client'
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

const stopAgentChatMessageResponding = (agentId: string, taskId: string) => {
  return consoleClient.agent.byAgentId.chatMessages.byTaskId.stop.post({
    params: {
      agent_id: agentId,
      task_id: taskId,
    },
  })
}

const fetchAgentConversationMessages = (agentId: string, conversationId: string) => {
  return consoleClient.agent.byAgentId.chatMessages.get({
    params: {
      agent_id: agentId,
    },
    query: {
      conversation_id: conversationId,
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
  currentModel?: DefaultModel
  prompt: string
}): AgentPreviewChatConfig => {
  const modelSettings = getModelSettings(agentSoulConfig)
  const appFeatures = agentSoulConfig?.app_features ?? {}
  const datasets = agentSoulConfig?.knowledge?.datasets ?? []
  const difyTools = agentSoulConfig?.tools?.dify_tools ?? []
  const cliTools = agentSoulConfig?.tools?.cli_tools ?? []

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
    dataset_configs: {
      retrieval_model: RETRIEVE_TYPE.multiWay,
      reranking_model: {
        reranking_provider_name: '',
        reranking_model_name: '',
      },
      top_k: agentSoulConfig?.knowledge?.query_config?.top_k ?? 4,
      score_threshold_enabled: agentSoulConfig?.knowledge?.query_config?.score_threshold_enabled ?? false,
      score_threshold: agentSoulConfig?.knowledge?.query_config?.score_threshold ?? 0.8,
      datasets: {
        datasets: datasets.map(dataset => ({
          enabled: true,
          id: dataset.id ?? '',
        })).filter(dataset => dataset.id),
      },
    },
    file_upload: disabledFileUploadConfig,
    system_parameters: defaultSystemParameters,
    supportCitationHitInfo: true,
  }
}

function AgentPreviewChatEmptyState({
  agentIcon,
  agentIconBackground,
  agentIconType,
  agentName,
  hasInstructions,
}: {
  agentIcon?: string | null
  agentIconBackground?: string | null
  agentIconType?: AgentIconType | null
  agentName?: string
  hasInstructions: boolean
}) {
  const { t } = useTranslation('agentV2')
  const imageUrl = (agentIconType === 'image' || agentIconType === 'link') ? agentIcon : undefined
  const iconType = imageUrl ? 'image' : agentIconType

  return (
    <div className="pointer-events-none absolute inset-x-12 bottom-[calc(27%+84px)] flex flex-col items-center text-center">
      <AppIcon
        size="xxl"
        rounded
        iconType={iconType}
        icon={agentIcon ?? undefined}
        background={agentIconBackground}
        imageUrl={imageUrl}
        className="bg-background-default"
      />
      <div className="mt-3 max-w-full truncate system-md-semibold text-text-secondary">
        {agentName || t('agentDetail.configure.preview.empty.defaultAgentName')}
      </div>
      <div className="mt-4 h-px w-73 max-w-full bg-divider-subtle" />
      <div className="mt-5 max-w-91 body-md-regular text-text-tertiary">
        <p>{t('agentDetail.configure.preview.empty.description')}</p>
        {!hasInstructions && (
          <p>{t('agentDetail.configure.preview.empty.noInstructionsDescription')}</p>
        )}
      </div>
    </div>
  )
}

export function AgentPreviewChat({
  agentId,
  agentIcon,
  agentIconBackground,
  agentIconType,
  agentName,
  agentSoulConfig,
  clearChatList,
  debugConversationId,
  onClearChatListChange,
  onSaveDraftBeforeRun,
}: {
  agentId: string
  agentIcon?: string | null
  agentIconBackground?: string | null
  agentIconType?: AgentIconType | null
  agentName?: string
  agentSoulConfig?: AgentSoulConfig
  clearChatList: boolean
  debugConversationId?: string | null
  onClearChatListChange: (clearChatList: boolean) => void
  onSaveDraftBeforeRun?: () => Promise<void>
}) {
  const historyQuery = useQuery({
    queryKey: ['agent-preview-debug-conversation', agentId, debugConversationId],
    queryFn: () => fetchAgentConversationMessages(agentId, debugConversationId!),
    enabled: !!debugConversationId,
  })
  const initialChatTree = useMemo(
    () => getFormattedAgentDebugChatTree(historyQuery.data?.data ?? []),
    [historyQuery.data?.data],
  )

  if (debugConversationId && historyQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loading type="app" />
      </div>
    )
  }

  return (
    <AgentPreviewChatSession
      key={`${debugConversationId ?? 'new'}-${historyQuery.dataUpdatedAt}`}
      agentId={agentId}
      agentIcon={agentIcon}
      agentIconBackground={agentIconBackground}
      agentIconType={agentIconType}
      agentName={agentName}
      agentSoulConfig={agentSoulConfig}
      clearChatList={clearChatList}
      debugConversationId={debugConversationId}
      initialChatTree={initialChatTree}
      onClearChatListChange={onClearChatListChange}
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
  debugConversationId,
  initialChatTree,
  onClearChatListChange,
  onSaveDraftBeforeRun,
}: {
  agentId: string
  agentIcon?: string | null
  agentIconBackground?: string | null
  agentIconType?: AgentIconType | null
  agentName?: string
  agentSoulConfig?: AgentSoulConfig
  clearChatList: boolean
  debugConversationId?: string | null
  initialChatTree: ChatItemInTree[]
  onClearChatListChange: (clearChatList: boolean) => void
  onSaveDraftBeforeRun?: () => Promise<void>
}) {
  const { userProfile } = useAppContext()
  const prompt = useAtomValue(agentComposerPromptAtom)
  const currentModel = useAtomValue(agentComposerModelAtom)
  const config = useMemo(() => buildChatConfig({
    agentSoulConfig,
    currentModel,
    prompt,
  }), [agentSoulConfig, currentModel, prompt])
  const inputsForm = useMemo(() => (agentSoulConfig?.app_variables ?? []).map(toInputForm), [agentSoulConfig?.app_variables])
  const inputs = useMemo(() => {
    return inputsForm.reduce<Inputs>((acc, input) => {
      acc[input.variable] = (input.default ?? '') as Inputs[string]
      return acc
    }, {})
  }, [inputsForm])
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
    debugConversationId ?? undefined,
  )

  const doSend: OnSend = useCallback(async (message, files, isRegenerate = false, parentAnswer: ChatItem | null = null) => {
    try {
      await onSaveDraftBeforeRun?.()
    }
    catch {
      return
    }

    const currentProvider = textGenerationModelList.find(item => item.provider === config.model.provider)
    const selectedModel = currentProvider?.models.find(model => model.model === config.model.name)
    const supportVision = selectedModel?.features?.includes(ModelFeatureEnum.vision)
    const data: Record<string, unknown> = {
      query: message,
      inputs,
      parent_message_id: (isRegenerate ? parentAnswer?.id : getLastAnswer(chatList)?.id) || null,
    }

    if (files?.length && supportVision)
      data.files = files

    handleSend(
      `agent/${agentId}/chat-messages`,
      data as Parameters<typeof handleSend>[1],
      {
        onGetConversationMessages: conversationId => fetchAgentConversationMessages(agentId, conversationId),
        onGetSuggestedQuestions: responseItemId => fetchAgentSuggestedQuestions(agentId, responseItemId),
      },
    )
  }, [agentId, chatList, config.model.name, config.model.provider, handleSend, inputs, onSaveDraftBeforeRun, textGenerationModelList])

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

  return (
    <Chat
      config={config}
      chatList={chatList}
      isResponding={isResponding}
      chatNode={isEmptyChat && (
        <AgentPreviewChatEmptyState
          agentIcon={agentIcon}
          agentIconBackground={agentIconBackground}
          agentIconType={agentIconType}
          agentName={agentName}
          hasInstructions={hasInstructions}
        />
      )}
      chatContainerClassName={cn('pt-6', isEmptyChat ? 'px-12' : 'px-3')}
      chatFooterClassName={cn(
        'pb-0',
        isEmptyChat ? '!bottom-[27%] px-12 pt-3' : 'px-3 pt-10',
      )}
      showFileUpload={false}
      suggestedQuestions={suggestedQuestions}
      onSend={doSend}
      inputs={inputs}
      inputsForm={inputsForm}
      onRegenerate={doRegenerate}
      switchSibling={siblingMessageId => setTargetMessageId(siblingMessageId)}
      onStopResponding={handleStop}
      showPromptLog
      questionIcon={<Avatar avatar={userProfile.avatar_url} name={userProfile.name} size="xl" />}
      onAnnotationEdited={handleAnnotationEdited}
      onAnnotationAdded={handleAnnotationAdded}
      onAnnotationRemoved={handleAnnotationRemoved}
      noSpacing
    />
  )
}
