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
import type { VisionSettings } from '@/types/app'
import type { PublishWorkflowParams } from '@/types/workflow'
import { useBoolean, useGetState } from 'ahooks'
import { clone } from 'es-toolkit/object'
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
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { ModelFeatureEnum, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  useModelListAndDefaultModelAndCurrentProviderAndModel,
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ANNOTATION_DEFAULT, DATASET_DEFAULT, DEFAULT_AGENT_SETTING, DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { PromptMode } from '@/models/debug'
import { usePathname } from '@/next/navigation'
import { updateAppModelConfig } from '@/service/apps'
import { useFileUploadConfig } from '@/service/use-common'
import { AppModeEnum, ModelModeType, Resolution, RETRIEVE_TYPE, TransferMethod } from '@/types/app'
import { supportFunctionCall } from '@/utils/tool-call'
import { basePath } from '@/utils/var'
import {
  buildConfigurationFeaturesData,
  getConfigurationPublishingState,
} from '../utils'
import {
  createDatasetSelectHandler,
  createModelChangeHandler,
  createPublishHandler,
  loadConfigurationState,
} from './use-configuration-utils'

type PublishConfig = {
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

  const handleSelect = useCallback(createDatasetSelectHandler({
    currentRerankModel: currentRerankModel?.model,
    currentRerankProvider: currentRerankProvider?.provider,
    dataSets,
    datasetConfigs,
    datasetConfigsRef,
    formattingChangedDispatcher,
    hideSelectDataSet,
    setDataSets,
    setDatasetConfigs,
    setRerankSettingModalOpen,
  }), [
    currentRerankModel?.model,
    currentRerankProvider?.provider,
    dataSets,
    datasetConfigs,
    datasetConfigsRef,
    formattingChangedDispatcher,
    hideSelectDataSet,
    setDataSets,
    setDatasetConfigs,
    setRerankSettingModalOpen,
  ])

  const setModel = useCallback(createModelChangeHandler({
    chatPromptLength: chatPromptConfig.prompt.length,
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
  }), [
    chatPromptConfig.prompt.length,
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
      const configurationState = await loadConfigurationState({
        appId,
        basePath,
        currentRerankModel: currentRerankModel?.model,
        currentRerankProvider: currentRerankProvider?.provider,
      })

      setCollectionList(configurationState.collectionList)
      setMode(configurationState.mode)
      doSetPromptMode(configurationState.promptMode)
      setDataSets(configurationState.nextDataSets)
      setIntroduction(configurationState.introduction)
      setSuggestedQuestions(configurationState.suggestedQuestions)
      setMoreLikeThisConfig(configurationState.moreLikeThisConfig)
      setSuggestedQuestionsAfterAnswerConfig(configurationState.suggestedQuestionsAfterAnswerConfig)
      setSpeechToTextConfig(configurationState.speechToTextConfig)
      setTextToSpeechConfig(configurationState.textToSpeechConfig)
      setCitationConfig(configurationState.citationConfig)
      setModerationConfig(configurationState.moderationConfig || { enabled: false })
      setExternalDataToolsConfig(configurationState.externalDataToolsConfig)
      setDatasetConfigs(configurationState.datasetConfigs)

      if (configurationState.promptMode === PromptMode.advanced) {
        setChatPromptConfig(configurationState.chatPromptConfig)
        setCompletionPromptConfig(configurationState.completionPromptConfig as never)
        setCanReturnToSimpleMode(false)
      }
      else {
        setCanReturnToSimpleMode(configurationState.canReturnToSimpleMode)
      }

      if (configurationState.annotationConfig)
        setAnnotationConfig(configurationState.annotationConfig, true)

      if (configurationState.visionConfig)
        handleSetVisionConfig(configurationState.visionConfig, true)

      syncToPublishedConfig(configurationState.publishedConfig as PublishConfig)
      setPublishedConfig(configurationState.publishedConfig as PublishConfig)
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

  const onPublish = useCallback(async (params?: ModelAndParameter | PublishWorkflowParams, features?: FeaturesData) => {
    const modelAndParameter = params && 'model' in params && 'provider' in params && 'parameters' in params
      ? params
      : undefined

    return createPublishHandler({
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
    })(updateAppModelConfig, modelAndParameter, features)
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
