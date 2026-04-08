import type { Features as FeaturesData } from '@/app/components/base/features/types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Collection } from '@/app/components/tools/types'
import type { DataSet } from '@/models/datasets'
import type { AnnotationReplyConfig, DatasetConfigs, ModelConfig, PromptVariable } from '@/models/debug'
import type { ModelConfig as BackendModelConfig, UserInputFormItem, VisionSettings } from '@/types/app'
import { clone } from 'es-toolkit/object'
import { produce } from 'immer'
import { toast } from '@/app/components/base/ui/toast'
import { getMultipleRetrievalConfig, getSelectedDatasetsMode } from '@/app/components/workflow/nodes/knowledge-retrieval/utils'
import { DEFAULT_AGENT_SETTING, DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import { PromptMode } from '@/models/debug'
import { fetchAppDetailDirect } from '@/service/apps'
import { fetchDatasets } from '@/service/datasets'
import { fetchCollectionList } from '@/service/tools'
import { AgentStrategy, AppModeEnum, ModelModeType, RETRIEVE_TYPE } from '@/types/app'
import {
  correctModelProvider,
  correctToolProvider,
} from '@/utils'
import { fetchAndMergeValidCompletionParams } from '@/utils/completion-params'
import { promptVariablesToUserInputsForm, userInputsFormToPromptVariables } from '@/utils/model-config'
import { withCollectionIconBasePath } from '../utils'

type BackendAgentTool = ModelConfig['agentConfig']['tools'][number] & {
  dataset?: {
    enabled: boolean
    id: string
  }
  provider_id: string
  provider_name: string
  provider_type: string
  tool_name: string
}

type DeletedTool = {
  id?: string
  provider_id?: string
  tool_name: string
}

const buildPublishedModelConfig = ({
  backendModelConfig,
  collectionList,
  deletedTools,
  mode,
  nextDataSets,
}: {
  backendModelConfig: BackendModelConfig
  collectionList: Collection[]
  deletedTools?: DeletedTool[]
  mode: AppModeEnum
  nextDataSets: DataSet[]
}): ModelConfig => {
  const model = backendModelConfig.model
  const agentModeTools = (backendModelConfig.agent_mode?.tools ?? []) as BackendAgentTool[]

  return {
    provider: correctModelProvider(model.provider),
    model_id: model.name,
    mode: model.mode,
    configs: {
      prompt_template: backendModelConfig.pre_prompt || '',
      prompt_variables: userInputsFormToPromptVariables(
        ([
          ...backendModelConfig.user_input_form,
          ...(
            backendModelConfig.external_data_tools?.length
              ? backendModelConfig.external_data_tools.map(item => ({
                  external_data_tool: {
                    variable: item.variable as string,
                    label: item.label as string,
                    enabled: !!item.enabled,
                    type: item.type as string,
                    config: item.config,
                    required: true,
                    icon: item.icon,
                    icon_background: item.icon_background,
                  },
                }))
              : []
          ),
        ]) as unknown as UserInputFormItem[],
        backendModelConfig.dataset_query_variable,
      ),
    },
    more_like_this: backendModelConfig.more_like_this ?? { enabled: false },
    opening_statement: backendModelConfig.opening_statement,
    suggested_questions: backendModelConfig.suggested_questions ?? [],
    sensitive_word_avoidance: backendModelConfig.sensitive_word_avoidance,
    speech_to_text: backendModelConfig.speech_to_text,
    text_to_speech: backendModelConfig.text_to_speech,
    file_upload: backendModelConfig.file_upload ?? null,
    suggested_questions_after_answer: backendModelConfig.suggested_questions_after_answer ?? { enabled: false },
    retriever_resource: backendModelConfig.retriever_resource,
    annotation_reply: backendModelConfig.annotation_reply ?? null,
    external_data_tools: backendModelConfig.external_data_tools ?? [],
    system_parameters: backendModelConfig.system_parameters,
    dataSets: nextDataSets,
    agentConfig: mode === AppModeEnum.AGENT_CHAT
      ? {
          max_iteration: DEFAULT_AGENT_SETTING.max_iteration,
          ...backendModelConfig.agent_mode,
          enabled: true,
          tools: agentModeTools.filter(tool => !tool.dataset).map((tool) => {
            const toolInCollectionList = collectionList.find(collection => collection.id === tool.provider_id)
            return {
              ...tool,
              isDeleted: deletedTools?.some(deletedTool => (deletedTool.provider_id || deletedTool.id) === tool.provider_id && deletedTool.tool_name === tool.tool_name) ?? false,
              notAuthor: toolInCollectionList?.is_team_authorization === false,
              ...(tool.provider_type === 'builtin'
                ? {
                    provider_id: correctToolProvider(tool.provider_name, !!toolInCollectionList),
                    provider_name: correctToolProvider(tool.provider_name, !!toolInCollectionList),
                  }
                : {}),
            }
          }) as ModelConfig['agentConfig']['tools'],
          strategy: backendModelConfig.agent_mode?.strategy ?? AgentStrategy.react,
        }
      : DEFAULT_AGENT_SETTING,
  }
}

export const buildPublishedConfig = ({
  backendModelConfig,
  collectionList,
  deletedTools,
  mode,
  nextDataSets,
}: {
  backendModelConfig: BackendModelConfig
  collectionList: Collection[]
  deletedTools?: DeletedTool[]
  mode: AppModeEnum
  nextDataSets: DataSet[]
}) => ({
  modelConfig: buildPublishedModelConfig({
    backendModelConfig,
    collectionList,
    deletedTools,
    mode,
    nextDataSets,
  }),
  completionParams: backendModelConfig.model.completion_params,
})

export const buildConfigurationDatasetConfigs = ({
  backendModelConfig,
  currentRerankModel,
  currentRerankProvider,
  nextDataSets,
}: {
  backendModelConfig: BackendModelConfig
  currentRerankModel?: string
  currentRerankProvider?: string
  nextDataSets: DataSet[]
}): DatasetConfigs => {
  const retrievalConfig = getMultipleRetrievalConfig({
    ...backendModelConfig.dataset_configs,
    reranking_model: backendModelConfig.dataset_configs.reranking_model && {
      provider: backendModelConfig.dataset_configs.reranking_model.reranking_provider_name,
      model: backendModelConfig.dataset_configs.reranking_model.reranking_model_name,
    },
  }, nextDataSets, nextDataSets, {
    provider: currentRerankProvider,
    model: currentRerankModel,
  })

  const nextDatasetConfigs = {
    ...backendModelConfig.dataset_configs,
    ...retrievalConfig,
    ...(retrievalConfig.reranking_model
      ? {
          reranking_model: {
            reranking_model_name: retrievalConfig.reranking_model.model,
            reranking_provider_name: correctModelProvider(retrievalConfig.reranking_model.provider),
          },
        }
      : {}),
  } as DatasetConfigs

  nextDatasetConfigs.retrieval_model = nextDatasetConfigs.retrieval_model ?? RETRIEVE_TYPE.multiWay

  return nextDatasetConfigs
}

export const buildPublishBody = ({
  chatPromptConfig,
  completionParams,
  completionPromptConfig,
  contextVar,
  dataSets,
  datasetConfigs,
  externalDataToolsConfig,
  features,
  isAdvancedMode,
  isFunctionCall,
  modelConfig,
  modelId,
  modelProvider,
  promptMode,
  promptVariables,
  promptTemplate,
  resolvedModelModeType,
}: {
  chatPromptConfig: BackendModelConfig['chat_prompt_config']
  completionParams: FormValue
  completionPromptConfig: BackendModelConfig['completion_prompt_config']
  contextVar?: string
  dataSets: DataSet[]
  datasetConfigs: DatasetConfigs
  externalDataToolsConfig: BackendModelConfig['external_data_tools']
  features?: FeaturesData
  isAdvancedMode: boolean
  isFunctionCall: boolean
  modelConfig: ModelConfig
  modelId: string
  modelProvider: string
  promptMode: BackendModelConfig['prompt_type']
  promptVariables: PromptVariable[]
  promptTemplate: string
  resolvedModelModeType: BackendModelConfig['model']['mode']
}): BackendModelConfig => {
  const postDatasets = dataSets.map(({ id }) => ({
    dataset: {
      enabled: true,
      id,
    },
  }))

  const fileUpload = { ...features?.file }
  delete fileUpload?.fileUploadConfig

  return {
    pre_prompt: !isAdvancedMode ? promptTemplate : '',
    prompt_type: promptMode,
    chat_prompt_config: isAdvancedMode ? chatPromptConfig : clone(DEFAULT_CHAT_PROMPT_CONFIG),
    completion_prompt_config: isAdvancedMode ? completionPromptConfig : clone(DEFAULT_COMPLETION_PROMPT_CONFIG),
    user_input_form: promptVariablesToUserInputsForm(promptVariables),
    dataset_query_variable: contextVar || '',
    more_like_this: features?.moreLikeThis as never,
    opening_statement: features?.opening?.enabled ? (features.opening?.opening_statement || '') : '',
    suggested_questions: features?.opening?.enabled ? (features.opening?.suggested_questions || []) : [],
    sensitive_word_avoidance: features?.moderation as never,
    speech_to_text: features?.speech2text as never,
    text_to_speech: features?.text2speech as never,
    file_upload: fileUpload as never,
    suggested_questions_after_answer: features?.suggested as never,
    retriever_resource: features?.citation as never,
    agent_mode: {
      ...modelConfig.agentConfig,
      strategy: isFunctionCall ? AgentStrategy.functionCall : AgentStrategy.react,
    },
    external_data_tools: externalDataToolsConfig,
    model: {
      provider: modelProvider,
      name: modelId,
      mode: resolvedModelModeType,
      completion_params: completionParams as BackendModelConfig['model']['completion_params'],
    },
    dataset_configs: {
      ...datasetConfigs,
      datasets: {
        datasets: [...postDatasets],
      } as never,
    },
    system_parameters: modelConfig.system_parameters,
  }
}

const normalizeAnnotationConfig = (annotationReply?: BackendModelConfig['annotation_reply']) => {
  if (!annotationReply)
    return undefined

  if (!annotationReply.enabled)
    return annotationReply as AnnotationReplyConfig

  return {
    ...annotationReply,
    embedding_model: {
      ...annotationReply.embedding_model,
      embedding_provider_name: correctModelProvider(annotationReply.embedding_model.embedding_provider_name),
    },
  } as AnnotationReplyConfig
}

export const loadConfigurationState = async ({
  appId,
  basePath,
  currentRerankModel,
  currentRerankProvider,
}: {
  appId: string
  basePath?: string
  currentRerankModel?: string
  currentRerankProvider?: string
}) => {
  const collectionList = withCollectionIconBasePath(await fetchCollectionList(), basePath)
  const response = await fetchAppDetailDirect({ url: '/apps', id: appId })
  const backendModelConfig = response.model_config as BackendModelConfig
  const nextPromptMode = backendModelConfig.prompt_type === PromptMode.advanced ? PromptMode.advanced : PromptMode.simple

  let nextDataSets: DataSet[] = []
  const agentModeTools = (backendModelConfig.agent_mode?.tools ?? []) as Array<{ dataset?: { enabled: boolean, id: string } }>

  if (agentModeTools.find(tool => tool.dataset?.enabled))
    nextDataSets = agentModeTools as unknown as DataSet[]
  else if (backendModelConfig.dataset_configs.datasets?.datasets?.length)
    nextDataSets = backendModelConfig.dataset_configs.datasets.datasets as unknown as DataSet[]

  if (nextDataSets.length) {
    const datasetIds = (nextDataSets as Array<DataSet & { dataset?: { id: string } }>)
      .map(item => item.dataset?.id || item.id)
      .filter((id): id is string => Boolean(id))

    const { data } = await fetchDatasets({
      url: '/datasets',
      params: {
        page: 1,
        ids: datasetIds,
      },
    })
    nextDataSets = data
  }

  return {
    annotationConfig: normalizeAnnotationConfig(backendModelConfig.annotation_reply),
    backendModelConfig,
    canReturnToSimpleMode: nextPromptMode !== PromptMode.advanced,
    collectionList,
    completionPromptConfig: backendModelConfig.completion_prompt_config || clone(DEFAULT_COMPLETION_PROMPT_CONFIG),
    datasetConfigs: buildConfigurationDatasetConfigs({
      backendModelConfig,
      currentRerankModel,
      currentRerankProvider,
      nextDataSets,
    }),
    externalDataToolsConfig: backendModelConfig.external_data_tools ?? [],
    mode: response.mode as AppModeEnum,
    moreLikeThisConfig: backendModelConfig.more_like_this || { enabled: false },
    nextDataSets,
    promptMode: nextPromptMode,
    publishedConfig: buildPublishedConfig({
      backendModelConfig,
      collectionList,
      deletedTools: response.deleted_tools,
      mode: response.mode as AppModeEnum,
      nextDataSets,
    }),
    response,
    speechToTextConfig: backendModelConfig.speech_to_text || { enabled: false },
    suggestedQuestions: backendModelConfig.suggested_questions || [],
    suggestedQuestionsAfterAnswerConfig: backendModelConfig.suggested_questions_after_answer || { enabled: false },
    textToSpeechConfig: backendModelConfig.text_to_speech || {
      enabled: false,
      voice: '',
      language: '',
    },
    visionConfig: backendModelConfig.file_upload?.image,
    citationConfig: backendModelConfig.retriever_resource || { enabled: false },
    chatPromptConfig: backendModelConfig.chat_prompt_config && backendModelConfig.chat_prompt_config.prompt?.length > 0
      ? backendModelConfig.chat_prompt_config
      : clone(DEFAULT_CHAT_PROMPT_CONFIG),
    introduction: backendModelConfig.opening_statement,
    moderationConfig: backendModelConfig.sensitive_word_avoidance,
  }
}

export const createDatasetSelectHandler = ({
  currentRerankModel,
  currentRerankProvider,
  dataSets,
  datasetConfigs,
  datasetConfigsRef,
  formattingChangedDispatcher,
  hideSelectDataSet,
  setDataSets,
  setDatasetConfigs,
  setRerankSettingModalOpen,
}: {
  currentRerankModel?: string
  currentRerankProvider?: string
  dataSets: DataSet[]
  datasetConfigs: DatasetConfigs
  datasetConfigsRef: { current: DatasetConfigs }
  formattingChangedDispatcher: () => void
  hideSelectDataSet: () => void
  setDataSets: (data: DataSet[]) => void
  setDatasetConfigs: (configs: DatasetConfigs) => void
  setRerankSettingModalOpen: (visible: boolean) => void
}) => (nextDataSets: DataSet[]) => {
  if (nextDataSets.map(item => item.id).join(',') === dataSets.map(item => item.id).join(',')) {
    hideSelectDataSet()
    return
  }

  formattingChangedDispatcher()
  let mergedDataSets = nextDataSets

  if (nextDataSets.find(item => !item.name)) {
    const hydrated = produce(nextDataSets, (draft) => {
      nextDataSets.forEach((item, index) => {
        if (!item.name) {
          const originalItem = dataSets.find(existing => existing.id === item.id)
          if (originalItem)
            draft[index] = originalItem
        }
      })
    })
    setDataSets(hydrated)
    mergedDataSets = hydrated
  }
  else {
    setDataSets(nextDataSets)
  }

  hideSelectDataSet()
  const {
    allExternal,
    allInternal,
    mixtureInternalAndExternal,
    mixtureHighQualityAndEconomic,
    inconsistentEmbeddingModel,
  } = getSelectedDatasetsMode(mergedDataSets)

  if (
    (allInternal && (mixtureHighQualityAndEconomic || inconsistentEmbeddingModel))
    || mixtureInternalAndExternal
    || allExternal
  ) {
    setRerankSettingModalOpen(true)
  }

  const { datasets, retrieval_model, score_threshold_enabled, ...restConfigs } = datasetConfigs
  const {
    top_k,
    score_threshold,
    reranking_model,
    reranking_mode,
    weights,
    reranking_enable,
  } = restConfigs

  const oldRetrievalConfig = {
    top_k,
    score_threshold,
    reranking_model: (reranking_model?.reranking_provider_name && reranking_model?.reranking_model_name)
      ? {
          provider: reranking_model.reranking_provider_name,
          model: reranking_model.reranking_model_name,
        }
      : undefined,
    reranking_mode,
    weights,
    reranking_enable,
  }

  const retrievalConfig = getMultipleRetrievalConfig(oldRetrievalConfig, mergedDataSets, dataSets, {
    provider: currentRerankProvider,
    model: currentRerankModel,
  })

  setDatasetConfigs({
    ...datasetConfigsRef.current,
    ...retrievalConfig,
    reranking_model: {
      reranking_provider_name: retrievalConfig?.reranking_model?.provider || '',
      reranking_model_name: retrievalConfig?.reranking_model?.model || '',
    },
    retrieval_model,
    score_threshold_enabled,
    datasets,
  })
}

export const createPublishHandler = ({
  appId,
  chatPromptConfig,
  citationConfig,
  completionParamsState,
  completionPromptConfig,
  contextVar,
  contextVarEmpty,
  dataSets,
  datasetConfigs,
  externalDataToolsConfig,
  hasSetBlockStatus,
  introduction,
  isAdvancedMode,
  isFunctionCall,
  mode,
  modelConfig,
  moreLikeThisConfig,
  promptEmpty,
  promptMode,
  resolvedModelModeType,
  setCanReturnToSimpleMode,
  setPublishedConfig,
  speechToTextConfig,
  suggestedQuestionsAfterAnswerConfig,
  t,
  textToSpeechConfig,
}: {
  appId: string
  chatPromptConfig: BackendModelConfig['chat_prompt_config']
  citationConfig: ModelConfig['retriever_resource']
  completionParamsState: FormValue
  completionPromptConfig: BackendModelConfig['completion_prompt_config']
  contextVar?: string
  contextVarEmpty: boolean
  dataSets: DataSet[]
  datasetConfigs: DatasetConfigs
  externalDataToolsConfig: BackendModelConfig['external_data_tools']
  hasSetBlockStatus: { history: boolean, query: boolean }
  introduction: string
  isAdvancedMode: boolean
  isFunctionCall: boolean
  mode: AppModeEnum
  modelConfig: ModelConfig
  moreLikeThisConfig: ModelConfig['more_like_this']
  promptEmpty: boolean
  promptMode: BackendModelConfig['prompt_type']
  resolvedModelModeType: ModelModeType
  setCanReturnToSimpleMode: (value: boolean) => void
  setPublishedConfig: (config: { modelConfig: ModelConfig, completionParams: FormValue }) => void
  speechToTextConfig: ModelConfig['speech_to_text']
  suggestedQuestionsAfterAnswerConfig: ModelConfig['suggested_questions_after_answer']
  t: (key: string, options?: Record<string, unknown>) => string
  textToSpeechConfig: ModelConfig['text_to_speech']
}) => async (
  updateAppModelConfig: (params: { url: string, body: BackendModelConfig }) => Promise<unknown>,
  modelAndParameter?: { model: string, provider: string, parameters: FormValue },
  features?: FeaturesData,
) => {
  const modelId = modelAndParameter?.model || modelConfig.model_id
  const promptTemplate = modelConfig.configs.prompt_template
  const promptVariables = modelConfig.configs.prompt_variables

  if (promptEmpty) {
    toast.error(t('otherError.promptNoBeEmpty', { ns: 'appDebug' }))
    return
  }

  if (isAdvancedMode && mode !== AppModeEnum.COMPLETION && resolvedModelModeType === ModelModeType.completion) {
    if (!hasSetBlockStatus.history) {
      toast.error(t('otherError.historyNoBeEmpty', { ns: 'appDebug' }))
      return
    }

    if (!hasSetBlockStatus.query) {
      toast.error(t('otherError.queryNoBeEmpty', { ns: 'appDebug' }))
      return
    }
  }

  if (contextVarEmpty) {
    toast.error(t('feature.dataSet.queryVariable.contextVarNotEmpty', { ns: 'appDebug' }))
    return
  }

  const body = buildPublishBody({
    chatPromptConfig,
    completionParams: modelAndParameter?.parameters || completionParamsState,
    completionPromptConfig,
    contextVar,
    dataSets,
    datasetConfigs,
    externalDataToolsConfig,
    features,
    isAdvancedMode,
    isFunctionCall,
    modelConfig,
    modelId,
    modelProvider: modelAndParameter?.provider || modelConfig.provider,
    promptMode,
    promptTemplate,
    promptVariables,
    resolvedModelModeType,
  })

  await updateAppModelConfig({ url: `/apps/${appId}/model-config`, body })

  const nextModelConfig = produce(modelConfig, (draft: ModelConfig) => {
    draft.opening_statement = introduction
    draft.more_like_this = moreLikeThisConfig
    draft.suggested_questions_after_answer = suggestedQuestionsAfterAnswerConfig
    draft.speech_to_text = speechToTextConfig
    draft.text_to_speech = textToSpeechConfig
    draft.retriever_resource = citationConfig
    draft.dataSets = dataSets
  })

  setPublishedConfig({
    modelConfig: nextModelConfig,
    completionParams: completionParamsState,
  })
  toast.success(t('api.success', { ns: 'common' }))
  setCanReturnToSimpleMode(false)
  return true
}

export const createModelChangeHandler = ({
  chatPromptLength,
  completionParamsState,
  completionPromptConfig,
  handleSetVisionConfig,
  isAdvancedMode,
  migrateToDefaultPrompt,
  mode,
  modelConfig,
  resolvedModelModeType,
  setCompletionParams,
  setModelConfig,
  t,
  visionConfig,
}: {
  chatPromptLength: number
  completionParamsState: FormValue
  completionPromptConfig: {
    conversation_histories_role: {
      assistant_prefix: string
      user_prefix: string
    }
    prompt?: {
      text?: string
    }
  }
  handleSetVisionConfig: (config: VisionSettings, notNoticeFormattingChanged?: boolean) => void
  isAdvancedMode: boolean
  migrateToDefaultPrompt: (force?: boolean, modelModeType?: ModelModeType) => Promise<void>
  mode: AppModeEnum
  modelConfig: ModelConfig
  resolvedModelModeType: ModelModeType
  setCompletionParams: (value: FormValue) => void
  setModelConfig: (config: ModelConfig) => void
  t: (key: string, options?: Record<string, unknown>) => string
  visionConfig: VisionSettings
}) => async ({
  features = [],
  mode: nextModelMode = resolvedModelModeType,
  modelId,
  provider,
}: { modelId: string, provider: string, mode?: string, features?: string[] }) => {
  if (isAdvancedMode) {
    if (nextModelMode === ModelModeType.completion) {
      if (mode !== AppModeEnum.COMPLETION) {
        if (!completionPromptConfig.prompt?.text || !completionPromptConfig.conversation_histories_role.assistant_prefix || !completionPromptConfig.conversation_histories_role.user_prefix)
          await migrateToDefaultPrompt(true, ModelModeType.completion)
      }
      else if (!completionPromptConfig.prompt?.text) {
        await migrateToDefaultPrompt(true, ModelModeType.completion)
      }
    }

    if (nextModelMode === ModelModeType.chat && chatPromptLength === 0)
      await migrateToDefaultPrompt(true, ModelModeType.chat)
  }

  setModelConfig(produce(modelConfig, (draft: ModelConfig) => {
    draft.provider = provider
    draft.model_id = modelId
    draft.mode = nextModelMode as ModelModeType
  }))

  handleSetVisionConfig({
    ...visionConfig,
    enabled: !!features?.includes('vision'),
  }, true)

  try {
    const { params: filtered, removedDetails } = await fetchAndMergeValidCompletionParams(
      provider,
      modelId,
      completionParamsState,
      isAdvancedMode,
    )

    if (Object.keys(removedDetails).length)
      toast.warning(`${t('modelProvider.parametersInvalidRemoved', { ns: 'common' })}: ${Object.entries(removedDetails).map(([key, reason]) => `${key} (${reason})`).join(', ')}`)

    setCompletionParams(filtered)
  }
  catch {
    toast.error(t('error', { ns: 'common' }))
    setCompletionParams({})
  }
}
