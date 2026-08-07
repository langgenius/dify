'use client'
import type { ComponentProps } from 'react'
import type { ConfigurationPublishConfig } from './use-configuration-utils'
import type { AppPublisherPublishParams } from '@/app/components/app/app-publisher'
import type AppPublisher from '@/app/components/app/app-publisher/features-wrapper'
import type { ModelAndParameter } from '@/app/components/app/configuration/debug/types'
import type {
  Features as FeaturesData,
  OnFeaturesChange,
} from '@/app/components/base/features/types'
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
import { useMutation } from '@tanstack/react-query'
import { useBoolean, useGetState } from 'ahooks'
import { clone } from 'es-toolkit/object'
import { produce } from 'immer'
import { useAtomValue } from 'jotai'
import { useQueryState } from 'nuqs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { APP_PUBLISH_DRAFT_CHANGED } from '@/app/components/app/app-publisher/events'
import {
  useDebugWithSingleOrMultipleModel,
  useFormattingChangedDispatcher,
} from '@/app/components/app/configuration/debug/hooks'
import useAdvancedPromptConfig from '@/app/components/app/configuration/hooks/use-advanced-prompt-config'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useSetDetailSidebarMode } from '@/app/components/detail-sidebar/storage'
import {
  ModelFeatureEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  useModelListAndDefaultModelAndCurrentProviderAndModel,
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import {
  ANNOTATION_DEFAULT,
  DATASET_DEFAULT,
  DEFAULT_AGENT_SETTING,
  DEFAULT_CHAT_PROMPT_CONFIG,
  DEFAULT_COMPLETION_PROMPT_CONFIG,
} from '@/config'
import { userProfileIdAtom } from '@/context/account-state'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useProviderContext } from '@/context/provider-context'
import { currentWorkspaceAtom, currentWorkspaceLoadingAtom } from '@/context/workspace-state'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { PromptMode } from '@/models/debug'
import { usePathname } from '@/next/navigation'
import { updateAppModelConfig } from '@/service/apps'
import { consoleQuery } from '@/service/client'
import { useFileUploadConfig } from '@/service/use-common'
import { AppModeEnum, ModelModeType, Resolution, RETRIEVE_TYPE, TransferMethod } from '@/types/app'
import { getAppACLCapabilities } from '@/utils/permission'
import { supportFunctionCall } from '@/utils/tool-call'
import { basePath } from '@/utils/var'
import { buildConfigurationFeaturesData, getConfigurationPublishingState } from '../utils'
import {
  createDatasetSelectHandler,
  createModelChangeHandler,
  createPublishHandler,
  loadConfigurationState,
} from './use-configuration-utils'

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
  onFeatureStoreChange: OnFeaturesChange
  onFeaturesChange: OnFeaturesChange
  onHideDebugPanel: () => void
  onModelChange: ComponentProps<typeof ModelParameterModal>['setModel']
  onMultipleModelConfigsChange: (multiple: boolean, modelConfigs: ModelAndParameter[]) => void
  onOpenAccountSettings: () => void
  onOpenDebugPanel: () => void
  onSaveHistory: (
    data: DebugConfigurationValue['completionPromptConfig']['conversation_histories_role'],
  ) => void
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
  const isLoadingCurrentWorkspace = useAtomValue(currentWorkspaceLoadingAtom)
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const currentUserId = useAtomValue(userProfileIdAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const [, setSettingsDestination] = useQueryState(settingsQueryParamName, settingsQueryParser)

  const { appDetail, showAppConfigureFeaturesModal, setShowAppConfigureFeaturesModal } =
    useAppStore(
      useShallow((state) => ({
        appDetail: state.appDetail,
        showAppConfigureFeaturesModal: state.showAppConfigureFeaturesModal,
        setShowAppConfigureFeaturesModal: state.setShowAppConfigureFeaturesModal,
      })),
    )
  const setDetailSidebarMode = useSetDetailSidebarMode()

  const { data: fileUploadConfigResponse } = useFileUploadConfig()
  const serverLatestPublishedAt = useMemo(() => appDetail?.model_config?.updated_at, [appDetail])
  const appACLCapabilities = useMemo(
    () =>
      getAppACLCapabilities(appDetail?.permission_keys, {
        currentUserId,
        resourceMaintainer: appDetail?.maintainer,
        workspacePermissionKeys,
      }),
    [appDetail?.maintainer, appDetail?.permission_keys, currentUserId, workspacePermissionKeys],
  )
  const configurationReadonly = !appACLCapabilities.canEdit
  const [formattingChanged, setFormattingChanged] = useState(false)
  const [hasFetchedDetail, setHasFetchedDetail] = useState(false)
  const pathname = usePathname()
  const matched = /\/app\/([^/]+)/.exec(pathname)
  const appId = matched?.[1] || ''
  const { mutateAsync: updateModelConfig } = useMutation({
    mutationFn: (params: Parameters<typeof updateAppModelConfig>[0]) =>
      updateAppModelConfig(params),
    onSuccess: (_data, _variables, _onMutateResult, context) =>
      context.client.invalidateQueries({
        queryKey: consoleQuery.apps.byAppId.get.queryKey({
          input: { params: { app_id: appId } },
        }),
      }),
  })
  const [publishedAtOverride, setPublishedAtOverride] = useState({
    appId,
    value: 0,
  })
  const latestPublishedAt =
    publishedAtOverride.appId === appId
      ? Math.max(serverLatestPublishedAt || 0, publishedAtOverride.value)
      : serverLatestPublishedAt
  const [mode, setMode] = useState<AppModeEnum>(AppModeEnum.CHAT)
  const [publishedConfig, setPublishedConfig] = useState<ConfigurationPublishConfig | null>(null)
  const [unpublishedChangesState, setUnpublishedChangesState] = useState({
    appId,
    value: false,
  })
  const hasUnpublishedChanges =
    unpublishedChangesState.appId === appId && unpublishedChangesState.value
  const [conversationId, setConversationId] = useState<string | null>('')
  const { eventEmitter } = useEventEmitterContextContext()
  const publishChangeTrackingAppIdRef = useRef('')
  const dispatchPublishDraftChanged = useCallback(() => {
    if (publishChangeTrackingAppIdRef.current !== appId) return
    eventEmitter?.emit({
      type: APP_PUBLISH_DRAFT_CHANGED,
      instanceId: appId,
    })
  }, [appId, eventEmitter])

  eventEmitter?.useSubscription((event) => {
    if (
      typeof event !== 'string' &&
      event.type === APP_PUBLISH_DRAFT_CHANGED &&
      event.instanceId === appId
    )
      setUnpublishedChangesState({ appId, value: true })
  })

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const [isShowDebugPanel, { setTrue: showDebugPanel, setFalse: hideDebugPanel }] =
    useBoolean(false)

  const [introduction, doSetIntroduction] = useState('')
  const setIntroduction = useCallback(
    (value: string) => {
      doSetIntroduction(value)
      dispatchPublishDraftChanged()
    },
    [dispatchPublishDraftChanged],
  )
  const [suggestedQuestions, doSetSuggestedQuestions] = useState<string[]>([])
  const setSuggestedQuestions = useCallback(
    (value: string[]) => {
      doSetSuggestedQuestions(value)
      dispatchPublishDraftChanged()
    },
    [dispatchPublishDraftChanged],
  )
  const [controlClearChatMessage, setControlClearChatMessage] = useState(0)
  const [prevPromptConfig, setPrevPromptConfig] = useState<PromptConfig>({
    prompt_template: '',
    prompt_variables: [],
  })
  const [moreLikeThisConfig, doSetMoreLikeThisConfig] = useState<MoreLikeThisConfig>({
    enabled: false,
  })
  const setMoreLikeThisConfig = useCallback(
    (value: MoreLikeThisConfig) => {
      doSetMoreLikeThisConfig(value)
      dispatchPublishDraftChanged()
    },
    [dispatchPublishDraftChanged],
  )
  const [suggestedQuestionsAfterAnswerConfig, doSetSuggestedQuestionsAfterAnswerConfig] =
    useState<MoreLikeThisConfig>({ enabled: false })
  const setSuggestedQuestionsAfterAnswerConfig = useCallback(
    (value: MoreLikeThisConfig) => {
      doSetSuggestedQuestionsAfterAnswerConfig(value)
      dispatchPublishDraftChanged()
    },
    [dispatchPublishDraftChanged],
  )
  const [speechToTextConfig, doSetSpeechToTextConfig] = useState<MoreLikeThisConfig>({
    enabled: false,
  })
  const setSpeechToTextConfig = useCallback(
    (value: MoreLikeThisConfig) => {
      doSetSpeechToTextConfig(value)
      dispatchPublishDraftChanged()
    },
    [dispatchPublishDraftChanged],
  )
  const [textToSpeechConfig, doSetTextToSpeechConfig] = useState<TextToSpeechConfig>({
    enabled: false,
    voice: '',
    language: '',
  })
  const setTextToSpeechConfig = useCallback(
    (value: TextToSpeechConfig) => {
      doSetTextToSpeechConfig(value)
      dispatchPublishDraftChanged()
    },
    [dispatchPublishDraftChanged],
  )
  const [citationConfig, doSetCitationConfig] = useState<MoreLikeThisConfig>({ enabled: false })
  const setCitationConfig = useCallback(
    (value: MoreLikeThisConfig) => {
      doSetCitationConfig(value)
      dispatchPublishDraftChanged()
    },
    [dispatchPublishDraftChanged],
  )
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
  const setAnnotationConfig = useCallback(
    (config: AnnotationReplyConfig, notSetFormatChanged?: boolean) => {
      doSetAnnotationConfig(config)
      if (!notSetFormatChanged) formattingChangedDispatcher()
    },
    [formattingChangedDispatcher],
  )

  const [moderationConfig, doSetModerationConfig] = useState<ModerationConfig>({ enabled: false })
  const setModerationConfig = useCallback(
    (value: ModerationConfig) => {
      doSetModerationConfig(value)
      dispatchPublishDraftChanged()
    },
    [dispatchPublishDraftChanged],
  )
  const [externalDataToolsConfig, doSetExternalDataToolsConfig] = useState<ExternalDataTool[]>([])
  const setExternalDataToolsConfig = useCallback(
    (value: ExternalDataTool[]) => {
      doSetExternalDataToolsConfig(value)
      dispatchPublishDraftChanged()
    },
    [dispatchPublishDraftChanged],
  )
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

  const setCompletionParams = useCallback(
    (value: FormValue) => {
      const params = { ...value }
      if (
        (!params.stop || params.stop.length === 0) &&
        modeModeTypeRef.current === ModelModeType.completion
      ) {
        params.stop = getTempStop()
        setTempStop([])
      }
      doSetCompletionParams(params)
      dispatchPublishDraftChanged()
    },
    [dispatchPublishDraftChanged, getTempStop, setTempStop],
  )

  const setModelConfig = useCallback(
    (newModelConfig: ModelConfig) => {
      doSetModelConfig(newModelConfig)
      dispatchPublishDraftChanged()
    },
    [dispatchPublishDraftChanged],
  )

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
  const setDatasetConfigs = useCallback(
    (newDatasetConfigs: DatasetConfigs) => {
      doSetDatasetConfigs(newDatasetConfigs)
      datasetConfigsRef.current = newDatasetConfigs
      dispatchPublishDraftChanged()
    },
    [dispatchPublishDraftChanged],
  )

  const [dataSets, doSetDataSets] = useState<DataSet[]>([])
  const setDataSets = useCallback(
    (value: DataSet[]) => {
      doSetDataSets(value)
      dispatchPublishDraftChanged()
    },
    [dispatchPublishDraftChanged],
  )
  const contextVar = modelConfig.configs.prompt_variables.find((item) => item.is_context_var)?.key
  const hasSetContextVar = !!contextVar
  const [isShowSelectDataSet, { setTrue: showSelectDataSet, setFalse: hideSelectDataSet }] =
    useBoolean(false)
  const selectedIds = dataSets.map((item) => item.id)
  const [rerankSettingModalOpen, setRerankSettingModalOpen] = useState(false)
  const [isShowHistoryModal, { setTrue: showHistoryModal, setFalse: hideHistoryModal }] =
    useBoolean(false)
  const [showUseGPT4Confirm, setShowUseGPT4Confirm] = useState(false)

  const { currentModel: currentRerankModel, currentProvider: currentRerankProvider } =
    useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)

  const { isAPIKeySet } = useProviderContext()
  const { currentModel: currModel } = useTextGenerationCurrentProviderAndModelAndModelList({
    provider: modelConfig.provider,
    model: modelConfig.model_id,
  })
  const resolvedModelModeType =
    (modelModeType ||
      (hasFetchedDetail
        ? (currModel?.model_properties.mode as ModelModeType | undefined)
        : undefined)) ??
    ModelModeType.unset

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

  const handleSetVisionConfig = useCallback(
    (config: VisionSettings, notNoticeFormattingChanged?: boolean) => {
      doSetVisionConfig({
        enabled: config.enabled || false,
        number_limits: config.number_limits || 2,
        detail: config.detail || Resolution.low,
        transfer_methods: config.transfer_methods || [TransferMethod.local_file],
      })
      dispatchPublishDraftChanged()
      if (!notNoticeFormattingChanged) formattingChangedDispatcher()
    },
    [dispatchPublishDraftChanged, formattingChangedDispatcher],
  )

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
    onPublishConfigChange: dispatchPublishDraftChanged,
  })

  const syncToPublishedConfig = useCallback(
    (_publishedConfig: ConfigurationPublishConfig) => {
      const trackedAppId = publishChangeTrackingAppIdRef.current
      publishChangeTrackingAppIdRef.current = ''

      try {
        const publishedModelConfig = _publishedConfig.modelConfig
        setModelConfig(publishedModelConfig)
        setCompletionParams(_publishedConfig.completionParams)
        doSetPromptMode(_publishedConfig.promptMode)
        setCanReturnToSimpleMode(_publishedConfig.promptMode !== PromptMode.advanced)
        setChatPromptConfig(_publishedConfig.chatPromptConfig)
        setCompletionPromptConfig(_publishedConfig.completionPromptConfig)
        setDataSets(publishedModelConfig.dataSets || [])
        setDatasetConfigs(_publishedConfig.datasetConfigs)
        setExternalDataToolsConfig(_publishedConfig.externalDataToolsConfig)
        setIntroduction(publishedModelConfig.opening_statement || '')
        setSuggestedQuestions(publishedModelConfig.suggested_questions || [])
        setMoreLikeThisConfig(publishedModelConfig.more_like_this || { enabled: false })
        setSuggestedQuestionsAfterAnswerConfig(
          publishedModelConfig.suggested_questions_after_answer || { enabled: false },
        )
        setSpeechToTextConfig(publishedModelConfig.speech_to_text || { enabled: false })
        setTextToSpeechConfig(
          publishedModelConfig.text_to_speech || {
            enabled: false,
            voice: '',
            language: '',
          },
        )
        setCitationConfig(publishedModelConfig.retriever_resource || { enabled: false })
        setModerationConfig(publishedModelConfig.sensitive_word_avoidance || { enabled: false })
        const publishedVisionConfig = publishedModelConfig.file_upload?.image
        handleSetVisionConfig(
          {
            enabled: publishedVisionConfig?.enabled || false,
            number_limits: publishedVisionConfig?.number_limits || 2,
            detail: publishedVisionConfig?.detail || Resolution.low,
            transfer_methods: publishedVisionConfig?.transfer_methods || [
              TransferMethod.local_file,
            ],
          },
          true,
        )
      } finally {
        publishChangeTrackingAppIdRef.current = trackedAppId
      }
    },
    [
      handleSetVisionConfig,
      setChatPromptConfig,
      setCitationConfig,
      setCompletionParams,
      setCompletionPromptConfig,
      setDataSets,
      setDatasetConfigs,
      setExternalDataToolsConfig,
      setIntroduction,
      setModelConfig,
      setModerationConfig,
      setMoreLikeThisConfig,
      setSpeechToTextConfig,
      setSuggestedQuestions,
      setSuggestedQuestionsAfterAnswerConfig,
      setTextToSpeechConfig,
    ],
  )

  const setPromptMode = useCallback(
    async (nextMode: PromptMode) => {
      if (nextMode === PromptMode.advanced) {
        await migrateToDefaultPrompt()
        setCanReturnToSimpleMode(true)
      }
      doSetPromptMode(nextMode)
      dispatchPublishDraftChanged()
    },
    [dispatchPublishDraftChanged, migrateToDefaultPrompt],
  )

  const handleSelect = useCallback(
    createDatasetSelectHandler({
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
    }),
    [
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
    ],
  )

  const setModel = useCallback(
    createModelChangeHandler({
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
    }),
    [
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
    ],
  )

  const isShowVisionConfig = !!currModel?.features?.includes(ModelFeatureEnum.vision)
  const isShowDocumentConfig = !!currModel?.features?.includes(ModelFeatureEnum.document)
  const isShowAudioConfig = !!currModel?.features?.includes(ModelFeatureEnum.audio)
  const isAllowVideoUpload = !!currModel?.features?.includes(ModelFeatureEnum.video)

  const featuresData = useMemo(
    () => buildConfigurationFeaturesData(modelConfig, fileUploadConfigResponse),
    [fileUploadConfigResponse, modelConfig],
  )

  const handleFeaturesChange = useCallback<OnFeaturesChange>(
    (features) => {
      setShowAppConfigureFeaturesModal(true)
      if (features) formattingChangedDispatcher()
    },
    [formattingChangedDispatcher, setShowAppConfigureFeaturesModal],
  )
  const handleFeatureStoreChange = useCallback<OnFeaturesChange>(
    (features) => {
      if (features) dispatchPublishDraftChanged()
    },
    [dispatchPublishDraftChanged],
  )

  const handleAddPromptVariable = useCallback(
    (variables: PromptVariable[]) => {
      setModelConfig(
        produce(modelConfig, (draft: ModelConfig) => {
          draft.configs.prompt_variables = [...draft.configs.prompt_variables, ...variables]
        }),
      )
    },
    [modelConfig, setModelConfig],
  )

  useEffect(() => {
    publishChangeTrackingAppIdRef.current = ''
    void (async () => {
      const configurationState = await loadConfigurationState({
        appId,
        basePath,
        currentRerankModel: currentRerankModel?.model,
        currentRerankProvider: currentRerankProvider?.provider,
      })

      setCollectionList(configurationState.collectionList)
      setMode(configurationState.mode)
      syncToPublishedConfig(configurationState.publishedConfig)

      if (configurationState.annotationConfig)
        setAnnotationConfig(configurationState.annotationConfig, true)

      setPublishedConfig(configurationState.publishedConfig)
      setUnpublishedChangesState({ appId, value: false })
      publishChangeTrackingAppIdRef.current = appId
      setHasFetchedDetail(true)
    })()
  }, [appId])

  const { promptEmpty, cannotPublish, contextVarEmpty } = useMemo(
    () =>
      getConfigurationPublishingState({
        chatPromptConfig,
        completionPromptConfig,
        hasSetBlockStatus,
        hasSetContextVar,
        hasSelectedDataSets: dataSets.length > 0,
        isAdvancedMode,
        mode,
        modelModeType: resolvedModelModeType,
        promptTemplate: modelConfig.configs.prompt_template,
      }),
    [
      chatPromptConfig,
      completionPromptConfig,
      dataSets.length,
      hasSetBlockStatus,
      hasSetContextVar,
      isAdvancedMode,
      mode,
      modelConfig.configs.prompt_template,
      resolvedModelModeType,
    ],
  )

  const onPublish = useCallback(
    async (params?: AppPublisherPublishParams, features?: FeaturesData) => {
      if (!appACLCapabilities.canReleaseAndVersion) return

      const modelAndParameter =
        params && 'model' in params && 'provider' in params && 'parameters' in params
          ? params
          : undefined
      const handlePublishedConfigChange = (config: ConfigurationPublishConfig) => {
        setPublishedConfig(config)
        if (modelAndParameter) syncToPublishedConfig(config)
      }

      const result = await createPublishHandler({
        appId,
        chatPromptConfig,
        completionParamsState,
        completionPromptConfig,
        contextVar,
        contextVarEmpty,
        dataSets,
        datasetConfigs,
        externalDataToolsConfig,
        hasSetBlockStatus,
        isAdvancedMode,
        isFunctionCall,
        mode,
        modelConfig,
        promptEmpty,
        promptMode,
        resolvedModelModeType,
        setCanReturnToSimpleMode,
        setPublishedConfig: handlePublishedConfigChange,
        t,
      })(updateModelConfig, modelAndParameter, features)

      if (result) {
        setUnpublishedChangesState({ appId, value: false })
        // The publish API currently returns only a result flag, so keep the summary current
        // locally until app detail is refreshed with the server-side updated_at value.
        setPublishedAtOverride({ appId, value: Math.floor(Date.now() / 1000) })
      }
      return result
    },
    [
      appACLCapabilities.canReleaseAndVersion,
      appId,
      chatPromptConfig,
      completionParamsState,
      completionPromptConfig,
      contextVar,
      contextVarEmpty,
      dataSets,
      datasetConfigs,
      externalDataToolsConfig,
      hasSetBlockStatus,
      isAdvancedMode,
      isFunctionCall,
      mode,
      modelConfig,
      promptEmpty,
      promptMode,
      resolvedModelModeType,
      setCanReturnToSimpleMode,
      syncToPublishedConfig,
      t,
      updateModelConfig,
    ],
  )

  const { debugWithMultipleModel, multipleModelConfigs, handleMultipleModelConfigsChange } =
    useDebugWithSingleOrMultipleModel(appId)

  const handleDebugWithMultipleModelChange = useCallback(() => {
    handleMultipleModelConfigsChange(true, [
      {
        id: `${Date.now()}`,
        model: modelConfig.model_id,
        provider: modelConfig.provider,
        parameters: completionParamsState,
      },
      { id: `${Date.now()}-no-repeat`, model: '', provider: '', parameters: {} },
    ])
    setDetailSidebarMode('collapse')
  }, [
    completionParamsState,
    handleMultipleModelConfigsChange,
    modelConfig.model_id,
    modelConfig.provider,
    setDetailSidebarMode,
  ])

  const onAgentSettingChange = useCallback(
    (config: ModelConfig['agentConfig']) => {
      setModelConfig(
        produce(modelConfig, (draft: ModelConfig) => {
          draft.agentConfig = config
        }),
      )
    },
    [modelConfig, setModelConfig],
  )

  const contextValue: DebugConfigurationValue = {
    readonly: configurationReadonly,
    canTestAndRun: appACLCapabilities.canTestAndRun,
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
      disabled: !appACLCapabilities.canReleaseAndVersion,
      publishDisabled: cannotPublish || !appACLCapabilities.canReleaseAndVersion,
      publishedAt: (latestPublishedAt || 0) * 1000,
      hasUnpublishedChanges: !latestPublishedAt || hasUnpublishedChanges,
      debugWithMultipleModel,
      multipleModelConfigs,
      onPublish,
      publishedConfig: publishedConfig as ConfigurationPublishConfig,
      resetAppConfig: () => {
        if (!publishedConfig) return
        syncToPublishedConfig(publishedConfig)
        setUnpublishedChangesState({ appId, value: false })
      },
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
      setSettingsDestination('provider')
      setShowUseGPT4Confirm(false)
    },
    onEnableMultipleModelDebug: handleDebugWithMultipleModelChange,
    onFeatureStoreChange: handleFeatureStoreChange,
    onFeaturesChange: handleFeaturesChange,
    onHideDebugPanel: hideDebugPanel,
    onModelChange: setModel,
    onMultipleModelConfigsChange: handleMultipleModelConfigsChange,
    onOpenAccountSettings: () => setSettingsDestination('provider'),
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
