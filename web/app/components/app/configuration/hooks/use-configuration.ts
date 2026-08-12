'use client'
import type { ConfigurationPublishConfig } from './configuration-lifecycle/types'
import type { ConfigurationViewModel } from './configuration-view-model'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import type { Collection } from '@/app/components/tools/types'
import type { Inputs, ModelConfig, PromptConfig, PromptVariable } from '@/models/debug'
import { useBoolean } from 'ahooks'
import { produce } from 'immer'
import { useQueryState } from 'nuqs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useAdvancedPromptConfig from '@/app/components/app/configuration/hooks/use-advanced-prompt-config'
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
import { useProviderContext } from '@/context/provider-context'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { PromptMode } from '@/models/debug'
import { useFileUploadConfig } from '@/service/use-common'
import { AppModeEnum, ModelModeType } from '@/types/app'
import { supportFunctionCall } from '@/utils/tool-call'
import { buildConfigurationFeaturesData, getConfigurationPublishingState } from '../utils'
import { buildConfigurationContextValue } from './build-configuration-context'
import { useDatasetSelectHandler } from './configuration-lifecycle/dataset'
import { useModelChangeHandler } from './configuration-lifecycle/model'
import { useConfigurationAppContext } from './configuration-lifecycle/use-configuration-app-context'
import { useConfigurationLoader } from './configuration-lifecycle/use-configuration-loader'
import { useConfigurationPublish } from './configuration-lifecycle/use-configuration-publish'
import { useDatasetConfigurationState } from './configuration-lifecycle/use-dataset-configuration-state'
import { useFeatureConfigurationState } from './configuration-lifecycle/use-feature-configuration-state'
import { useModelConfigurationState } from './configuration-lifecycle/use-model-configuration-state'
import { useMultipleModelDebug } from './configuration-lifecycle/use-multiple-model-debug'
import { usePublishedConfigSync } from './configuration-lifecycle/use-published-config-sync'

export const useConfiguration = (): ConfigurationViewModel => {
  const { t } = useTranslation()
  const [_settingsDestination, setSettingsDestination] = useQueryState(
    settingsQueryParamName,
    settingsQueryParser,
  )
  const {
    appACLCapabilities,
    appId,
    configurationReadonly,
    currentWorkspace,
    isLoadingCurrentWorkspace,
    serverLatestPublishedAt,
    setShowAppConfigureFeaturesModal,
    showAppConfigureFeaturesModal,
    updateModelConfig,
  } = useConfigurationAppContext()
  const { data: fileUploadConfigResponse } = useFileUploadConfig()
  const [formattingChanged, setFormattingChanged] = useState(false)
  const [hasFetchedDetail, setHasFetchedDetail] = useState(false)
  // oxlint-disable-next-line eslint-react/use-state -- This custom hook returns a state object.
  const featureConfiguration = useFeatureConfigurationState()
  const [mode, setMode] = useState<AppModeEnum>(AppModeEnum.CHAT)
  const [publishedConfig, setPublishedConfig] = useState<ConfigurationPublishConfig | null>(null)
  const [conversationId, setConversationId] = useState<string | null>('')

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const [isShowDebugPanel, { setTrue: showDebugPanel, setFalse: hideDebugPanel }] =
    useBoolean(false)

  const {
    externalDataToolsConfig,
    formattingChangedDispatcher,
    setAnnotationConfig,
    setCitationConfig,
    setExternalDataToolsConfig,
    setIntroduction,
    setModerationConfig,
    setMoreLikeThisConfig,
    setSpeechToTextConfig,
    setSuggestedQuestions,
    setSuggestedQuestionsAfterAnswerConfig,
    setTextToSpeechConfig,
  } = featureConfiguration
  const [controlClearChatMessage, setControlClearChatMessage] = useState(0)
  const [prevPromptConfig, setPrevPromptConfig] = useState<PromptConfig>({
    prompt_template: '',
    prompt_variables: [],
  })
  const [inputs, setInputs] = useState<Inputs>({})
  const [query, setQuery] = useState('')
  // oxlint-disable-next-line eslint-react/use-state -- This custom hook returns a state object.
  const modelConfiguration = useModelConfigurationState({
    formattingChangedDispatcher,
  })
  const {
    completionParams: completionParamsState,
    modelConfig,
    modelModeTypeRef,
    setCompletionParams,
    setModelConfig,
    setTempStop,
    setVisionConfig: handleSetVisionConfig,
    visionConfig,
  } = modelConfiguration
  const modelModeType = modelConfig.mode
  const isAgent = mode === AppModeEnum.AGENT_CHAT

  const [collectionList, setCollectionList] = useState<Collection[]>([])
  // oxlint-disable-next-line eslint-react/use-state -- This custom hook returns a state object.
  const datasetConfiguration = useDatasetConfigurationState()
  const { dataSets, datasetConfigs, datasetConfigsRef, setDataSets, setDatasetConfigs } =
    datasetConfiguration
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
    modelModeTypeRef.current = resolvedModelModeType
  }, [modelModeTypeRef, resolvedModelModeType])

  const [promptMode, setPromptMode] = useState(PromptMode.simple)
  const isAdvancedMode = promptMode === PromptMode.advanced
  const [canReturnToSimpleMode, setCanReturnToSimpleMode] = useState(true)

  const advancedPromptConfiguration = useAdvancedPromptConfig({
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
  const {
    chatPromptConfig,
    setChatPromptConfig,
    completionPromptConfig,
    setCompletionPromptConfig,
    hasSetBlockStatus,
    setConversationHistoriesRole,
    migrateToDefaultPrompt,
  } = advancedPromptConfiguration

  const syncToPublishedConfig = usePublishedConfigSync({
    setCanReturnToSimpleMode,
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
    setPromptModeState: setPromptMode,
    setSpeechToTextConfig,
    setSuggestedQuestions,
    setSuggestedQuestionsAfterAnswerConfig,
    setTextToSpeechConfig,
    setVisionConfig: handleSetVisionConfig,
  })

  const handlePromptModeChange = useCallback(
    async (nextMode: PromptMode) => {
      if (nextMode === PromptMode.advanced) {
        await migrateToDefaultPrompt()
        setCanReturnToSimpleMode(true)
      }
      setPromptMode(nextMode)
    },
    [migrateToDefaultPrompt],
  )

  const handleSelect = useDatasetSelectHandler({
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
  })

  const setModel = useModelChangeHandler({
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
  })

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

  useConfigurationLoader({
    appId,
    currentRerankModel: currentRerankModel?.model,
    currentRerankProvider: currentRerankProvider?.provider,
    setAnnotationConfig,
    setCollectionList,
    setHasFetchedDetail,
    setMode,
    setPublishedConfig,
    syncToPublishedConfig,
  })

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

  const onPublish = useConfigurationPublish({
    appId,
    canReleaseAndVersion: appACLCapabilities.canReleaseAndVersion,
    chatPromptConfig,
    completionParams: completionParamsState,
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
    setPublishedConfig,
    syncToPublishedConfig,
    t,
    updateModelConfig,
  })

  const {
    debugWithMultipleModel,
    enableMultipleModelDebug,
    handleMultipleModelConfigsChange,
    multipleModelConfigs,
  } = useMultipleModelDebug({
    appId,
    completionParams: completionParamsState,
    modelConfig,
  })

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

  const contextValue = buildConfigurationContextValue({
    advancedPrompt: advancedPromptConfiguration,
    dataset: datasetConfiguration,
    feature: featureConfiguration,
    model: modelConfiguration,
    base: {
      appId,
      canReturnToSimpleMode,
      canTestAndRun: appACLCapabilities.canTestAndRun,
      collectionList,
      controlClearChatMessage,
      conversationId,
      formattingChanged,
      hasSetContextVar,
      inputs,
      isAdvancedMode,
      isAgent,
      isAllowVideoUpload,
      isAPIKeySet,
      isFunctionCall,
      isOpenAI: modelConfig.provider === 'langgenius/openai/openai',
      isShowAudioConfig,
      isShowDocumentConfig,
      isShowVisionConfig,
      isTrailFinished: false,
      mode,
      modelModeType: resolvedModelModeType,
      prevPromptConfig,
      promptMode,
      query,
      readonly: configurationReadonly,
      rerankSettingModalOpen,
      setCanReturnToSimpleMode,
      setControlClearChatMessage,
      setConversationId,
      setFormattingChanged,
      setInputs,
      setPrevPromptConfig,
      setPromptMode: handlePromptModeChange,
      setQuery,
      setRerankSettingModalOpen,
      showHistoryModal,
      showSelectDataSet,
    },
  })

  return {
    appPublisherProps: {
      disabled: !appACLCapabilities.canReleaseAndVersion,
      publishDisabled: cannotPublish || !appACLCapabilities.canReleaseAndVersion,
      publishedAt: (serverLatestPublishedAt || 0) * 1000,
      debugWithMultipleModel,
      multipleModelConfigs,
      onPublish,
      publishedConfig: publishedConfig as ConfigurationPublishConfig,
      resetAppConfig: () => {
        if (!publishedConfig) return
        syncToPublishedConfig(publishedConfig)
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
    onEnableMultipleModelDebug: enableMultipleModelDebug,
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
