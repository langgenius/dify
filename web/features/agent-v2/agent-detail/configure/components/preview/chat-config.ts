import type {
  AgentCliToolConfig,
  AgentSoulConfig,
  AgentSoulDifyToolConfig,
} from '@dify/contracts/api/console/agent/types.gen'
import type { InputForm } from '@/app/components/base/chat/chat/type'
import type { ChatConfig } from '@/app/components/base/chat/types'
import type { FileUpload } from '@/app/components/base/features/types'
import type { AgentComposerModel } from '@/features/agent-v2/agent-composer/form-state'
import type { Inputs } from '@/models/debug'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import { ENABLE_AGENT_CLI_TOOLS } from '@/features/agent-v2/agent-detail/configure/feature-flags'
import { PromptMode } from '@/models/debug'
import { AgentStrategy, ModelModeType, RETRIEVE_TYPE, TransferMethod } from '@/types/app'

export type AgentPreviewChatConfig = ChatConfig & {
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
  if (!fileUpload?.enabled) return disabledFileUploadConfig

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

const getModelSettings = (agentSoulConfig?: AgentSoulConfig) =>
  agentSoulConfig?.model?.model_settings ?? {}

const toEnabledConfig = (config?: { enabled?: boolean } | null) => ({
  ...config,
  enabled: config?.enabled ?? false,
})

const toInputType = (type: string): InputVarType => {
  if (type === InputVarType.paragraph) return InputVarType.paragraph
  if (type === InputVarType.select) return InputVarType.select
  if (type === InputVarType.number) return InputVarType.number
  if (type === InputVarType.json || type === InputVarType.jsonObject) return InputVarType.json

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

export const getAgentSoulInputsForm = (agentSoulConfig?: AgentSoulConfig) =>
  (agentSoulConfig?.app_variables ?? []).map(toInputForm)

export const getAgentSoulInputs = (inputsForm: InputForm[]) => {
  return inputsForm.reduce<Inputs>((acc, input) => {
    acc[input.variable] = (input.default ?? '') as Inputs[string]
    return acc
  }, {})
}

const toAgentTool = (tool: AgentSoulDifyToolConfig) => ({
  provider_id: tool.provider_id ?? tool.provider ?? tool.plugin_id ?? '',
  provider_type: tool.provider_type,
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
    score_threshold_enabled:
      retrieval?.score_threshold !== undefined && retrieval?.score_threshold !== null,
    score_threshold: retrieval?.score_threshold ?? 0.8,
    datasets: {
      datasets: datasets
        .map((dataset) => ({
          enabled: true,
          id: dataset.id ?? '',
        }))
        .filter((dataset) => dataset.id),
    },
  }
}

export const buildChatConfig = ({
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
    user_input_form: (agentSoulConfig?.app_variables ?? []).map((variable) => ({
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
    suggested_questions_after_answer: toEnabledConfig(
      appFeatures.suggested_questions_after_answer,
    ) as ChatConfig['suggested_questions_after_answer'],
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
