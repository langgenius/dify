/* eslint-disable typescript/no-explicit-any */
'use client'
import type { FC } from 'react'
import type { Features as FeaturesData, FileUpload } from '@/app/components/base/features/types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ModelConfig } from '@/models/debug'
import type { TryAppInfo } from '@/service/try-app'
import type { PromptVariable } from '@/types/app'
import { noop } from 'es-toolkit/function'
import { clone } from 'es-toolkit/object'
import * as React from 'react'
import { useMemo, useState } from 'react'
import Config from '@/app/components/app/configuration/config'
import Debug from '@/app/components/app/configuration/debug'
import { FeaturesProvider } from '@/app/components/base/features'
import Loading from '@/app/components/base/loading'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { CollectionType } from '@/app/components/tools/types'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import {
  ANNOTATION_DEFAULT,
  DEFAULT_AGENT_SETTING,
  DEFAULT_CHAT_PROMPT_CONFIG,
  DEFAULT_COMPLETION_PROMPT_CONFIG,
} from '@/config'
import ConfigContext from '@/context/debug-configuration'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { PromptMode } from '@/models/debug'
import { useAllToolProviders } from '@/service/use-tools'
import { useGetTryAppDataSets, useGetTryAppInfo } from '@/service/use-try-app'
import { AgentStrategy, ModelModeType, Resolution, TransferMethod, TtsAutoPlay } from '@/types/app'
import { correctModelProvider, correctToolProvider } from '@/utils'
import { userInputsFormToPromptVariables } from '@/utils/model-config'
import { basePath } from '@/utils/var'
import { useTextGenerationCurrentProviderAndModelAndModelList } from '../../../header/account-setting/model-provider-page/hooks'

type Props = {
  readonly appId: string
}

type AgentToolItem = Extract<ModelConfig['agentConfig']['tools'][number], { tool_name: string }>

const DEFAULT_SYSTEM_PARAMETERS: ModelConfig['system_parameters'] = {
  audio_file_size_limit: 0,
  file_size_limit: 0,
  image_file_size_limit: 0,
  video_file_size_limit: 0,
  workflow_file_upload_limit: 0,
}

const defaultModelConfig: ModelConfig = {
  provider: 'langgenius/openai/openai',
  model_id: 'gpt-3.5-turbo',
  mode: ModelModeType.unset,
  configs: {
    prompt_template: '',
    prompt_variables: [] as PromptVariable[],
  },
  more_like_this: null,
  opening_statement: '',
  suggested_questions: [],
  sensitive_word_avoidance: null,
  speech_to_text: null,
  text_to_speech: null,
  file_upload: null,
  suggested_questions_after_answer: null,
  retriever_resource: null,
  annotation_reply: null,
  system_parameters: DEFAULT_SYSTEM_PARAMETERS,
  dataSets: [],
  agentConfig: DEFAULT_AGENT_SETTING,
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const getString = (value: unknown) => {
  return typeof value === 'string' ? value : ''
}

const getBoolean = (value: unknown) => {
  return typeof value === 'boolean' ? value : false
}

const getNumber = (value: unknown, fallback: number) => {
  return typeof value === 'number' ? value : fallback
}

const getOptionalString = (value: unknown) => {
  return typeof value === 'string' ? value : undefined
}

const getStringArray = (value: unknown) => {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined
}

const getTransferMethods = (value: unknown) => {
  if (!Array.isArray(value)) return undefined

  const transferMethods = new Set<string>(Object.values(TransferMethod))
  return value.filter(
    (item): item is TransferMethod => typeof item === 'string' && transferMethods.has(item),
  )
}

const getResolution = (value: unknown) => {
  return value === Resolution.low ? Resolution.low : Resolution.high
}

const normalizeEnabledConfig = (value: unknown): { enabled: boolean } | null => {
  if (!isRecord(value)) return null

  return {
    ...value,
    enabled: getBoolean(value.enabled),
  } as { enabled: boolean }
}

const normalizeTextToSpeech = (value: unknown): ModelConfig['text_to_speech'] => {
  if (!isRecord(value)) return null

  const autoPlayValue = getString(value.autoPlay)
  const autoPlay =
    autoPlayValue === TtsAutoPlay.enabled || autoPlayValue === TtsAutoPlay.disabled
      ? autoPlayValue
      : undefined

  return {
    ...value,
    enabled: getBoolean(value.enabled),
    voice: getOptionalString(value.voice),
    language: getOptionalString(value.language),
    ...(autoPlay ? { autoPlay } : {}),
  } as ModelConfig['text_to_speech']
}

const normalizeAnnotationReply = (value: unknown): ModelConfig['annotation_reply'] => {
  if (!isRecord(value)) return null

  const embeddingModel = isRecord(value.embedding_model) ? value.embedding_model : {}
  return {
    ...value,
    id: getString(value.id),
    enabled: getBoolean(value.enabled),
    score_threshold: getNumber(value.score_threshold, ANNOTATION_DEFAULT.score_threshold),
    embedding_model: {
      embedding_provider_name: getString(embeddingModel.embedding_provider_name),
      embedding_model_name: getString(embeddingModel.embedding_model_name),
    },
  } as ModelConfig['annotation_reply']
}

const normalizeModeration = (value: unknown): ModelConfig['sensitive_word_avoidance'] => {
  if (!isRecord(value)) return null

  return {
    ...value,
    enabled: getBoolean(value.enabled),
    type: getOptionalString(value.type),
    config: isRecord(value.config) ? value.config : undefined,
  } as ModelConfig['sensitive_word_avoidance']
}

const normalizeSuggestedQuestionsAfterAnswer = (
  value: unknown,
): ModelConfig['suggested_questions_after_answer'] => {
  if (!isRecord(value)) return null

  return {
    ...value,
    enabled: getBoolean(value.enabled),
    prompt: getOptionalString(value.prompt),
  } as ModelConfig['suggested_questions_after_answer']
}

const normalizeFileUploadSection = (value: unknown, includeDetail = false) => {
  if (!isRecord(value)) return undefined

  return {
    ...value,
    enabled: getBoolean(value.enabled),
    number_limits: getNumber(value.number_limits, 0),
    transfer_methods: getTransferMethods(value.transfer_methods),
    ...(includeDetail ? { detail: getResolution(value.detail) } : {}),
  }
}

const normalizeFileUpload = (value: unknown): ModelConfig['file_upload'] => {
  if (!isRecord(value)) return null

  return {
    ...value,
    enabled: getBoolean(value.enabled),
    image: normalizeFileUploadSection(value.image, true),
    document: normalizeFileUploadSection(value.document),
    audio: normalizeFileUploadSection(value.audio),
    video: normalizeFileUploadSection(value.video),
    custom: normalizeFileUploadSection(value.custom),
    allowed_file_types: getStringArray(value.allowed_file_types),
    allowed_file_extensions: getStringArray(value.allowed_file_extensions),
    allowed_file_upload_methods: getTransferMethods(value.allowed_file_upload_methods),
    number_limits: getNumber(value.number_limits, 0),
  } as ModelConfig['file_upload']
}

const normalizeExternalDataTools = (
  items?: Record<string, unknown>[],
): NonNullable<ModelConfig['external_data_tools']> => {
  return (
    items?.map(
      (item) =>
        ({
          ...item,
          type: getOptionalString(item.type),
          label: getOptionalString(item.label),
          icon: getOptionalString(item.icon),
          icon_background: getOptionalString(item.icon_background),
          variable: getOptionalString(item.variable),
          enabled: getBoolean(item.enabled),
          config: isRecord(item.config)
            ? {
                ...item.config,
                api_based_extension_id: getOptionalString(item.config.api_based_extension_id),
              }
            : undefined,
        }) as NonNullable<ModelConfig['external_data_tools']>[number],
    ) ?? []
  )
}

const normalizeCollectionType = (value: unknown): AgentToolItem['provider_type'] => {
  const type = getString(value)
  const collectionTypes = new Set<string>(Object.values(CollectionType))
  return collectionTypes.has(type)
    ? (type as AgentToolItem['provider_type'])
    : CollectionType.builtIn
}

const normalizeAgentStrategy = (value: unknown): AgentStrategy => {
  const strategy = getString(value)
  return strategy === AgentStrategy.react || strategy === AgentStrategy.functionCall
    ? strategy
    : DEFAULT_AGENT_SETTING.strategy
}

const getAgentTools = (agentMode: unknown) => {
  if (!isRecord(agentMode) || !Array.isArray(agentMode.tools)) return []

  return agentMode.tools.filter(isRecord)
}

const isEnabledDatasetTool = (tool: Record<string, unknown>) => {
  return isRecord(tool.dataset) && tool.dataset.enabled === true
}

const getDatasetConfigItems = (datasetConfigs: unknown) => {
  if (
    !isRecord(datasetConfigs) ||
    !isRecord(datasetConfigs.datasets) ||
    !Array.isArray(datasetConfigs.datasets.datasets)
  )
    return []

  return datasetConfigs.datasets.datasets.filter(isRecord)
}

const getDatasetId = (value: Record<string, unknown>) => {
  if (typeof value.id === 'string') return value.id

  if (isRecord(value.dataset) && typeof value.dataset.id === 'string') return value.dataset.id

  return null
}

const normalizeExternalDataToolFormItem = (item: Record<string, unknown>) => {
  return {
    external_data_tool: {
      variable: getString(item.variable),
      label: getString(item.label),
      enabled: getBoolean(item.enabled),
      type: getString(item.type),
      config: isRecord(item.config) ? item.config : undefined,
      required: true,
      icon: getString(item.icon),
      icon_background: getString(item.icon_background),
    },
  }
}

const normalizeAgentTool = (
  tool: Record<string, unknown>,
  deletedTools: TryAppInfo['deleted_tools'] | undefined,
  collectionList: ReturnType<typeof useAllToolProviders>['data'] | undefined,
): AgentToolItem => {
  const providerId = getString(tool.provider_id)
  const providerName = getString(tool.provider_name)
  const providerType = normalizeCollectionType(tool.provider_type)
  const toolName = getString(tool.tool_name)
  const toolInCollectionList = collectionList?.find((c) => providerId === c.id)

  return {
    ...tool,
    provider_id:
      providerType === CollectionType.builtIn
        ? correctToolProvider(providerName, !!toolInCollectionList)
        : providerId,
    provider_name:
      providerType === CollectionType.builtIn
        ? correctToolProvider(providerName, !!toolInCollectionList)
        : providerName,
    provider_type: providerType,
    tool_name: toolName,
    tool_label: getString(tool.tool_label) || toolName,
    tool_parameters: isRecord(tool.tool_parameters) ? tool.tool_parameters : {},
    enabled: getBoolean(tool.enabled),
    isDeleted: deletedTools?.some(
      (deletedTool) => deletedTool.provider_id === providerId && deletedTool.tool_name === toolName,
    ),
    notAuthor: toolInCollectionList?.is_team_authorization === false,
    credential_id: getOptionalString(tool.credential_id),
  } as AgentToolItem
}

const BasicAppPreview: FC<Props> = ({ appId }) => {
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const { data: appDetail, isLoading: isLoadingAppDetail } = useGetTryAppInfo(appId)
  const { data: collectionListFromServer, isLoading: isLoadingToolProviders } =
    useAllToolProviders()
  const collectionList = collectionListFromServer?.map((item) => {
    return {
      ...item,
      icon:
        basePath && typeof item.icon == 'string' && !item.icon.includes(basePath)
          ? `${basePath}${item.icon}`
          : item.icon,
    }
  })
  const datasetIds = (() => {
    if (isLoadingAppDetail) return []
    const modelConfig = appDetail?.model_config
    if (!modelConfig) return []

    const agentDatasetTools = getAgentTools(modelConfig.agent_mode).filter(isEnabledDatasetTool)
    const datasetConfigItems = getDatasetConfigItems(modelConfig.dataset_configs)
    const datasets = agentDatasetTools.length > 0 ? agentDatasetTools : datasetConfigItems

    if (datasets?.length && datasets?.length > 0)
      return datasets.map(getDatasetId).filter((id): id is string => !!id)

    return []
  })()
  const { data: dataSetData, isLoading: isLoadingDatasets } = useGetTryAppDataSets(
    appId,
    datasetIds,
  )
  const dataSets = dataSetData?.data || []
  const isLoading = isLoadingAppDetail || isLoadingDatasets || isLoadingToolProviders

  const modelConfig: ModelConfig = ((modelConfig?: TryAppInfo['model_config']) => {
    if (isLoading || !modelConfig?.model) return defaultModelConfig

    const model = modelConfig.model
    const mode =
      model.mode === ModelModeType.chat || model.mode === ModelModeType.completion
        ? model.mode
        : ModelModeType.unset

    const agentMode = isRecord(modelConfig.agent_mode) ? modelConfig.agent_mode : {}
    const newModelConfig: ModelConfig = {
      provider: correctModelProvider(model.provider),
      model_id: model.name,
      mode,
      configs: {
        prompt_template: modelConfig.pre_prompt || '',
        prompt_variables: userInputsFormToPromptVariables(
          [
            ...(modelConfig.user_input_form || []),
            ...(modelConfig.external_data_tools?.length
              ? modelConfig.external_data_tools.map(normalizeExternalDataToolFormItem)
              : []),
          ],
          modelConfig.dataset_query_variable ?? undefined,
        ),
      },
      more_like_this: normalizeEnabledConfig(modelConfig.more_like_this),
      opening_statement: modelConfig.opening_statement ?? '',
      suggested_questions: modelConfig.suggested_questions ?? [],
      sensitive_word_avoidance: normalizeModeration(modelConfig.sensitive_word_avoidance),
      speech_to_text: normalizeEnabledConfig(modelConfig.speech_to_text),
      text_to_speech: normalizeTextToSpeech(modelConfig.text_to_speech),
      file_upload: normalizeFileUpload(modelConfig.file_upload),
      suggested_questions_after_answer: normalizeSuggestedQuestionsAfterAnswer(
        modelConfig.suggested_questions_after_answer,
      ),
      retriever_resource: normalizeEnabledConfig(modelConfig.retriever_resource),
      annotation_reply: normalizeAnnotationReply(modelConfig.annotation_reply),
      external_data_tools: normalizeExternalDataTools(modelConfig.external_data_tools),
      system_parameters: DEFAULT_SYSTEM_PARAMETERS,
      dataSets,
      agentConfig:
        appDetail?.mode === 'agent-chat'
          ? {
              max_iteration: DEFAULT_AGENT_SETTING.max_iteration,
              // remove dataset
              enabled: true, // modelConfig.agent_mode?.enabled is not correct. old app: the value of app with dataset's is always true
              strategy: normalizeAgentStrategy(agentMode.strategy),
              tools: getAgentTools(modelConfig.agent_mode)
                .filter((tool) => {
                  return !tool.dataset
                })
                .map((tool) => normalizeAgentTool(tool, appDetail?.deleted_tools, collectionList)),
            }
          : DEFAULT_AGENT_SETTING,
    }
    return newModelConfig
  })(appDetail?.model_config)
  const mode = appDetail?.mode
  // const isChatApp = ['chat', 'advanced-chat', 'agent-chat'].includes(mode!)

  // chat configuration
  const promptMode =
    modelConfig?.prompt_type === PromptMode.advanced ? PromptMode.advanced : PromptMode.simple
  const isAdvancedMode = promptMode === PromptMode.advanced
  const isAgent = mode === 'agent-chat'
  const chatPromptConfig = isAdvancedMode
    ? modelConfig?.chat_prompt_config || clone(DEFAULT_CHAT_PROMPT_CONFIG)
    : undefined
  const suggestedQuestions = modelConfig?.suggested_questions || []
  const moreLikeThisConfig = modelConfig?.more_like_this || { enabled: false }
  const suggestedQuestionsAfterAnswerConfig = modelConfig?.suggested_questions_after_answer || {
    enabled: false,
  }
  const speechToTextConfig = modelConfig?.speech_to_text || { enabled: false }
  const textToSpeechConfig = modelConfig?.text_to_speech || {
    enabled: false,
    voice: '',
    language: '',
  }
  const citationConfig = modelConfig?.retriever_resource || { enabled: false }
  const annotationConfig = modelConfig?.annotation_reply || {
    id: '',
    enabled: false,
    score_threshold: ANNOTATION_DEFAULT.score_threshold,
    embedding_model: {
      embedding_provider_name: '',
      embedding_model_name: '',
    },
  }
  const moderationConfig = modelConfig?.sensitive_word_avoidance || { enabled: false }
  // completion configuration
  const completionPromptConfig =
    modelConfig?.completion_prompt_config || (clone(DEFAULT_COMPLETION_PROMPT_CONFIG) as any)

  // prompt & model config
  const inputs = {}
  const query = ''
  const completionParams = useState<FormValue>({})

  const { currentModel: currModel } = useTextGenerationCurrentProviderAndModelAndModelList({
    provider: modelConfig.provider,
    model: modelConfig.model_id,
  })

  const isShowVisionConfig = !!currModel?.features?.includes(ModelFeatureEnum.vision)
  const isShowDocumentConfig = !!currModel?.features?.includes(ModelFeatureEnum.document)
  const isShowAudioConfig = !!currModel?.features?.includes(ModelFeatureEnum.audio)
  const isAllowVideoUpload = !!currModel?.features?.includes(ModelFeatureEnum.video)
  const visionConfig = {
    enabled: false,
    number_limits: 2,
    detail: Resolution.low,
    transfer_methods: [TransferMethod.local_file],
  }

  const featuresData: FeaturesData = useMemo(() => {
    return {
      moreLikeThis: modelConfig.more_like_this || { enabled: false },
      opening: {
        enabled: !!modelConfig.opening_statement,
        opening_statement: modelConfig.opening_statement || '',
        suggested_questions: modelConfig.suggested_questions || [],
      },
      moderation: modelConfig.sensitive_word_avoidance || { enabled: false },
      speech2text: modelConfig.speech_to_text || { enabled: false },
      text2speech: modelConfig.text_to_speech || { enabled: false },
      file: {
        image: {
          detail: modelConfig.file_upload?.image?.detail || Resolution.high,
          enabled: !!modelConfig.file_upload?.image?.enabled,
          number_limits: modelConfig.file_upload?.image?.number_limits || 3,
          transfer_methods: modelConfig.file_upload?.image?.transfer_methods || [
            'local_file',
            'remote_url',
          ],
        },
        enabled: !!(modelConfig.file_upload?.enabled || modelConfig.file_upload?.image?.enabled),
        allowed_file_types: modelConfig.file_upload?.allowed_file_types || [],
        allowed_file_extensions:
          modelConfig.file_upload?.allowed_file_extensions ||
          [
            ...(FILE_EXTS[SupportUploadFileTypes.image] ?? []),
            ...(FILE_EXTS[SupportUploadFileTypes.video] ?? []),
          ].map((ext) => `.${ext}`),
        allowed_file_upload_methods: modelConfig.file_upload?.allowed_file_upload_methods ||
          modelConfig.file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
        number_limits:
          modelConfig.file_upload?.number_limits ||
          modelConfig.file_upload?.image?.number_limits ||
          3,
        fileUploadConfig: {},
      } as FileUpload,
      suggested: modelConfig.suggested_questions_after_answer || { enabled: false },
      citation: modelConfig.retriever_resource || { enabled: false },
      annotationReply: modelConfig.annotation_reply || { enabled: false },
    }
  }, [modelConfig])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loading type="area" />
      </div>
    )
  }
  const value = {
    readonly: true,
    appId,
    isAPIKeySet: true,
    isTrailFinished: false,
    mode,
    modelModeType: '',
    promptMode,
    isAdvancedMode,
    isAgent,
    isOpenAI: false,
    isFunctionCall: false,
    collectionList: [],
    setPromptMode: noop,
    canReturnToSimpleMode: false,
    setCanReturnToSimpleMode: noop,
    chatPromptConfig,
    completionPromptConfig,
    currentAdvancedPrompt: '',
    setCurrentAdvancedPrompt: noop,
    conversationHistoriesRole: completionPromptConfig.conversation_histories_role,
    showHistoryModal: false,
    setConversationHistoriesRole: noop,
    hasSetBlockStatus: true,
    conversationId: '',
    introduction: '',
    setIntroduction: noop,
    suggestedQuestions,
    setSuggestedQuestions: noop,
    setConversationId: noop,
    controlClearChatMessage: false,
    setControlClearChatMessage: noop,
    prevPromptConfig: {},
    setPrevPromptConfig: noop,
    moreLikeThisConfig,
    setMoreLikeThisConfig: noop,
    suggestedQuestionsAfterAnswerConfig,
    setSuggestedQuestionsAfterAnswerConfig: noop,
    speechToTextConfig,
    setSpeechToTextConfig: noop,
    textToSpeechConfig,
    setTextToSpeechConfig: noop,
    citationConfig,
    setCitationConfig: noop,
    annotationConfig,
    setAnnotationConfig: noop,
    moderationConfig,
    setModerationConfig: noop,
    externalDataToolsConfig: {},
    setExternalDataToolsConfig: noop,
    formattingChanged: false,
    setFormattingChanged: noop,
    inputs,
    setInputs: noop,
    query,
    setQuery: noop,
    completionParams,
    setCompletionParams: noop,
    modelConfig,
    setModelConfig: noop,
    showSelectDataSet: noop,
    dataSets,
    setDataSets: noop,
    datasetConfigs: [],
    datasetConfigsRef: {},
    setDatasetConfigs: noop,
    hasSetContextVar: true,
    isShowVisionConfig,
    visionConfig,
    setVisionConfig: noop,
    isAllowVideoUpload,
    isShowDocumentConfig,
    isShowAudioConfig,
    rerankSettingModalOpen: false,
    setRerankSettingModalOpen: noop,
  }
  return (
    <ConfigContext.Provider value={value as any}>
      <FeaturesProvider features={featuresData}>
        <div className="flex size-full flex-col bg-components-panel-on-panel-item-bg">
          <div className="relative flex h-[200px] grow">
            <div className="flex size-full shrink-0 flex-col sm:w-1/2">
              <Config />
            </div>
            {!isMobile && (
              <div
                className="relative flex h-full w-1/2 grow flex-col overflow-y-auto"
                style={{ borderColor: 'rgba(0, 0, 0, 0.02)' }}
              >
                <div className="flex grow flex-col rounded-tl-2xl border-t-[0.5px] border-l-[0.5px] border-components-panel-border bg-chatbot-bg">
                  <Debug
                    isAPIKeySet
                    onSetting={noop}
                    inputs={inputs}
                    modelParameterParams={{
                      setModel: noop,
                      onCompletionParamsChange: noop,
                    }}
                    debugWithMultipleModel={false}
                    multipleModelConfigs={[]}
                    onMultipleModelConfigsChange={noop}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </FeaturesProvider>
    </ConfigContext.Provider>
  )
}
export default React.memo(BasicAppPreview)
