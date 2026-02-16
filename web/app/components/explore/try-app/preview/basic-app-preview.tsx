/* eslint-disable ts/no-explicit-any */
'use client'
import type { FC } from 'react'
import type { Features as FeaturesData, FileUpload } from '@/app/components/base/features/types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ModelConfig } from '@/models/debug'
import type { ModelConfig as BackendModelConfig, PromptVariable } from '@/types/app'
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
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { ANNOTATION_DEFAULT, DEFAULT_AGENT_SETTING, DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import ConfigContext from '@/context/debug-configuration'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { PromptMode } from '@/models/debug'
import { useAllToolProviders } from '@/service/use-tools'
import { useGetTryAppDataSets, useGetTryAppInfo } from '@/service/use-try-app'
import { ModelModeType, Resolution, TransferMethod } from '@/types/app'
import { correctModelProvider, correctToolProvider } from '@/utils'
import { userInputsFormToPromptVariables } from '@/utils/model-config'
import { basePath } from '@/utils/var'
import { useTextGenerationCurrentProviderAndModelAndModelList } from '../../../header/account-setting/model-provider-page/hooks'

type Props = {
  appId: string
}

const defaultModelConfig = {
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
  dataSets: [],
  agentConfig: DEFAULT_AGENT_SETTING,
}
const BasicAppPreview: FC<Props> = ({
  appId,
}) => {
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const { data: appDetail, isLoading: isLoadingAppDetail } = useGetTryAppInfo(appId)
  const { data: collectionListFromServer, isLoading: isLoadingToolProviders } = useAllToolProviders()
  const collectionList = collectionListFromServer?.map((item) => {
    return {
      ...item,
      icon: basePath && typeof item.icon == 'string' && !item.icon.includes(basePath) ? `${basePath}${item.icon}` : item.icon,
    }
  })
  const datasetIds = (() => {
    if (isLoadingAppDetail)
      return []
    const modelConfig = appDetail?.model_config
    if (!modelConfig)
      return []
    let datasets: any = null

    if (modelConfig.agent_mode?.tools?.find(({ dataset }: any) => dataset?.enabled))
      datasets = modelConfig.agent_mode?.tools.filter(({ dataset }: any) => dataset?.enabled)
    // new dataset struct
    else if (modelConfig.dataset_configs.datasets?.datasets?.length > 0)
      datasets = modelConfig.dataset_configs?.datasets?.datasets

    if (datasets?.length && datasets?.length > 0)
      return datasets.map(({ dataset }: any) => dataset.id)

    return []
  })()
  const { data: dataSetData, isLoading: isLoadingDatasets } = useGetTryAppDataSets(appId, datasetIds)
  const dataSets = dataSetData?.data || []
  const isLoading = isLoadingAppDetail || isLoadingDatasets || isLoadingToolProviders

  const modelConfig: ModelConfig = ((modelConfig?: BackendModelConfig) => {
    if (isLoading || !modelConfig)
      return defaultModelConfig

    const model = modelConfig.model

    const newModelConfig = {
      provider: correctModelProvider(model.provider),
      model_id: model.name,
      mode: model.mode,
      configs: {
        prompt_template: modelConfig.pre_prompt || '',
        prompt_variables: userInputsFormToPromptVariables(
          [
            ...(modelConfig.user_input_form as any),
            ...(
              modelConfig.external_data_tools?.length
                ? modelConfig.external_data_tools.map((item) => {
                    return {
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
                    }
                  })
                : []
            ),
          ],
          modelConfig.dataset_query_variable,
        ),
      },
      more_like_this: modelConfig.more_like_this,
      opening_statement: modelConfig.opening_statement,
      suggested_questions: modelConfig.suggested_questions,
      sensitive_word_avoidance: modelConfig.sensitive_word_avoidance,
      speech_to_text: modelConfig.speech_to_text,
      text_to_speech: modelConfig.text_to_speech,
      file_upload: modelConfig.file_upload,
      suggested_questions_after_answer: modelConfig.suggested_questions_after_answer,
      retriever_resource: modelConfig.retriever_resource,
      annotation_reply: modelConfig.annotation_reply,
      external_data_tools: modelConfig.external_data_tools,
      dataSets,
      agentConfig: appDetail?.mode === 'agent-chat'
        // eslint-disable-next-line style/multiline-ternary
        ? ({
            max_iteration: DEFAULT_AGENT_SETTING.max_iteration,
            ...modelConfig.agent_mode,
            // remove dataset
            enabled: true, // modelConfig.agent_mode?.enabled is not correct. old app: the value of app with dataset's is always true
            tools: modelConfig.agent_mode?.tools.filter((tool: any) => {
              return !tool.dataset
            }).map((tool: any) => {
              const toolInCollectionList = collectionList?.find(c => tool.provider_id === c.id)
              return {
                ...tool,
                isDeleted: appDetail?.deleted_tools?.some((deletedTool: any) => deletedTool.id === tool.id && deletedTool.tool_name === tool.tool_name),
                notAuthor: toolInCollectionList?.is_team_authorization === false,
                ...(tool.provider_type === 'builtin'
                  ? {
                      provider_id: correctToolProvider(tool.provider_name, !!toolInCollectionList),
                      provider_name: correctToolProvider(tool.provider_name, !!toolInCollectionList),
                    }
                  : {}),
              }
            }),
          }) : DEFAULT_AGENT_SETTING,
    }
    return (newModelConfig as any)
  })(appDetail?.model_config)
  const mode = appDetail?.mode
  // const isChatApp = ['chat', 'advanced-chat', 'agent-chat'].includes(mode!)

  // chat configuration
  const promptMode = modelConfig?.prompt_type === PromptMode.advanced ? PromptMode.advanced : PromptMode.simple
  const isAdvancedMode = promptMode === PromptMode.advanced
  const isAgent = mode === 'agent-chat'
  const chatPromptConfig = isAdvancedMode ? (modelConfig?.chat_prompt_config || clone(DEFAULT_CHAT_PROMPT_CONFIG)) : undefined
  const suggestedQuestions = modelConfig?.suggested_questions || []
  const moreLikeThisConfig = modelConfig?.more_like_this || { enabled: false }
  const suggestedQuestionsAfterAnswerConfig = modelConfig?.suggested_questions_after_answer || { enabled: false }
  const speechToTextConfig = modelConfig?.speech_to_text || { enabled: false }
  const textToSpeechConfig = modelConfig?.text_to_speech || { enabled: false, voice: '', language: '' }
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
  const completionPromptConfig = modelConfig?.completion_prompt_config || clone(DEFAULT_COMPLETION_PROMPT_CONFIG) as any

  // prompt & model config
  const inputs = {}
  const query = ''
  const completionParams = useState<FormValue>({})

  const {
    currentModel: currModel,
  } = useTextGenerationCurrentProviderAndModelAndModelList(
    {
      provider: modelConfig.provider,
      model: modelConfig.model_id,
    },
  )

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
          transfer_methods: modelConfig.file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
        },
        enabled: !!(modelConfig.file_upload?.enabled || modelConfig.file_upload?.image?.enabled),
        allowed_file_types: modelConfig.file_upload?.allowed_file_types || [],
        allowed_file_extensions: modelConfig.file_upload?.allowed_file_extensions || [...FILE_EXTS[SupportUploadFileTypes.image], ...FILE_EXTS[SupportUploadFileTypes.video]].map(ext => `.${ext}`),
        allowed_file_upload_methods: modelConfig.file_upload?.allowed_file_upload_methods || modelConfig.file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
        number_limits: modelConfig.file_upload?.number_limits || modelConfig.file_upload?.image?.number_limits || 3,
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
        <div className="flex h-full w-full flex-col bg-components-panel-on-panel-item-bg">
          <div className="relative flex h-[200px] grow">
            <div className="flex h-full w-full shrink-0 flex-col sm:w-1/2">
              <Config />
            </div>
            {!isMobile && (
              <div className="relative flex h-full w-1/2 grow flex-col overflow-y-auto " style={{ borderColor: 'rgba(0, 0, 0, 0.02)' }}>
                <div className="flex grow flex-col rounded-tl-2xl border-l-[0.5px] border-t-[0.5px] border-components-panel-border bg-chatbot-bg ">
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
