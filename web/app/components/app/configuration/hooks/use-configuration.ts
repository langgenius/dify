'use client'
import type { ComponentProps } from 'react'
import type AppPublisher from '@/app/components/app/app-publisher/features-wrapper'
import type { ModelAndParameter } from '@/app/components/app/configuration/debug/types'
import type { Features as FeaturesData, OnFeaturesChange } from '@/app/components/base/features/types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import type { Collection } from '@/app/components/tools/types'
import type ConfigContext from '@/context/debug-configuration'
import type { ExternalDataTool } from '@/models/common'
import type { DataSet } from '@/models/datasets'
import type {
  AnnotationReplyConfig,
  DatasetConfigs,
  Inputs,
  ModelConfig,
  ModerationConfig,
  MoreLikeThisConfig,
  PromptConfig,
  PromptVariable,
  TextToSpeechConfig,
} from '@/models/debug'
import type { ModelConfig as BackendModelConfig, UserInputFormItem, VisionSettings } from '@/types/app'
import { useBoolean, useGetState } from 'ahooks'
import { clone } from 'es-toolkit/object'
import { isEqual } from 'es-toolkit/predicate'
import { produce } from 'immer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import {
  useDebugWithSingleOrMultipleModel,
  useFormattingChangedDispatcher,
} from '@/app/components/app/configuration/debug/hooks'
import useAdvancedPromptConfig from '@/app/components/app/configuration/hooks/use-advanced-prompt-config'
import { useStore as useAppStore } from '@/app/components/app/store'
import { toast } from '@/app/components/base/ui/toast'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { ModelFeatureEnum, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  useModelListAndDefaultModelAndCurrentProviderAndModel,
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import {
  getMultipleRetrievalConfig,
  getSelectedDatasetsMode,
} from '@/app/components/workflow/nodes/knowledge-retrieval/utils'
import { ANNOTATION_DEFAULT, DATASET_DEFAULT, DEFAULT_AGENT_SETTING, DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { PromptMode } from '@/models/debug'
import { usePathname } from '@/next/navigation'
import { fetchAppDetailDirect, updateAppModelConfig } from '@/service/apps'
import { fetchDatasets } from '@/service/datasets'
import { fetchCollectionList } from '@/service/tools'
import { useFileUploadConfig } from '@/service/use-common'
import { AgentStrategy, AppModeEnum, ModelModeType, Resolution, RETRIEVE_TYPE, TransferMethod } from '@/types/app'
import {
  correctModelProvider,
  correctToolProvider,
} from '@/utils'
import { fetchAndMergeValidCompletionParams } from '@/utils/completion-params'
import { promptVariablesToUserInputsForm, userInputsFormToPromptVariables } from '@/utils/model-config'
import { supportFunctionCall } from '@/utils/tool-call'
import { basePath } from '@/utils/var'
import {
  buildConfigurationFeaturesData,
  getConfigurationPublishingState,
  withCollectionIconBasePath,
} from '../utils'

export type PublishConfig = {
  modelConfig: ModelConfig
  completionParams: FormValue
}

type DebugConfigurationValue = ComponentProps<typeof ConfigContext.Provider>['value']

export type ConfigurationViewModel = {
  appPublisherProps: ComponentProps<typeof AppPublisher>
  contextValue: DebugConfigurationValue
  featuresData: FeaturesData
  isAgent: boolean
  isAdvancedMode: boolean
  isMobile: boolean
  isShowDebugPanel: boolean
  isShowHistoryModal: boolean
  isShowSelectDataSet: boolean
  modelConfig: ModelConfig
  multipleModelConfigs: ModelAndParameter[]
  onAutoAddPromptVariable: (variables: PromptVariable[]) => void
  onAgentSettingChange: (config: ModelConfig['agentConfig']) => void
  onCloseFeaturePanel: () => void
  onCloseHistoryModal: () => void
  onCloseSelectDataSet: () => void
  onCompletionParamsChange: (params: FormValue) => void
  onConfirmUseGPT4: () => void
  onEnableMultipleModelDebug: () => void
  onFeaturesChange: OnFeaturesChange
  onHideDebugPanel: () => void
  onModelChange: ComponentProps<typeof ModelParameterModal>['setModel']
  onMultipleModelConfigsChange: (multiple: boolean, modelConfigs: ModelAndParameter[]) => void
  onOpenAccountSettings: () => void
  onOpenDebugPanel: () => void
  onSaveHistory: (data: DebugConfigurationValue['completionPromptConfig']['conversation_histories_role']) => void
  onSelectDataSets: (data: DataSet[]) => void
  promptVariables: PromptVariable[]
  selectedIds: string[]
  showAppConfigureFeaturesModal: boolean
  showLoading: boolean
  showUseGPT4Confirm: boolean
  setShowUseGPT4Confirm: (visible: boolean) => void
}

export const useConfiguration = (): ConfigurationViewModel => {
  const { t } = useTranslation()
  const { isLoadingCurrentWorkspace, currentWorkspace } = useAppContext()
  const { setShowAccountSettingModal } = useModalContext()

  const { appDetail, showAppConfigureFeaturesModal, setAppSidebarExpand, setShowAppConfigureFeaturesModal } = useAppStore(useShallow(state => ({
    appDetail: state.appDetail,
    setAppSidebarExpand: state.setAppSidebarExpand,
    showAppConfigureFeaturesModal: state.showAppConfigureFeaturesModal,
    setShowAppConfigureFeaturesModal: state.setShowAppConfigureFeaturesModal,
  })))

  const { data: fileUploadConfigResponse } = useFileUploadConfig()
  const latestPublishedAt = useMemo(() => appDetail?.model_config?.updated_at, [appDetail])
  const [formattingChanged, setFormattingChanged] = useState(false)
  const [hasFetchedDetail, setHasFetchedDetail] = useState(false)
  const pathname = usePathname()
  const matched = /\/app\/([^/]+)/.exec(pathname)
  const appId = matched?.[1] || ''
  const [mode, setMode] = useState<AppModeEnum>(AppModeEnum.CHAT)
  const [publishedConfig, setPublishedConfig] = useState<PublishConfig | null>(null)
  const [conversationId, setConversationId] = useState<string | null>('')

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const [isShowDebugPanel, { setTrue: showDebugPanel, setFalse: hideDebugPanel }] = useBoolean(false)

  const [introduction, setIntroduction] = useState('')
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([])
  const [controlClearChatMessage, setControlClearChatMessage] = useState(0)
  const [prevPromptConfig, setPrevPromptConfig] = useState<PromptConfig>({
    prompt_template: '',
    prompt_variables: [],
  })
  const [moreLikeThisConfig, setMoreLikeThisConfig] = useState<MoreLikeThisConfig>({ enabled: false })
  const [suggestedQuestionsAfterAnswerConfig, setSuggestedQuestionsAfterAnswerConfig] = useState<MoreLikeThisConfig>({ enabled: false })
  const [speechToTextConfig, setSpeechToTextConfig] = useState<MoreLikeThisConfig>({ enabled: false })
  const [textToSpeechConfig, setTextToSpeechConfig] = useState<TextToSpeechConfig>({
    enabled: false,
    voice: '',
    language: '',
  })
  const [citationConfig, setCitationConfig] = useState<MoreLikeThisConfig>({ enabled: false })
  const [annotationConfig, doSetAnnotationConfig] = useState<AnnotationReplyConfig>({
    id: '',
    enabled: false,
    score_threshold: ANNOTATION_DEFAULT.score_threshold,
    embedding_model: {
      embedding_provider_name: '',
      embedding_model_name: '',
    },
  })
  const formattingChangedDispatcher = useFormattingChangedDispatcher()
  const setAnnotationConfig = useCallback((config: AnnotationReplyConfig, notSetFormatChanged?: boolean) => {
    doSetAnnotationConfig(config)
    if (!notSetFormatChanged)
      formattingChangedDispatcher()
  }, [formattingChangedDispatcher])

  const [moderationConfig, setModerationConfig] = useState<ModerationConfig>({ enabled: false })
  const [externalDataToolsConfig, setExternalDataToolsConfig] = useState<ExternalDataTool[]>([])
  const [inputs, setInputs] = useState<Inputs>({})
  const [query, setQuery] = useState('')
  const [completionParamsState, doSetCompletionParams] = useState<FormValue>({})
  const [, setTempStop, getTempStop] = useGetState<string[]>([])
  const [modelConfig, doSetModelConfig] = useState<ModelConfig>({
    provider: 'langgenius/openai/openai',
    model_id: 'gpt-3.5-turbo',
    mode: ModelModeType.unset,
    configs: {
      prompt_template: '',
      prompt_variables: [],
    },
    chat_prompt_config: clone(DEFAULT_CHAT_PROMPT_CONFIG),
    completion_prompt_config: clone(DEFAULT_COMPLETION_PROMPT_CONFIG),
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
    external_data_tools: [],
    system_parameters: {
      audio_file_size_limit: 0,
      file_size_limit: 0,
      image_file_size_limit: 0,
      video_file_size_limit: 0,
      workflow_file_upload_limit: 0,
    },
    dataSets: [],
    agentConfig: DEFAULT_AGENT_SETTING,
  })

  const modelModeType = modelConfig.mode
  const modeModeTypeRef = useRef(modelModeType)

  const setCompletionParams = useCallback((value: FormValue) => {
    const params = { ...value }
    if ((!params.stop || params.stop.length === 0) && modeModeTypeRef.current === ModelModeType.completion) {
      params.stop = getTempStop()
      setTempStop([])
    }
    doSetCompletionParams(params)
  }, [getTempStop, setTempStop])

  const setModelConfig = useCallback((newModelConfig: ModelConfig) => {
    doSetModelConfig(newModelConfig)
  }, [])

  const isAgent = mode === AppModeEnum.AGENT_CHAT

  const [collectionList, setCollectionList] = useState<Collection[]>([])
  const [datasetConfigs, doSetDatasetConfigs] = useState<DatasetConfigs>({
    retrieval_model: RETRIEVE_TYPE.multiWay,
    reranking_model: {
      reranking_provider_name: '',
      reranking_model_name: '',
    },
    top_k: DATASET_DEFAULT.top_k,
    score_threshold_enabled: false,
    score_threshold: DATASET_DEFAULT.score_threshold,
    datasets: {
      datasets: [],
    },
  })
  const datasetConfigsRef = useRef(datasetConfigs)
  const setDatasetConfigs = useCallback((newDatasetConfigs: DatasetConfigs) => {
    doSetDatasetConfigs(newDatasetConfigs)
    datasetConfigsRef.current = newDatasetConfigs
  }, [])

  const [dataSets, setDataSets] = useState<DataSet[]>([])
  const contextVar = modelConfig.configs.prompt_variables.find(item => item.is_context_var)?.key
  const hasSetContextVar = !!contextVar
  const [isShowSelectDataSet, { setTrue: showSelectDataSet, setFalse: hideSelectDataSet }] = useBoolean(false)
  const selectedIds = dataSets.map(item => item.id)
  const [rerankSettingModalOpen, setRerankSettingModalOpen] = useState(false)
  const [isShowHistoryModal, { setTrue: showHistoryModal, setFalse: hideHistoryModal }] = useBoolean(false)
  const [showUseGPT4Confirm, setShowUseGPT4Confirm] = useState(false)

  const {
    currentModel: currentRerankModel,
    currentProvider: currentRerankProvider,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)

  const syncToPublishedConfig = useCallback((_publishedConfig: PublishConfig) => {
    const publishedModelConfig = _publishedConfig.modelConfig
    setModelConfig(publishedModelConfig)
    setCompletionParams(_publishedConfig.completionParams)
    setDataSets(publishedModelConfig.dataSets || [])
    setIntroduction(publishedModelConfig.opening_statement || '')
    setMoreLikeThisConfig(publishedModelConfig.more_like_this || { enabled: false })
    setSuggestedQuestionsAfterAnswerConfig(publishedModelConfig.suggested_questions_after_answer || { enabled: false })
    setSpeechToTextConfig(publishedModelConfig.speech_to_text || { enabled: false })
    setTextToSpeechConfig(publishedModelConfig.text_to_speech || {
      enabled: false,
      voice: '',
      language: '',
    })
    setCitationConfig(publishedModelConfig.retriever_resource || { enabled: false })
  }, [setCompletionParams, setModelConfig])

  const { isAPIKeySet } = useProviderContext()
  const {
    currentModel: currModel,
  } = useTextGenerationCurrentProviderAndModelAndModelList({
    provider: modelConfig.provider,
    model: modelConfig.model_id,
  })
  const resolvedModelModeType = (modelModeType || (hasFetchedDetail ? currModel?.model_properties.mode as ModelModeType | undefined : undefined)) ?? ModelModeType.unset

  const isFunctionCall = supportFunctionCall(currModel?.features)

  useEffect(() => {
    modeModeTypeRef.current = resolvedModelModeType
  }, [resolvedModelModeType])

  const [promptMode, doSetPromptMode] = useState(PromptMode.simple)
  const isAdvancedMode = promptMode === PromptMode.advanced
  const [canReturnToSimpleMode, setCanReturnToSimpleMode] = useState(true)
  const [visionConfig, doSetVisionConfig] = useState({
    enabled: false,
    number_limits: 2,
    detail: Resolution.low,
    transfer_methods: [TransferMethod.local_file],
  })

  const handleSetVisionConfig = useCallback((config: VisionSettings, notNoticeFormattingChanged?: boolean) => {
    doSetVisionConfig({
      enabled: config.enabled || false,
      number_limits: config.number_limits || 2,
      detail: config.detail || Resolution.low,
      transfer_methods: config.transfer_methods || [TransferMethod.local_file],
    })
    if (!notNoticeFormattingChanged)
      formattingChangedDispatcher()
  }, [formattingChangedDispatcher])

  const {
    chatPromptConfig,
    setChatPromptConfig,
    completionPromptConfig,
    setCompletionPromptConfig,
    currentAdvancedPrompt,
    setCurrentAdvancedPrompt,
    hasSetBlockStatus,
    setConversationHistoriesRole,
    migrateToDefaultPrompt,
  } = useAdvancedPromptConfig({
    appMode: mode,
    modelName: modelConfig.model_id,
    promptMode,
    modelModeType: resolvedModelModeType,
    prePrompt: modelConfig.configs.prompt_template,
    hasSetDataSet: dataSets.length > 0,
    onUserChangedPrompt: () => {
      setCanReturnToSimpleMode(false)
    },
    completionParams: completionParamsState,
    setCompletionParams,
    setStop: setTempStop,
  })

  const setPromptMode = useCallback(async (nextMode: PromptMode) => {
    if (nextMode === PromptMode.advanced) {
      await migrateToDefaultPrompt()
      setCanReturnToSimpleMode(true)
    }
    doSetPromptMode(nextMode)
  }, [migrateToDefaultPrompt])

  const handleSelect = useCallback((nextDataSets: DataSet[]) => {
    if (isEqual(nextDataSets.map(item => item.id), dataSets.map(item => item.id))) {
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
      provider: currentRerankProvider?.provider,
      model: currentRerankModel?.model,
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
  }, [
    currentRerankModel?.model,
    currentRerankProvider?.provider,
    dataSets,
    datasetConfigs,
    formattingChangedDispatcher,
    hideSelectDataSet,
    setDatasetConfigs,
  ])

  const setModel = useCallback(async ({
    modelId,
    provider,
    mode: nextModelMode = resolvedModelModeType,
    features = [],
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

      if (nextModelMode === ModelModeType.chat && chatPromptConfig.prompt.length === 0)
        await migrateToDefaultPrompt(true, ModelModeType.chat)
    }

    setModelConfig(produce(modelConfig, (draft: ModelConfig) => {
      draft.provider = provider
      draft.model_id = modelId
      draft.mode = nextModelMode as ModelModeType
    }))

    handleSetVisionConfig({
      ...visionConfig,
      enabled: !!features?.includes(ModelFeatureEnum.vision),
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
  }, [
    chatPromptConfig.prompt.length,
    completionParamsState,
    completionPromptConfig.conversation_histories_role.assistant_prefix,
    completionPromptConfig.conversation_histories_role.user_prefix,
    completionPromptConfig.prompt?.text,
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
  ])

  const isShowVisionConfig = !!currModel?.features?.includes(ModelFeatureEnum.vision)
  const isShowDocumentConfig = !!currModel?.features?.includes(ModelFeatureEnum.document)
  const isShowAudioConfig = !!currModel?.features?.includes(ModelFeatureEnum.audio)
  const isAllowVideoUpload = !!currModel?.features?.includes(ModelFeatureEnum.video)

  const featuresData = useMemo(() => buildConfigurationFeaturesData(modelConfig, fileUploadConfigResponse), [fileUploadConfigResponse, modelConfig])

  const handleFeaturesChange = useCallback<OnFeaturesChange>((features) => {
    setShowAppConfigureFeaturesModal(true)
    if (features)
      formattingChangedDispatcher()
  }, [formattingChangedDispatcher, setShowAppConfigureFeaturesModal])

  const handleAddPromptVariable = useCallback((variables: PromptVariable[]) => {
    setModelConfig(produce(modelConfig, (draft: ModelConfig) => {
      draft.configs.prompt_variables = [...draft.configs.prompt_variables, ...variables]
    }))
  }, [modelConfig, setModelConfig])

  useEffect(() => {
    void (async () => {
      const nextCollectionList = withCollectionIconBasePath(await fetchCollectionList(), basePath)
      setCollectionList(nextCollectionList)

      const res = await fetchAppDetailDirect({ url: '/apps', id: appId })
      setMode(res.mode as AppModeEnum)

      const backendModelConfig = res.model_config as BackendModelConfig
      const nextPromptMode = backendModelConfig.prompt_type === PromptMode.advanced ? PromptMode.advanced : PromptMode.simple
      doSetPromptMode(nextPromptMode)

      if (nextPromptMode === PromptMode.advanced) {
        if (backendModelConfig.chat_prompt_config && backendModelConfig.chat_prompt_config.prompt.length > 0)
          setChatPromptConfig(backendModelConfig.chat_prompt_config)
        else
          setChatPromptConfig(clone(DEFAULT_CHAT_PROMPT_CONFIG))

        setCompletionPromptConfig(backendModelConfig.completion_prompt_config || clone(DEFAULT_COMPLETION_PROMPT_CONFIG) as never)
        setCanReturnToSimpleMode(false)
      }

      const model = backendModelConfig.model
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
      let nextDataSets: DataSet[] | null = null
      const agentModeTools = (backendModelConfig.agent_mode?.tools ?? []) as BackendAgentTool[]

      if (agentModeTools.find(tool => tool.dataset?.enabled))
        nextDataSets = agentModeTools as unknown as DataSet[]
      else if (backendModelConfig.dataset_configs.datasets?.datasets?.length > 0)
        nextDataSets = backendModelConfig.dataset_configs.datasets.datasets as unknown as DataSet[]

      if (dataSets && nextDataSets?.length) {
        const datasetIds = (nextDataSets as Array<DataSet & { dataset?: { id: string } }>)
          .map(item => item.dataset?.id || item.id)
          .filter((id): id is string => Boolean(id))
        const { data: dataSetsWithDetail } = await fetchDatasets({
          url: '/datasets',
          params: {
            page: 1,
            ids: datasetIds,
          },
        })
        nextDataSets = dataSetsWithDetail
        setDataSets(nextDataSets)
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
        let nextAnnotationConfig = backendModelConfig.annotation_reply
        if (backendModelConfig.annotation_reply.enabled) {
          nextAnnotationConfig = {
            ...backendModelConfig.annotation_reply,
            embedding_model: {
              ...backendModelConfig.annotation_reply.embedding_model,
              embedding_provider_name: correctModelProvider(backendModelConfig.annotation_reply.embedding_model.embedding_provider_name),
            },
          }
        }
        setAnnotationConfig(nextAnnotationConfig, true)
      }
      if (backendModelConfig.sensitive_word_avoidance)
        setModerationConfig(backendModelConfig.sensitive_word_avoidance)
      if (backendModelConfig.external_data_tools)
        setExternalDataToolsConfig(backendModelConfig.external_data_tools)

      const nextPublishedConfig: PublishConfig = {
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
          dataSets: nextDataSets || [],
          agentConfig: res.mode === AppModeEnum.AGENT_CHAT
            ? {
                max_iteration: DEFAULT_AGENT_SETTING.max_iteration,
                ...backendModelConfig.agent_mode,
                enabled: true,
                tools: agentModeTools.filter(tool => !tool.dataset).map((tool) => {
                  const toolInCollectionList = nextCollectionList.find(collection => collection.id === tool.provider_id)
                  return {
                    ...tool,
                    isDeleted: res.deleted_tools?.some((deletedTool: DeletedTool) => (deletedTool.provider_id || deletedTool.id) === tool.provider_id && deletedTool.tool_name === tool.tool_name) ?? false,
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
        },
        completionParams: model.completion_params,
      }

      if (backendModelConfig.file_upload)
        handleSetVisionConfig(backendModelConfig.file_upload.image, true)

      syncToPublishedConfig(nextPublishedConfig)
      setPublishedConfig(nextPublishedConfig)

      const retrievalConfig = getMultipleRetrievalConfig({
        ...backendModelConfig.dataset_configs,
        reranking_model: backendModelConfig.dataset_configs.reranking_model && {
          provider: backendModelConfig.dataset_configs.reranking_model.reranking_provider_name,
          model: backendModelConfig.dataset_configs.reranking_model.reranking_model_name,
        },
      }, nextDataSets || [], nextDataSets || [], {
        provider: currentRerankProvider?.provider,
        model: currentRerankModel?.model,
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
      setDatasetConfigs(nextDatasetConfigs)
      setHasFetchedDetail(true)
    })()
  }, [appId])

  const { promptEmpty, cannotPublish, contextVarEmpty } = useMemo(() => getConfigurationPublishingState({
    chatPromptConfig,
    completionPromptConfig,
    hasSetBlockStatus,
    hasSetContextVar,
    hasSelectedDataSets: dataSets.length > 0,
    isAdvancedMode,
    mode,
    modelModeType: resolvedModelModeType,
    promptTemplate: modelConfig.configs.prompt_template,
  }), [
    chatPromptConfig,
    completionPromptConfig,
    dataSets.length,
    hasSetBlockStatus,
    hasSetContextVar,
    isAdvancedMode,
    mode,
    modelConfig.configs.prompt_template,
    resolvedModelModeType,
  ])

  const onPublish = useCallback(async (modelAndParameter?: ModelAndParameter, features?: FeaturesData) => {
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

    const postDatasets = dataSets.map(({ id }) => ({
      dataset: {
        enabled: true,
        id,
      },
    }))

    const fileUpload = { ...features?.file }
    delete fileUpload?.fileUploadConfig

    const body: BackendModelConfig = {
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
        provider: modelAndParameter?.provider || modelConfig.provider,
        name: modelId,
        mode: resolvedModelModeType,
        completion_params: (modelAndParameter?.parameters || completionParamsState) as BackendModelConfig['model']['completion_params'],
      },
      dataset_configs: {
        ...datasetConfigs,
        datasets: {
          datasets: [...postDatasets],
        } as never,
      },
      system_parameters: modelConfig.system_parameters,
    }

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
  }, [
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
    hasSetBlockStatus.history,
    hasSetBlockStatus.query,
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
    speechToTextConfig,
    suggestedQuestionsAfterAnswerConfig,
    t,
    textToSpeechConfig,
  ])

  const {
    debugWithMultipleModel,
    multipleModelConfigs,
    handleMultipleModelConfigsChange,
  } = useDebugWithSingleOrMultipleModel(appId)

  const handleDebugWithMultipleModelChange = useCallback(() => {
    handleMultipleModelConfigsChange(
      true,
      [
        { id: `${Date.now()}`, model: modelConfig.model_id, provider: modelConfig.provider, parameters: completionParamsState },
        { id: `${Date.now()}-no-repeat`, model: '', provider: '', parameters: {} },
      ],
    )
    setAppSidebarExpand('collapse')
  }, [completionParamsState, handleMultipleModelConfigsChange, modelConfig.model_id, modelConfig.provider, setAppSidebarExpand])

  const onAgentSettingChange = useCallback((config: ModelConfig['agentConfig']) => {
    setModelConfig(produce(modelConfig, (draft: ModelConfig) => {
      draft.agentConfig = config
    }))
  }, [modelConfig, setModelConfig])

  const contextValue: DebugConfigurationValue = {
    appId,
    isAPIKeySet,
    isTrailFinished: false,
    mode,
    modelModeType: resolvedModelModeType,
    promptMode,
    isAdvancedMode,
    isAgent,
    isOpenAI: modelConfig.provider === 'langgenius/openai/openai',
    isFunctionCall,
    collectionList,
    setPromptMode,
    canReturnToSimpleMode,
    setCanReturnToSimpleMode,
    chatPromptConfig,
    completionPromptConfig,
    currentAdvancedPrompt,
    setCurrentAdvancedPrompt,
    conversationHistoriesRole: completionPromptConfig.conversation_histories_role,
    showHistoryModal,
    setConversationHistoriesRole,
    hasSetBlockStatus,
    conversationId,
    introduction,
    setIntroduction,
    suggestedQuestions,
    setSuggestedQuestions,
    setConversationId,
    controlClearChatMessage,
    setControlClearChatMessage,
    prevPromptConfig,
    setPrevPromptConfig,
    moreLikeThisConfig,
    setMoreLikeThisConfig,
    suggestedQuestionsAfterAnswerConfig,
    setSuggestedQuestionsAfterAnswerConfig,
    speechToTextConfig,
    setSpeechToTextConfig,
    textToSpeechConfig,
    setTextToSpeechConfig,
    citationConfig,
    setCitationConfig,
    annotationConfig,
    setAnnotationConfig,
    moderationConfig,
    setModerationConfig,
    externalDataToolsConfig,
    setExternalDataToolsConfig,
    formattingChanged,
    setFormattingChanged,
    inputs,
    setInputs,
    query,
    setQuery,
    completionParams: completionParamsState,
    setCompletionParams,
    modelConfig,
    setModelConfig,
    showSelectDataSet,
    dataSets,
    setDataSets,
    datasetConfigs,
    datasetConfigsRef,
    setDatasetConfigs,
    hasSetContextVar,
    isShowVisionConfig,
    visionConfig,
    setVisionConfig: handleSetVisionConfig,
    isAllowVideoUpload,
    isShowDocumentConfig,
    isShowAudioConfig,
    rerankSettingModalOpen,
    setRerankSettingModalOpen,
  }

  return {
    appPublisherProps: {
      publishDisabled: cannotPublish,
      publishedAt: (latestPublishedAt || 0) * 1000,
      debugWithMultipleModel,
      multipleModelConfigs,
      onPublish,
      publishedConfig: publishedConfig as PublishConfig,
      resetAppConfig: () => publishedConfig && syncToPublishedConfig(publishedConfig),
    },
    contextValue,
    featuresData,
    isAgent,
    isAdvancedMode,
    isMobile,
    isShowDebugPanel,
    isShowHistoryModal,
    isShowSelectDataSet,
    modelConfig,
    multipleModelConfigs,
    onAutoAddPromptVariable: handleAddPromptVariable,
    onAgentSettingChange,
    onCloseFeaturePanel: () => setShowAppConfigureFeaturesModal(false),
    onCloseHistoryModal: hideHistoryModal,
    onCloseSelectDataSet: hideSelectDataSet,
    onCompletionParamsChange: setCompletionParams,
    onConfirmUseGPT4: () => {
      setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.PROVIDER })
      setShowUseGPT4Confirm(false)
    },
    onEnableMultipleModelDebug: handleDebugWithMultipleModelChange,
    onFeaturesChange: handleFeaturesChange,
    onHideDebugPanel: hideDebugPanel,
    onModelChange: setModel,
    onMultipleModelConfigsChange: handleMultipleModelConfigsChange,
    onOpenAccountSettings: () => setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.PROVIDER }),
    onOpenDebugPanel: showDebugPanel,
    onSaveHistory: (data) => {
      setConversationHistoriesRole(data)
      hideHistoryModal()
    },
    onSelectDataSets: handleSelect,
    promptVariables: modelConfig.configs.prompt_variables,
    selectedIds,
    showAppConfigureFeaturesModal,
    showLoading: !hasFetchedDetail || isLoadingCurrentWorkspace || !currentWorkspace?.id,
    showUseGPT4Confirm,
    setShowUseGPT4Confirm,
  }
}
