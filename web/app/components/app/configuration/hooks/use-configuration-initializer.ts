/* eslint-disable ts/no-explicit-any */
import type { Dispatch, SetStateAction } from 'react'
import type { PublishConfig } from '../types'
import type { Collection } from '@/app/components/tools/types'
import type { ExternalDataTool } from '@/models/common'
import type { DataSet } from '@/models/datasets'
import type {
  AnnotationReplyConfig,
  ChatPromptConfig,
  CompletionPromptConfig,
  DatasetConfigs,
  ModerationConfig,
  MoreLikeThisConfig,
  TextToSpeechConfig,
} from '@/models/debug'
import type { App, UserInputFormItem, VisionSettings } from '@/types/app'
import { clone } from 'es-toolkit/object'
import { useEffect } from 'react'
import { getMultipleRetrievalConfig } from '@/app/components/workflow/nodes/knowledge-retrieval/utils'
import { DEFAULT_AGENT_SETTING, DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import { PromptMode } from '@/models/debug'
import { fetchAppDetailDirect } from '@/service/apps'
import { fetchDatasets } from '@/service/datasets'
import { fetchCollectionList } from '@/service/tools'
import { AgentStrategy, AppModeEnum, RETRIEVE_TYPE } from '@/types/app'
import { correctModelProvider, correctToolProvider } from '@/utils'
import { userInputsFormToPromptVariables } from '@/utils/model-config'
import { basePath } from '@/utils/var'

type BackendModelConfig = App['model_config']

type InitializerDeps = {
  appId: string
  currentRerankProvider?: { provider?: string }
  currentRerankModel?: { model?: string }
  syncToPublishedConfig: (config: PublishConfig) => void
  setMode: (mode: AppModeEnum) => void
  setPromptMode: Dispatch<SetStateAction<PromptMode>>
  setChatPromptConfig: Dispatch<SetStateAction<ChatPromptConfig>>
  setCompletionPromptConfig: Dispatch<SetStateAction<CompletionPromptConfig>>
  setCanReturnToSimpleMode: (canReturn: boolean) => void
  setDataSets: (datasets: DataSet[]) => void
  setIntroduction: (value: string) => void
  setSuggestedQuestions: (value: string[]) => void
  setMoreLikeThisConfig: (value: MoreLikeThisConfig) => void
  setSuggestedQuestionsAfterAnswerConfig: (value: MoreLikeThisConfig) => void
  setSpeechToTextConfig: (value: MoreLikeThisConfig) => void
  setTextToSpeechConfig: (value: TextToSpeechConfig) => void
  setCitationConfig: (value: MoreLikeThisConfig) => void
  setAnnotationConfig: (config: AnnotationReplyConfig, notSetFormatChanged?: boolean) => void
  setModerationConfig: Dispatch<SetStateAction<ModerationConfig>>
  setExternalDataToolsConfig: (value: ExternalDataTool[]) => void
  handleSetVisionConfig: (config: VisionSettings, notNoticeFormattingChanged?: boolean) => void
  setPublishedConfig: (config: PublishConfig) => void
  setDatasetConfigs: (config: DatasetConfigs) => void
  setCollectionList: (collections: Collection[]) => void
  setHasFetchedDetail: (value: boolean) => void
}

export const useConfigurationInitializer = ({
  appId,
  currentRerankProvider,
  currentRerankModel,
  syncToPublishedConfig,
  setMode,
  setPromptMode,
  setChatPromptConfig,
  setCompletionPromptConfig,
  setCanReturnToSimpleMode,
  setDataSets,
  setIntroduction,
  setSuggestedQuestions,
  setMoreLikeThisConfig,
  setSuggestedQuestionsAfterAnswerConfig,
  setSpeechToTextConfig,
  setTextToSpeechConfig,
  setCitationConfig,
  setAnnotationConfig,
  setModerationConfig,
  setExternalDataToolsConfig,
  handleSetVisionConfig,
  setPublishedConfig,
  setDatasetConfigs,
  setCollectionList,
  setHasFetchedDetail,
}: InitializerDeps) => {
  useEffect(() => {
    let disposed = false

    const run = async () => {
      const fetchedCollectionList = await fetchCollectionList()
      if (basePath) {
        fetchedCollectionList.forEach((item) => {
          if (typeof item.icon === 'string' && !item.icon.includes(basePath))
            item.icon = `${basePath}${item.icon}`
        })
      }
      if (disposed)
        return

      setCollectionList(fetchedCollectionList)

      const res = await fetchAppDetailDirect({ url: '/apps', id: appId })
      if (disposed)
        return

      setMode(res.mode as AppModeEnum)
      const backendModelConfig = res.model_config as BackendModelConfig
      const nextPromptMode = backendModelConfig.prompt_type === PromptMode.advanced
        ? PromptMode.advanced
        : PromptMode.simple
      setPromptMode(nextPromptMode)

      if (nextPromptMode === PromptMode.advanced) {
        if (backendModelConfig.chat_prompt_config && backendModelConfig.chat_prompt_config.prompt.length > 0)
          setChatPromptConfig(backendModelConfig.chat_prompt_config)
        else
          setChatPromptConfig(clone(DEFAULT_CHAT_PROMPT_CONFIG))

        setCompletionPromptConfig(backendModelConfig.completion_prompt_config || clone(DEFAULT_COMPLETION_PROMPT_CONFIG))
        setCanReturnToSimpleMode(false)
      }

      const { model } = backendModelConfig
      let datasets: DataSet[] | null = null
      if (backendModelConfig.agent_mode?.tools?.find(({ dataset }: any) => dataset?.enabled))
        datasets = backendModelConfig.agent_mode.tools as any
      else if (backendModelConfig.dataset_configs.datasets?.datasets?.length)
        datasets = backendModelConfig.dataset_configs.datasets.datasets as any

      if (datasets?.length) {
        const { data: dataSetsWithDetail } = await fetchDatasets({
          url: '/datasets',
          params: { page: 1, ids: datasets.map(({ dataset }: any) => dataset.id) },
        })
        if (disposed)
          return
        datasets = dataSetsWithDetail
        setDataSets(datasets)
      }

      setIntroduction(backendModelConfig.opening_statement)
      setSuggestedQuestions(backendModelConfig.suggested_questions || [])

      if (backendModelConfig.more_like_this)
        setMoreLikeThisConfig(backendModelConfig.more_like_this)

      if (backendModelConfig.suggested_questions_after_answer)
        setSuggestedQuestionsAfterAnswerConfig(backendModelConfig.suggested_questions_after_answer)

      if (backendModelConfig.speech_to_text)
        setSpeechToTextConfig(backendModelConfig.speech_to_text)

      if (backendModelConfig.text_to_speech)
        setTextToSpeechConfig(backendModelConfig.text_to_speech)

      if (backendModelConfig.retriever_resource)
        setCitationConfig(backendModelConfig.retriever_resource)

      if (backendModelConfig.annotation_reply) {
        let annotationConfig = backendModelConfig.annotation_reply
        if (backendModelConfig.annotation_reply.enabled) {
          annotationConfig = {
            ...backendModelConfig.annotation_reply,
            embedding_model: {
              ...backendModelConfig.annotation_reply.embedding_model,
              embedding_provider_name: correctModelProvider(backendModelConfig.annotation_reply.embedding_model.embedding_provider_name),
            },
          }
        }
        setAnnotationConfig(annotationConfig as any, true)
      }

      if (backendModelConfig.sensitive_word_avoidance)
        setModerationConfig(backendModelConfig.sensitive_word_avoidance)

      if (backendModelConfig.external_data_tools)
        setExternalDataToolsConfig(backendModelConfig.external_data_tools)

      const publishedConfig: PublishConfig = {
        modelConfig: {
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
                    ? backendModelConfig.external_data_tools.map((item: any) => ({
                        external_data_tool: {
                          variable: item.variable as string,
                          label: item.label as string,
                          enabled: item.enabled,
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
          dataSets: datasets || [],
          agentConfig: res.mode === AppModeEnum.AGENT_CHAT
            ? {
                max_iteration: DEFAULT_AGENT_SETTING.max_iteration,
                ...backendModelConfig.agent_mode,
                enabled: true,
                tools: (backendModelConfig.agent_mode?.tools ?? []).filter((tool: any) => !tool.dataset).map((tool: any) => {
                  const toolInCollectionList = fetchedCollectionList.find(c => tool.provider_id === c.id)
                  return {
                    ...tool,
                    isDeleted: res.deleted_tools?.some((deletedTool: any) =>
                      deletedTool.provider_id === tool.provider_id && deletedTool.tool_name === tool.tool_name) ?? false,
                    notAuthor: toolInCollectionList?.is_team_authorization === false,
                    ...(tool.provider_type === 'builtin'
                      ? {
                          provider_id: correctToolProvider(tool.provider_name, !!toolInCollectionList),
                          provider_name: correctToolProvider(tool.provider_name, !!toolInCollectionList),
                        }
                      : {}),
                  }
                }),
                strategy: backendModelConfig.agent_mode?.strategy ?? AgentStrategy.react,
              }
            : DEFAULT_AGENT_SETTING,
        },
        completionParams: model.completion_params,
      }

      if (backendModelConfig.file_upload)
        handleSetVisionConfig(backendModelConfig.file_upload.image, true)

      syncToPublishedConfig(publishedConfig)
      setPublishedConfig(publishedConfig)

      const retrievalConfig = getMultipleRetrievalConfig({
        ...backendModelConfig.dataset_configs,
        reranking_model: backendModelConfig.dataset_configs.reranking_model && {
          provider: backendModelConfig.dataset_configs.reranking_model.reranking_provider_name,
          model: backendModelConfig.dataset_configs.reranking_model.reranking_model_name,
        },
      }, datasets ?? [], datasets ?? [], {
        provider: currentRerankProvider?.provider,
        model: currentRerankModel?.model,
      })

      const datasetConfigsToSet = {
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

      datasetConfigsToSet.retrieval_model = datasetConfigsToSet.retrieval_model ?? RETRIEVE_TYPE.multiWay
      setDatasetConfigs(datasetConfigsToSet)
      setHasFetchedDetail(true)
    }

    run().catch(() => {
      if (!disposed)
        setHasFetchedDetail(true)
    })

    return () => {
      disposed = true
    }
  }, [
    appId,
    currentRerankModel?.model,
    currentRerankProvider?.provider,
    handleSetVisionConfig,
    setAnnotationConfig,
    setCanReturnToSimpleMode,
    setChatPromptConfig,
    setCitationConfig,
    setCollectionList,
    setCompletionPromptConfig,
    setDataSets,
    setDatasetConfigs,
    setExternalDataToolsConfig,
    setHasFetchedDetail,
    setIntroduction,
    setMode,
    setModerationConfig,
    setMoreLikeThisConfig,
    setPromptMode,
    setPublishedConfig,
    setSpeechToTextConfig,
    setSuggestedQuestions,
    setSuggestedQuestionsAfterAnswerConfig,
    setTextToSpeechConfig,
    syncToPublishedConfig,
  ])
}
