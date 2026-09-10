import type { DataSet } from '@/models/datasets'
import type { AnnotationReplyConfig } from '@/models/debug'
import type { AppModeEnum, ModelConfig as BackendModelConfig } from '@/types/app'
import { PromptMode } from '@/models/debug'
import { fetchAppDetailDirect } from '@/service/apps'
import { fetchDatasets } from '@/service/datasets'
import { fetchCollectionList } from '@/service/tools'
import { correctModelProvider } from '@/utils'
import { withCollectionIconBasePath } from '../../utils'
import { buildConfigurationDatasetConfigs } from './dataset'
import { normalizeChatPromptConfig, normalizeCompletionPromptConfig } from './prompt-config'
import { buildPublishedConfig } from './published-config'

function normalizeAnnotationConfig(annotationReply?: BackendModelConfig['annotation_reply']) {
  if (!annotationReply) return undefined
  if (!annotationReply.enabled) return annotationReply as AnnotationReplyConfig

  return {
    ...annotationReply,
    embedding_model: {
      ...annotationReply.embedding_model,
      embedding_provider_name: correctModelProvider(
        annotationReply.embedding_model.embedding_provider_name,
      ),
    },
  } as AnnotationReplyConfig
}

export async function loadConfigurationState({
  appId,
  basePath,
  currentRerankModel,
  currentRerankProvider,
}: {
  appId: string
  basePath?: string
  currentRerankModel?: string
  currentRerankProvider?: string
}) {
  const collectionList = withCollectionIconBasePath(await fetchCollectionList(), basePath)
  const response = await fetchAppDetailDirect({ url: '/apps', id: appId })
  const backendModelConfig = response.model_config as BackendModelConfig
  const nextPromptMode =
    backendModelConfig.prompt_type === PromptMode.advanced ? PromptMode.advanced : PromptMode.simple
  let nextDataSets: DataSet[] = []
  const agentModeTools = (backendModelConfig.agent_mode?.tools ?? []) as Array<{
    dataset?: { enabled: boolean; id: string }
  }>

  if (agentModeTools.find((tool) => tool.dataset?.enabled))
    nextDataSets = agentModeTools as unknown as DataSet[]
  else if (backendModelConfig.dataset_configs.datasets?.datasets?.length)
    nextDataSets = backendModelConfig.dataset_configs.datasets.datasets as unknown as DataSet[]

  if (nextDataSets.length) {
    const datasetIds = (nextDataSets as Array<DataSet & { dataset?: { id: string } }>)
      .map((item) => item.dataset?.id || item.id)
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

  const datasetConfigs = buildConfigurationDatasetConfigs({
    backendModelConfig,
    currentRerankModel,
    currentRerankProvider,
    nextDataSets,
  })

  return {
    annotationConfig: normalizeAnnotationConfig(backendModelConfig.annotation_reply),
    backendModelConfig,
    canReturnToSimpleMode: nextPromptMode !== PromptMode.advanced,
    collectionList,
    completionPromptConfig: normalizeCompletionPromptConfig(
      backendModelConfig.completion_prompt_config,
    ),
    datasetConfigs,
    externalDataToolsConfig: backendModelConfig.external_data_tools ?? [],
    mode: response.mode as AppModeEnum,
    moreLikeThisConfig: backendModelConfig.more_like_this || { enabled: false },
    nextDataSets,
    promptMode: nextPromptMode,
    publishedConfig: buildPublishedConfig({
      backendModelConfig,
      collectionList,
      datasetConfigs,
      deletedTools: response.deleted_tools,
      mode: response.mode as AppModeEnum,
      nextDataSets,
    }),
    response,
    speechToTextConfig: backendModelConfig.speech_to_text || { enabled: false },
    suggestedQuestions: backendModelConfig.suggested_questions || [],
    suggestedQuestionsAfterAnswerConfig: backendModelConfig.suggested_questions_after_answer || {
      enabled: false,
    },
    textToSpeechConfig: backendModelConfig.text_to_speech || {
      enabled: false,
      voice: '',
      language: '',
    },
    visionConfig: backendModelConfig.file_upload?.image,
    citationConfig: backendModelConfig.retriever_resource || { enabled: false },
    chatPromptConfig: normalizeChatPromptConfig(backendModelConfig.chat_prompt_config),
    introduction: backendModelConfig.opening_statement,
    moderationConfig: backendModelConfig.sensitive_word_avoidance,
  }
}
