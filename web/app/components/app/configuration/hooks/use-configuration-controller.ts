/* eslint-disable ts/no-explicit-any */
import type { ComponentProps } from 'react'
import type { PublishConfig } from '../types'
import type ConfigurationDebugPanel from '@/app/components/app/configuration/components/configuration-debug-panel'
import type ConfigurationHeaderActions from '@/app/components/app/configuration/components/configuration-header-actions'
import type ConfigurationModals from '@/app/components/app/configuration/components/configuration-modals'
import type { Features as FeaturesData, FileUpload } from '@/app/components/base/features/types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Collection } from '@/app/components/tools/types'
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
import { useBoolean, useGetState } from 'ahooks'
import { clone } from 'es-toolkit/object'
import { isEqual } from 'es-toolkit/predicate'
import { produce } from 'immer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { getOpenModelProviderHandler } from '@/app/components/app/configuration/components/configuration-debug-panel.utils'
import { useStore as useAppStore } from '@/app/components/app/store'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { toast } from '@/app/components/base/ui/toast'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { ModelFeatureEnum, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  useModelListAndDefaultModelAndCurrentProviderAndModel,
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import { getMultipleRetrievalConfig, getSelectedDatasetsMode } from '@/app/components/workflow/nodes/knowledge-retrieval/utils'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { ANNOTATION_DEFAULT, DATASET_DEFAULT, DEFAULT_AGENT_SETTING, DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { PromptMode } from '@/models/debug'
import { usePathname } from '@/next/navigation'
import { useFileUploadConfig } from '@/service/use-common'
import { AppModeEnum, ModelModeType, Resolution, RETRIEVE_TYPE, TransferMethod } from '@/types/app'
import { fetchAndMergeValidCompletionParams } from '@/utils/completion-params'
import { supportFunctionCall } from '@/utils/tool-call'
import { useDebugWithSingleOrMultipleModel, useFormattingChangedDispatcher } from '../debug/hooks'
import useAdvancedPromptConfig from './use-advanced-prompt-config'
import { useConfigurationInitializer } from './use-configuration-initializer'
import { useConfigurationPublish } from './use-configuration-publish'

type HeaderActionsProps = ComponentProps<typeof ConfigurationHeaderActions>
type DebugPanelProps = ComponentProps<typeof ConfigurationDebugPanel>
type ModalsProps = ComponentProps<typeof ConfigurationModals>

export const useConfigurationController = () => {
  const { t } = useTranslation()
  const {
    isLoadingCurrentWorkspace,
    currentWorkspace,
  } = useAppContext()
  const { setShowAccountSettingModal } = useModalContext()

  const {
    appDetail,
    showAppConfigureFeaturesModal,
    setAppSidebarExpand,
    setShowAppConfigureFeaturesModal,
  } = useAppStore(useShallow(state => ({
    appDetail: state.appDetail,
    setAppSidebarExpand: state.setAppSidebarExpand,
    showAppConfigureFeaturesModal: state.showAppConfigureFeaturesModal,
    setShowAppConfigureFeaturesModal: state.setShowAppConfigureFeaturesModal,
  })))

  const { data: fileUploadConfigResponse } = useFileUploadConfig()
  const latestPublishedAt = useMemo(() => appDetail?.model_config?.updated_at, [appDetail])
  const pathname = usePathname()
  const matched = /\/app\/([^/]+)/.exec(pathname)
  const appId = (matched?.length && matched[1]) ? matched[1] : ''

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const [hasFetchedDetail, setHasFetchedDetail] = useState(false)
  const isLoading = !hasFetchedDetail
  const [formattingChanged, setFormattingChanged] = useState(false)
  const [mode, setMode] = useState<AppModeEnum>(AppModeEnum.CHAT)
  const [publishedConfig, setPublishedConfig] = useState<PublishConfig | null>(null)
  const [conversationId, setConversationId] = useState<string | null>('')
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
  const [annotationConfigState, doSetAnnotationConfig] = useState<AnnotationReplyConfig>({
    id: '',
    enabled: false,
    score_threshold: ANNOTATION_DEFAULT.score_threshold,
    embedding_model: {
      embedding_model_name: '',
      embedding_provider_name: '',
    },
  })
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
      prompt_variables: [] as PromptVariable[],
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
  const [collectionList, setCollectionList] = useState<Collection[]>([])
  const [datasetConfigsState, doSetDatasetConfigs] = useState<DatasetConfigs>({
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
  const [dataSets, setDataSets] = useState<DataSet[]>([])
  const [isShowSelectDataSet, { setTrue: showSelectDataSet, setFalse: hideSelectDataSet }] = useBoolean(false)
  const [rerankSettingModalOpen, setRerankSettingModalOpen] = useState(false)
  const [isShowHistoryModal, { setTrue: showHistoryModal, setFalse: hideHistoryModal }] = useBoolean(false)
  const [promptModeState, doSetPromptMode] = useState(PromptMode.simple)
  const [canReturnToSimpleMode, setCanReturnToSimpleMode] = useState(true)
  const [visionConfig, doSetVisionConfig] = useState({
    enabled: false,
    number_limits: 2,
    detail: Resolution.low,
    transfer_methods: [TransferMethod.local_file],
  })
  const [showUseGPT4Confirm, setShowUseGPT4Confirm] = useState(false)

  const formattingChangedDispatcher = useFormattingChangedDispatcher()
  const datasetConfigsRef = useRef(datasetConfigsState)
  const modelModeType = modelConfig.mode
  const modeModeTypeRef = useRef(modelModeType)
  const contextVar = modelConfig.configs.prompt_variables.find(item => item.is_context_var)?.key
  const hasSetContextVar = !!contextVar

  const setCompletionParams = useCallback((value: FormValue) => {
    const params = { ...value }
    if ((!params.stop || params.stop.length === 0) && modeModeTypeRef.current === ModelModeType.completion) {
      params.stop = getTempStop()
      setTempStop([])
    }
    doSetCompletionParams(params)
  }, [getTempStop, setTempStop])

  const setAnnotationConfig = useCallback((config: AnnotationReplyConfig, notSetFormatChanged?: boolean) => {
    doSetAnnotationConfig(config)
    if (!notSetFormatChanged)
      formattingChangedDispatcher()
  }, [formattingChangedDispatcher])

  const setDatasetConfigs = useCallback((newDatasetConfigs: DatasetConfigs) => {
    doSetDatasetConfigs(newDatasetConfigs)
    datasetConfigsRef.current = newDatasetConfigs
  }, [])

  const setModelConfig = useCallback((newModelConfig: ModelConfig) => {
    // eslint-disable-next-line react/set-state-in-effect
    doSetModelConfig(newModelConfig)
  }, [])

  useEffect(() => {
    modeModeTypeRef.current = modelModeType
  }, [modelModeType])

  const syncToPublishedConfig = useCallback((nextPublishedConfig: PublishConfig) => {
    const nextModelConfig = nextPublishedConfig.modelConfig
    setModelConfig(nextModelConfig)
    setCompletionParams(nextPublishedConfig.completionParams)
    setDataSets(nextModelConfig.dataSets || [])
    setIntroduction(nextModelConfig.opening_statement!)
    setMoreLikeThisConfig(nextModelConfig.more_like_this || { enabled: false })
    setSuggestedQuestionsAfterAnswerConfig(nextModelConfig.suggested_questions_after_answer || { enabled: false })
    setSpeechToTextConfig(nextModelConfig.speech_to_text || { enabled: false })
    setTextToSpeechConfig(nextModelConfig.text_to_speech || {
      enabled: false,
      voice: '',
      language: '',
    })
    setCitationConfig(nextModelConfig.retriever_resource || { enabled: false })
  }, [setCompletionParams, setModelConfig])

  const { isAPIKeySet } = useProviderContext()
  const { currentModel: currModel, textGenerationModelList } = useTextGenerationCurrentProviderAndModelAndModelList({
    provider: modelConfig.provider,
    model: modelConfig.model_id,
  })
  const isFunctionCall = supportFunctionCall(currModel?.features)

  useEffect(() => {
    if (hasFetchedDetail || modelModeType)
      return

    const nextMode = currModel?.model_properties.mode as ModelModeType | undefined
    if (!nextMode)
      return

    setModelConfig(produce(modelConfig, (draft) => {
      draft.mode = nextMode
    }))
  }, [currModel, hasFetchedDetail, modelConfig, modelModeType, setModelConfig, textGenerationModelList])

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
    promptMode: promptModeState,
    modelModeType,
    prePrompt: modelConfig.configs.prompt_template,
    hasSetDataSet: dataSets.length > 0,
    onUserChangedPrompt: () => setCanReturnToSimpleMode(false),
    completionParams: completionParamsState,
    setCompletionParams,
    setStop: setTempStop,
  })

  const setPromptMode = useCallback(async (nextPromptMode: PromptMode) => {
    if (nextPromptMode === PromptMode.advanced) {
      await migrateToDefaultPrompt()
      setCanReturnToSimpleMode(true)
    }
    doSetPromptMode(nextPromptMode)
  }, [migrateToDefaultPrompt])

  const setModel = useCallback(async ({
    modelId,
    provider,
    mode: nextMode,
    features,
  }: { modelId: string, provider: string, mode: string, features: string[] }) => {
    if (promptModeState === PromptMode.advanced) {
      if (nextMode === ModelModeType.completion) {
        if (mode !== AppModeEnum.COMPLETION) {
          if (!completionPromptConfig.prompt?.text || !completionPromptConfig.conversation_histories_role.assistant_prefix || !completionPromptConfig.conversation_histories_role.user_prefix)
            await migrateToDefaultPrompt(true, ModelModeType.completion)
        }
        else if (!completionPromptConfig.prompt?.text) {
          await migrateToDefaultPrompt(true, ModelModeType.completion)
        }
      }
      if (nextMode === ModelModeType.chat && chatPromptConfig.prompt.length === 0)
        await migrateToDefaultPrompt(true, ModelModeType.chat)
    }

    setModelConfig(produce(modelConfig, (draft) => {
      draft.provider = provider
      draft.model_id = modelId
      draft.mode = nextMode as ModelModeType
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
        promptModeState === PromptMode.advanced,
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
    migrateToDefaultPrompt,
    mode,
    modelConfig,
    promptModeState,
    setCompletionParams,
    setModelConfig,
    t,
    visionConfig,
  ])

  const isOpenAI = modelConfig.provider === 'langgenius/openai/openai'
  const isAgent = mode === AppModeEnum.AGENT_CHAT
  const selectedIds = dataSets.map(item => item.id)
  const {
    currentModel: currentRerankModel,
    currentProvider: currentRerankProvider,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)

  const handleSelect = useCallback((selectedDataSets: DataSet[]) => {
    if (isEqual(selectedDataSets.map(item => item.id), dataSets.map(item => item.id))) {
      hideSelectDataSet()
      return
    }

    formattingChangedDispatcher()
    let nextDataSets = selectedDataSets
    if (selectedDataSets.find(item => !item.name)) {
      const hydratedSelection = produce(selectedDataSets, (draft) => {
        selectedDataSets.forEach((item, index) => {
          if (!item.name) {
            const hydratedItem = dataSets.find(dataset => dataset.id === item.id)
            if (hydratedItem)
              draft[index] = hydratedItem
          }
        })
      })
      setDataSets(hydratedSelection)
      nextDataSets = hydratedSelection
    }
    else {
      setDataSets(selectedDataSets)
    }

    hideSelectDataSet()
    const {
      allExternal,
      allInternal,
      mixtureInternalAndExternal,
      mixtureHighQualityAndEconomic,
      inconsistentEmbeddingModel,
    } = getSelectedDatasetsMode(nextDataSets)

    if ((allInternal && (mixtureHighQualityAndEconomic || inconsistentEmbeddingModel)) || mixtureInternalAndExternal || allExternal)
      setRerankSettingModalOpen(true)

    const { datasets, retrieval_model, score_threshold_enabled, ...restConfigs } = datasetConfigsState
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

    const retrievalConfig = getMultipleRetrievalConfig(oldRetrievalConfig, nextDataSets, dataSets, {
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
    datasetConfigsState,
    formattingChangedDispatcher,
    hideSelectDataSet,
    setDatasetConfigs,
  ])

  const featuresData: FeaturesData = useMemo(() => ({
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
      fileUploadConfig: fileUploadConfigResponse,
    } as FileUpload,
    suggested: modelConfig.suggested_questions_after_answer || { enabled: false },
    citation: modelConfig.retriever_resource || { enabled: false },
    annotationReply: modelConfig.annotation_reply || { enabled: false },
  }), [fileUploadConfigResponse, modelConfig])

  const handleFeaturesChange = useCallback((flag: any) => {
    setShowAppConfigureFeaturesModal(true)
    if (flag)
      formattingChangedDispatcher()
  }, [formattingChangedDispatcher, setShowAppConfigureFeaturesModal])

  const handleAddPromptVariable = useCallback((variables: PromptVariable[]) => {
    setModelConfig(produce(modelConfig, (draft) => {
      draft.configs.prompt_variables = [...draft.configs.prompt_variables, ...variables]
    }))
  }, [modelConfig, setModelConfig])

  useConfigurationInitializer({
    appId,
    currentRerankProvider,
    currentRerankModel,
    syncToPublishedConfig,
    setMode,
    setPromptMode: doSetPromptMode,
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
    setModerationConfig: setModerationConfig as any,
    setExternalDataToolsConfig,
    handleSetVisionConfig,
    setPublishedConfig,
    setDatasetConfigs,
    setCollectionList,
    setHasFetchedDetail,
  })

  const { cannotPublish, onPublish } = useConfigurationPublish({
    appId,
    mode,
    modelConfig,
    completionParams: completionParamsState,
    promptMode: promptModeState,
    isAdvancedMode: promptModeState === PromptMode.advanced,
    chatPromptConfig,
    completionPromptConfig,
    hasSetBlockStatus,
    contextVar,
    dataSets,
    datasetConfigs: datasetConfigsState,
    introduction,
    moreLikeThisConfig,
    suggestedQuestionsAfterAnswerConfig,
    speechToTextConfig,
    textToSpeechConfig,
    citationConfig,
    externalDataToolsConfig,
    isFunctionCall,
    setPublishedConfig,
    setCanReturnToSimpleMode,
  })

  const { debugWithMultipleModel, multipleModelConfigs, handleMultipleModelConfigsChange } = useDebugWithSingleOrMultipleModel(appId)
  const handleDebugWithMultipleModelChange = useCallback(() => {
    handleMultipleModelConfigsChange(true, [
      { id: `${Date.now()}`, model: modelConfig.model_id, provider: modelConfig.provider, parameters: completionParamsState },
      { id: `${Date.now()}-no-repeat`, model: '', provider: '', parameters: {} },
    ])
    setAppSidebarExpand('collapse')
  }, [completionParamsState, handleMultipleModelConfigsChange, modelConfig.model_id, modelConfig.provider, setAppSidebarExpand])

  const isShowVisionConfig = !!currModel?.features?.includes(ModelFeatureEnum.vision)
  const isShowDocumentConfig = !!currModel?.features?.includes(ModelFeatureEnum.document)
  const isShowAudioConfig = !!currModel?.features?.includes(ModelFeatureEnum.audio)
  const isAllowVideoUpload = !!currModel?.features?.includes(ModelFeatureEnum.video)

  const contextValue = {
    appId,
    isAPIKeySet,
    isTrailFinished: false,
    mode,
    modelModeType,
    promptMode: promptModeState,
    isAdvancedMode: promptModeState === PromptMode.advanced,
    isAgent,
    isOpenAI,
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
    annotationConfig: annotationConfigState,
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
    datasetConfigs: datasetConfigsState,
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

  const debugPanelProps: DebugPanelProps = {
    isAPIKeySet,
    inputs,
    onOpenModelProvider: getOpenModelProviderHandler(setShowAccountSettingModal),
    modelParameterParams: {
      setModel: setModel as any,
      onCompletionParamsChange: setCompletionParams,
    },
    debugWithMultipleModel,
    multipleModelConfigs,
    onMultipleModelConfigsChange: handleMultipleModelConfigsChange,
  }

  const headerActionsProps: HeaderActionsProps = {
    isAgent,
    isFunctionCall,
    isMobile,
    showModelParameterModal: !debugWithMultipleModel,
    onShowDebugPanel: showDebugPanel,
    agentSettingButtonProps: {
      isChatModel: modelConfig.mode === ModelModeType.chat,
      isFunctionCall,
      agentConfig: modelConfig.agentConfig,
      onAgentSettingChange: (config) => {
        setModelConfig(produce(modelConfig, (draft) => {
          draft.agentConfig = config
        }))
      },
    },
    modelParameterModalProps: {
      isAdvancedMode: promptModeState === PromptMode.advanced,
      provider: modelConfig.provider,
      completionParams: completionParamsState,
      modelId: modelConfig.model_id,
      setModel: setModel as any,
      onCompletionParamsChange: (newParams: FormValue) => {
        setCompletionParams(newParams)
      },
      debugWithMultipleModel,
      onDebugWithMultipleModelChange: handleDebugWithMultipleModelChange,
    },
    publisherProps: {
      publishDisabled: cannotPublish,
      publishedAt: (latestPublishedAt || 0) * 1000,
      debugWithMultipleModel,
      multipleModelConfigs,
      onPublish,
      publishedConfig: publishedConfig!,
      resetAppConfig: () => syncToPublishedConfig(publishedConfig!),
    },
  }

  const modalProps: ModalsProps = {
    showUseGPT4Confirm,
    onConfirmUseGPT4: () => {
      setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.MODEL_PROVIDER })
      setShowUseGPT4Confirm(false)
    },
    onCancelUseGPT4: () => setShowUseGPT4Confirm(false),
    isShowSelectDataSet,
    hideSelectDataSet,
    selectedIds,
    onSelectDataSet: handleSelect,
    isShowHistoryModal,
    hideHistoryModal,
    conversationHistoriesRole: completionPromptConfig.conversation_histories_role,
    setConversationHistoriesRole,
    isMobile,
    isShowDebugPanel,
    hideDebugPanel,
    debugPanelProps,
    showAppConfigureFeaturesModal,
    closeFeaturePanel: () => setShowAppConfigureFeaturesModal(false),
    mode,
    handleFeaturesChange,
    promptVariables: modelConfig.configs.prompt_variables,
    handleAddPromptVariable,
  }

  return {
    currentWorkspaceId: currentWorkspace.id,
    featuresData,
    contextValue,
    debugPanelProps,
    headerActionsProps,
    isLoading,
    isLoadingCurrentWorkspace,
    isMobile,
    modalProps,
  }
}
