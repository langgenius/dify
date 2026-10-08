import type { DataSet } from '@/models/datasets'
import { zAppLegacyDatasetToolResponse } from '@dify/contracts/api/console/apps/zod.gen'
import { PromptMode } from '@/models/debug'
import { consoleClient } from '@/service/console'
import { fetchDatasets } from '@/service/datasets'
import { fetchCollectionList } from '@/service/tools'
import { AppModeEnum } from '@/types/app'
import { withCollectionIconBasePath } from '../../utils'
import { buildConfigurationDatasetConfigs } from './dataset'
import { normalizeChatPromptConfig, normalizeCompletionPromptConfig } from './prompt-config'
import { buildAnnotationDraft, buildPublishedConfig } from './published-config'

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
  const response = await consoleClient.apps.byAppId.get({ params: { app_id: appId } })
  const mode = response.mode
  if (
    mode !== AppModeEnum.CHAT &&
    mode !== AppModeEnum.AGENT_CHAT &&
    mode !== AppModeEnum.COMPLETION
  )
    throw new Error(`App mode ${mode} does not use model configuration`)
  const backendModelConfig = response.model_config
  if (!backendModelConfig) throw new Error(`App ${appId} has no model configuration`)
  const nextPromptMode =
    backendModelConfig.prompt_type === PromptMode.advanced ? PromptMode.advanced : PromptMode.simple
  let nextDataSets: DataSet[] = []
  const agentDatasets = (backendModelConfig.agent_mode.tools ?? []).flatMap((tool) => {
    const result = zAppLegacyDatasetToolResponse.safeParse(tool)
    return result.success ? [result.data.dataset] : []
  })
  const configuredDatasets = agentDatasets.some((dataset) => dataset.enabled)
    ? agentDatasets
    : (backendModelConfig.dataset_configs.datasets?.datasets ?? []).map((item) => item.dataset)
  const datasetIds = configuredDatasets.flatMap(({ id }) => (id ? [id] : []))

  if (datasetIds.length) {
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

  const publishedConfig = buildPublishedConfig({
    backendModelConfig,
    collectionList,
    datasetConfigs,
    deletedTools: response.deleted_tools,
    mode,
    nextDataSets,
  })

  return {
    annotationConfig: buildAnnotationDraft(backendModelConfig.annotation_reply),
    backendModelConfig,
    canReturnToSimpleMode: nextPromptMode !== PromptMode.advanced,
    collectionList,
    completionPromptConfig: normalizeCompletionPromptConfig(
      backendModelConfig.completion_prompt_config,
    ),
    datasetConfigs,
    externalDataToolsConfig: publishedConfig.externalDataToolsConfig,
    mode,
    moreLikeThisConfig: backendModelConfig.more_like_this || { enabled: false },
    nextDataSets,
    promptMode: nextPromptMode,
    publishedConfig,
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
