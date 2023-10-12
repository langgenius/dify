'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { usePathname } from 'next/navigation'
import produce from 'immer'
import { useBoolean } from 'ahooks'
import cn from 'classnames'
import { clone, isEqual } from 'lodash-es'
import Button from '../../base/button'
import Loading from '../../base/loading'
import s from './style.module.css'
import useAdvancedPromptConfig from './hooks/use-advanced-prompt-config'
import EditHistoryModal from './config-prompt/conversation-histroy/edit-modal'
import type { CompletionParams, DatasetConfigs, Inputs, ModelConfig, MoreLikeThisConfig, PromptConfig, PromptVariable } from '@/models/debug'
import type { DataSet } from '@/models/datasets'
import type { ModelConfig as BackendModelConfig } from '@/types/app'
import ConfigContext from '@/context/debug-configuration'
import ConfigModel from '@/app/components/app/configuration/config-model'
import Config from '@/app/components/app/configuration/config'
import Debug from '@/app/components/app/configuration/debug'
import Confirm from '@/app/components/base/confirm'
import { ProviderEnum } from '@/app/components/header/account-setting/model-page/declarations'
import { ToastContext } from '@/app/components/base/toast'
import { fetchAppDetail, updateAppModelConfig } from '@/service/apps'
import { promptVariablesToUserInputsForm, userInputsFormToPromptVariables } from '@/utils/model-config'
import { fetchDatasets } from '@/service/datasets'
import AccountSetting from '@/app/components/header/account-setting'
import { useProviderContext } from '@/context/provider-context'
import { AppType, ModelModeType } from '@/types/app'
import { FlipBackward } from '@/app/components/base/icons/src/vender/line/arrows'
import { PromptMode } from '@/models/debug'
import { DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import SelectDataSet from '@/app/components/app/configuration/dataset-config/select-dataset'

type PublichConfig = {
  modelConfig: ModelConfig
  completionParams: CompletionParams
}

const Configuration: FC = () => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)

  const [hasFetchedDetail, setHasFetchedDetail] = useState(false)
  const isLoading = !hasFetchedDetail
  const pathname = usePathname()
  const matched = pathname.match(/\/app\/([^/]+)/)
  const appId = (matched?.length && matched[1]) ? matched[1] : ''
  const [mode, setMode] = useState('')
  const [publishedConfig, setPublishedConfig] = useState<PublichConfig | null>(null)

  const [conversationId, setConversationId] = useState<string | null>('')

  const [introduction, setIntroduction] = useState<string>('')
  const [controlClearChatMessage, setControlClearChatMessage] = useState(0)
  const [prevPromptConfig, setPrevPromptConfig] = useState<PromptConfig>({
    prompt_template: '',
    prompt_variables: [],
  })
  const [moreLikeThisConfig, setMoreLikeThisConfig] = useState<MoreLikeThisConfig>({
    enabled: false,
  })
  const [suggestedQuestionsAfterAnswerConfig, setSuggestedQuestionsAfterAnswerConfig] = useState<MoreLikeThisConfig>({
    enabled: false,
  })
  const [speechToTextConfig, setSpeechToTextConfig] = useState<MoreLikeThisConfig>({
    enabled: false,
  })
  const [citationConfig, setCitationConfig] = useState<MoreLikeThisConfig>({
    enabled: false,
  })
  const [formattingChanged, setFormattingChanged] = useState(false)
  const [inputs, setInputs] = useState<Inputs>({})
  const [query, setQuery] = useState('')
  const [completionParams, setCompletionParams] = useState<CompletionParams>({
    max_tokens: 16,
    temperature: 1, // 0-2
    top_p: 1,
    presence_penalty: 1, // -2-2
    frequency_penalty: 1, // -2-2
  })
  const [modelConfig, doSetModelConfig] = useState<ModelConfig>({
    provider: ProviderEnum.openai,
    model_id: 'gpt-3.5-turbo',
    mode: ModelModeType.unset,
    configs: {
      prompt_template: '',
      prompt_variables: [] as PromptVariable[],
    },
    opening_statement: '',
    more_like_this: null,
    suggested_questions_after_answer: null,
    speech_to_text: null,
    retriever_resource: null,
    dataSets: [],
  })

  const [datasetConfigs, setDatasetConfigs] = useState<DatasetConfigs>({
    top_k: 2,
    score_threshold: {
      enable: false,
      value: 0.7,
    },
  })

  const setModelConfig = (newModelConfig: ModelConfig) => {
    doSetModelConfig(newModelConfig)
  }

  const modelModeType = modelConfig.mode

  const [dataSets, setDataSets] = useState<DataSet[]>([])
  const contextVar = modelConfig.configs.prompt_variables.find(item => item.is_context_var)?.key
  const hasSetContextVar = !!contextVar
  const [isShowSelectDataSet, { setTrue: showSelectDataSet, setFalse: hideSelectDataSet }] = useBoolean(false)
  const selectedIds = dataSets.map(item => item.id)
  const handleSelect = (data: DataSet[]) => {
    if (isEqual(data.map(item => item.id), dataSets.map(item => item.id))) {
      hideSelectDataSet()
      return
    }

    setFormattingChanged(true)
    if (data.find(item => !item.name)) { // has not loaded selected dataset
      const newSelected = produce(data, (draft) => {
        data.forEach((item, index) => {
          if (!item.name) { // not fetched database
            const newItem = dataSets.find(i => i.id === item.id)
            if (newItem)
              draft[index] = newItem
          }
        })
      })
      setDataSets(newSelected)
    }
    else {
      setDataSets(data)
    }
    hideSelectDataSet()
  }

  const [isShowHistoryModal, { setTrue: showHistoryModal, setFalse: hideHistoryModal }] = useBoolean(false)

  const syncToPublishedConfig = (_publishedConfig: PublichConfig) => {
    const modelConfig = _publishedConfig.modelConfig
    setModelConfig(_publishedConfig.modelConfig)
    setCompletionParams(_publishedConfig.completionParams)
    setDataSets(modelConfig.dataSets || [])
    // feature
    setIntroduction(modelConfig.opening_statement!)
    setMoreLikeThisConfig(modelConfig.more_like_this || {
      enabled: false,
    })
    setSuggestedQuestionsAfterAnswerConfig(modelConfig.suggested_questions_after_answer || {
      enabled: false,
    })
    setSpeechToTextConfig(modelConfig.speech_to_text || {
      enabled: false,
    })
    setCitationConfig(modelConfig.retriever_resource || {
      enabled: false,
    })
  }

  const { textGenerationModelList } = useProviderContext()
  const hasSetCustomAPIKEY = !!textGenerationModelList?.find(({ model_provider: provider }) => {
    if (provider.provider_type === 'system' && provider.quota_type === 'paid')
      return true

    if (provider.provider_type === 'custom')
      return true

    return false
  })
  const isTrailFinished = !hasSetCustomAPIKEY && textGenerationModelList
    .filter(({ model_provider: provider }) => provider.quota_type === 'trial')
    .every(({ model_provider: provider }) => {
      const { quota_used, quota_limit } = provider
      return quota_used === quota_limit
    })

  // Fill old app data missing model mode.
  useEffect(() => {
    if (hasFetchedDetail && !modelModeType) {
      const mode = textGenerationModelList.find(({ model_name }) => model_name === modelConfig.model_id)?.model_mode
      if (mode) {
        const newModelConfig = produce(modelConfig, (draft) => {
          draft.mode = mode
        })
        setModelConfig(newModelConfig)
      }
    }
  }, [textGenerationModelList, hasFetchedDetail])

  const hasSetAPIKEY = hasSetCustomAPIKEY || !isTrailFinished

  const [isShowSetAPIKey, { setTrue: showSetAPIKey, setFalse: hideSetAPIkey }] = useBoolean()
  const [promptMode, doSetPromptMode] = useState(PromptMode.advanced)
  const isAdvancedMode = promptMode === PromptMode.advanced
  const [canReturnToSimpleMode, setCanReturnToSimpleMode] = useState(true)
  const setPromptMode = async (mode: PromptMode) => {
    if (mode === PromptMode.advanced) {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      await migrateToDefaultPrompt()
      setCanReturnToSimpleMode(true)
    }

    doSetPromptMode(mode)
  }

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
    modelModeType,
    prePrompt: modelConfig.configs.prompt_template,
    onUserChangedPrompt: () => {
      setCanReturnToSimpleMode(false)
    },
  })

  const setModel = async ({
    id: modelId,
    provider,
    mode: modeMode,
  }: { id: string; provider: ProviderEnum; mode: ModelModeType }) => {
    if (isAdvancedMode) {
      const appMode = mode

      if (modeMode === ModelModeType.completion) {
        if (appMode === AppType.chat) {
          if (!completionPromptConfig.prompt.text || !completionPromptConfig.conversation_histories_role.assistant_prefix || !completionPromptConfig.conversation_histories_role.user_prefix)
            await migrateToDefaultPrompt(true, ModelModeType.completion)
        }
        else {
          if (!completionPromptConfig.prompt.text)
            await migrateToDefaultPrompt(true, ModelModeType.completion)
        }
      }
      if (modeMode === ModelModeType.chat) {
        if (chatPromptConfig.prompt.length === 0)
          await migrateToDefaultPrompt(true, ModelModeType.chat)
      }
    }
    const newModelConfig = produce(modelConfig, (draft) => {
      draft.provider = provider
      draft.model_id = modelId
      draft.mode = modeMode
    })

    setModelConfig(newModelConfig)
  }

  useEffect(() => {
    fetchAppDetail({ url: '/apps', id: appId }).then(async (res) => {
      setMode(res.mode)
      const modelConfig = res.model_config
      const promptMode = modelConfig.prompt_type === PromptMode.advanced ? PromptMode.advanced : PromptMode.simple
      doSetPromptMode(promptMode)
      if (promptMode === PromptMode.advanced) {
        setChatPromptConfig(modelConfig.chat_prompt_config || clone(DEFAULT_CHAT_PROMPT_CONFIG) as any)
        setCompletionPromptConfig(modelConfig.completion_prompt_config || clone(DEFAULT_COMPLETION_PROMPT_CONFIG) as any)
        setCanReturnToSimpleMode(false)
      }

      const model = res.model_config.model

      let datasets: any = null
      if (modelConfig.agent_mode?.enabled)
        datasets = modelConfig.agent_mode?.tools.filter(({ dataset }: any) => dataset?.enabled)

      if (dataSets && datasets?.length && datasets?.length > 0) {
        const { data: dataSetsWithDetail } = await fetchDatasets({ url: '/datasets', params: { page: 1, ids: datasets.map(({ dataset }: any) => dataset.id) } })
        datasets = dataSetsWithDetail
        setDataSets(datasets)
      }

      setIntroduction(modelConfig.opening_statement)
      if (modelConfig.more_like_this)
        setMoreLikeThisConfig(modelConfig.more_like_this)

      if (modelConfig.suggested_questions_after_answer)
        setSuggestedQuestionsAfterAnswerConfig(modelConfig.suggested_questions_after_answer)

      if (modelConfig.speech_to_text)
        setSpeechToTextConfig(modelConfig.speech_to_text)

      if (modelConfig.retriever_resource)
        setCitationConfig(modelConfig.retriever_resource)

      const config = {
        modelConfig: {
          provider: model.provider,
          model_id: model.name,
          mode: model.mode,
          configs: {
            prompt_template: modelConfig.pre_prompt,
            prompt_variables: userInputsFormToPromptVariables(modelConfig.user_input_form, modelConfig.dataset_query_variable),
          },
          opening_statement: modelConfig.opening_statement,
          more_like_this: modelConfig.more_like_this,
          suggested_questions_after_answer: modelConfig.suggested_questions_after_answer,
          speech_to_text: modelConfig.speech_to_text,
          retriever_resource: modelConfig.retriever_resource,
          dataSets: datasets || [],
        },
        completionParams: model.completion_params,
      }
      syncToPublishedConfig(config)
      setPublishedConfig(config)

      setHasFetchedDetail(true)
    })
  }, [appId])

  const promptEmpty = (() => {
    if (mode === AppType.chat)
      return false

    if (isAdvancedMode)
      return !completionPromptConfig.prompt.text

    else
      return !modelConfig.configs.prompt_template
  })()
  const cannotPublish = (() => {
    if (mode === AppType.chat) {
      if (!isAdvancedMode)
        return false

      if (modelModeType === ModelModeType.completion) {
        if (!hasSetBlockStatus.history || !hasSetBlockStatus.query)
          return true

        return false
      }

      return false
    }
    else { return promptEmpty }
  })()
  const contextVarEmpty = mode === AppType.completion && dataSets.length > 0 && !hasSetContextVar
  const handlePublish = async (isSilence?: boolean) => {
    const modelId = modelConfig.model_id
    const promptTemplate = modelConfig.configs.prompt_template
    const promptVariables = modelConfig.configs.prompt_variables

    if (promptEmpty) {
      notify({ type: 'error', message: t('appDebug.otherError.promptNoBeEmpty'), duration: 3000 })
      return
    }
    if (isAdvancedMode && mode === AppType.chat) {
      if (modelModeType === ModelModeType.completion) {
        if (!hasSetBlockStatus.history) {
          notify({ type: 'error', message: t('appDebug.otherError.historyNoBeEmpty'), duration: 3000 })
          return
        }
        if (!hasSetBlockStatus.query) {
          notify({ type: 'error', message: t('appDebug.otherError.queryNoBeEmpty'), duration: 3000 })
          return
        }
      }
    }
    if (contextVarEmpty) {
      notify({ type: 'error', message: t('appDebug.feature.dataSet.queryVariable.contextVarNotEmpty'), duration: 3000 })
      return
    }
    const postDatasets = dataSets.map(({ id }) => ({
      dataset: {
        enabled: true,
        id,
      },
    }))

    // new model config data struct
    const data: BackendModelConfig = {
      // Simple Mode prompt
      pre_prompt: !isAdvancedMode ? promptTemplate : '',
      prompt_type: promptMode,
      chat_prompt_config: {},
      completion_prompt_config: {},
      user_input_form: promptVariablesToUserInputsForm(promptVariables),
      dataset_query_variable: contextVar || '',
      opening_statement: introduction || '',
      more_like_this: moreLikeThisConfig,
      suggested_questions_after_answer: suggestedQuestionsAfterAnswerConfig,
      speech_to_text: speechToTextConfig,
      retriever_resource: citationConfig,
      agent_mode: {
        enabled: true,
        tools: [...postDatasets],
      },
      model: {
        provider: modelConfig.provider,
        name: modelId,
        mode: modelConfig.mode,
        completion_params: completionParams as any,
      },
      dataset_configs: datasetConfigs,
    }

    if (isAdvancedMode) {
      data.chat_prompt_config = chatPromptConfig
      data.completion_prompt_config = completionPromptConfig
    }

    await updateAppModelConfig({ url: `/apps/${appId}/model-config`, body: data })
    const newModelConfig = produce(modelConfig, (draft: any) => {
      draft.opening_statement = introduction
      draft.more_like_this = moreLikeThisConfig
      draft.suggested_questions_after_answer = suggestedQuestionsAfterAnswerConfig
      draft.speech_to_text = speechToTextConfig
      draft.retriever_resource = citationConfig
      draft.dataSets = dataSets
    })
    setPublishedConfig({
      modelConfig: newModelConfig,
      completionParams,
    })
    if (!isSilence)
      notify({ type: 'success', message: t('common.api.success'), duration: 3000 })

    setCanReturnToSimpleMode(false)
    return true
  }

  const [showConfirm, setShowConfirm] = useState(false)
  const resetAppConfig = () => {
    syncToPublishedConfig(publishedConfig!)
    setShowConfirm(false)
  }

  const [showUseGPT4Confirm, setShowUseGPT4Confirm] = useState(false)
  const [showSetAPIKeyModal, setShowSetAPIKeyModal] = useState(false)

  if (isLoading) {
    return <div className='flex h-full items-center justify-center'>
      <Loading type='area' />
    </div>
  }

  return (
    <ConfigContext.Provider value={{
      appId,
      hasSetAPIKEY,
      isTrailFinished,
      mode,
      modelModeType,
      promptMode,
      isAdvancedMode,
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
      citationConfig,
      setCitationConfig,
      formattingChanged,
      setFormattingChanged,
      inputs,
      setInputs,
      query,
      setQuery,
      completionParams,
      setCompletionParams,
      modelConfig,
      setModelConfig,
      showSelectDataSet,
      dataSets,
      setDataSets,
      datasetConfigs,
      setDatasetConfigs,
      hasSetContextVar,
    }}
    >
      <>
        <div className="flex flex-col h-full">
          <div className='flex items-center justify-between px-6 shrink-0 h-14'>
            <div>
              <div className='italic text-base font-bold text-gray-900 leading-[18px]'>{t('appDebug.pageTitle.line1')}</div>
              <div className='flex items-center h-6 space-x-1 text-xs'>
                <div className='text-gray-500 font-medium italic'>{t('appDebug.pageTitle.line2')}</div>
                {/* modelModeType missing can not load template */}
                {(!isAdvancedMode && modelModeType) && (
                  <div
                    onClick={() => setPromptMode(PromptMode.advanced)}
                    className={'cursor-pointer text-indigo-600'}
                  >
                    {t('appDebug.promptMode.simple')}
                  </div>
                )}
                {isAdvancedMode && (
                  <div className='flex items-center space-x-2'>
                    <div className={`${s.advancedPromptMode} cursor-pointer text-indigo-600`}>{t('appDebug.promptMode.advanced')}</div>
                    {canReturnToSimpleMode && (
                      <div
                        onClick={() => setPromptMode(PromptMode.simple)}
                        className='flex items-center h-6 px-2 bg-indigo-600 shadow-xs border border-gray-200 rounded-lg text-white text-xs font-semibold cursor-pointer space-x-1'
                      >
                        <FlipBackward className='w-3 h-3 text-white'/>
                        <div className='text-xs font-semibold uppercase'>{t('appDebug.promptMode.switchBack')}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className='flex items-center'>
              {/* Model and Parameters */}
              <ConfigModel
                isAdvancedMode={isAdvancedMode}
                mode={mode}
                provider={modelConfig.provider as ProviderEnum}
                completionParams={completionParams}
                modelId={modelConfig.model_id}
                setModel={setModel}
                onCompletionParamsChange={(newParams: CompletionParams) => {
                  setCompletionParams(newParams)
                }}
                disabled={!hasSetAPIKEY}
              />
              <div className='mx-3 w-[1px] h-[14px] bg-gray-200'></div>
              <Button onClick={() => setShowConfirm(true)} className='shrink-0 mr-2 w-[70px] !h-8 !text-[13px] font-medium'>{t('appDebug.operation.resetConfig')}</Button>
              <Button type='primary' onClick={() => handlePublish(false)} className={cn(cannotPublish && '!bg-primary-200 !cursor-not-allowed', 'shrink-0 w-[70px] !h-8 !text-[13px] font-medium')}>{t('appDebug.operation.applyConfig')}</Button>
            </div>
          </div>
          <div className='flex grow h-[200px]'>
            <div className="w-1/2 min-w-[560px] shrink-0">
              <Config />
            </div>
            <div className="relative w-1/2  grow h-full overflow-y-auto  py-4 px-6 bg-gray-50 flex flex-col rounded-tl-2xl border-t border-l" style={{ borderColor: 'rgba(0, 0, 0, 0.02)' }}>
              <Debug hasSetAPIKEY={hasSetAPIKEY} onSetting={showSetAPIKey} />
            </div>
          </div>
        </div>
        {showConfirm && (
          <Confirm
            title={t('appDebug.resetConfig.title')}
            content={t('appDebug.resetConfig.message')}
            isShow={showConfirm}
            onClose={() => setShowConfirm(false)}
            onConfirm={resetAppConfig}
            onCancel={() => setShowConfirm(false)}
          />
        )}
        {showUseGPT4Confirm && (
          <Confirm
            title={t('appDebug.trailUseGPT4Info.title')}
            content={t('appDebug.trailUseGPT4Info.description')}
            isShow={showUseGPT4Confirm}
            onClose={() => setShowUseGPT4Confirm(false)}
            onConfirm={() => {
              setShowSetAPIKeyModal(true)
              setShowUseGPT4Confirm(false)
            }}
            onCancel={() => setShowUseGPT4Confirm(false)}
          />
        )}
        {
          showSetAPIKeyModal && (
            <AccountSetting activeTab="provider" onCancel={async () => {
              setShowSetAPIKeyModal(false)
            }} />
          )
        }
        {isShowSetAPIKey && <AccountSetting activeTab="provider" onCancel={async () => {
          hideSetAPIkey()
        }} />}

        {isShowSelectDataSet && (
          <SelectDataSet
            isShow={isShowSelectDataSet}
            onClose={hideSelectDataSet}
            selectedIds={selectedIds}
            onSelect={handleSelect}
          />
        )}

        {isShowHistoryModal && (
          <EditHistoryModal
            isShow={isShowHistoryModal}
            saveLoading={false}
            onClose={hideHistoryModal}
            data={completionPromptConfig.conversation_histories_role}
            onSave={(data) => {
              setConversationHistoriesRole(data)
              hideHistoryModal()
            }}
          />
        )}
      </>
    </ConfigContext.Provider>
  )
}
export default React.memo(Configuration)
