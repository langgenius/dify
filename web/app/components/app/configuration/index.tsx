'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { usePathname } from 'next/navigation'
import produce from 'immer'
import { useBoolean } from 'ahooks'
import Button from '../../base/button'
import Loading from '../../base/loading'
import type { CompletionParams, Inputs, ModelConfig, MoreLikeThisConfig, PromptConfig, PromptVariable } from '@/models/debug'
import type { DataSet } from '@/models/datasets'
import type { ModelConfig as BackendModelConfig } from '@/types/app'
import ConfigContext from '@/context/debug-configuration'
import ConfigModel from '@/app/components/app/configuration/config-model'
import Config from '@/app/components/app/configuration/config'
import Debug from '@/app/components/app/configuration/debug'
import Confirm from '@/app/components/base/confirm'
import type { AppDetailResponse } from '@/models/app'
import { ToastContext } from '@/app/components/base/toast'
import { fetchTenantInfo } from '@/service/common'
import { fetchAppDetail, updateAppModelConfig } from '@/service/apps'
import { promptVariablesToUserInputsForm, userInputsFormToPromptVariables } from '@/utils/model-config'
import { fetchDatasets } from '@/service/datasets'
import AccountSetting from '@/app/components/header/account-setting'

const Configuration: FC = () => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)

  const [hasFetchedDetail, setHasFetchedDetail] = useState(false)
  const [hasFetchedKey, setHasFetchedKey] = useState(false)
  const isLoading = !hasFetchedDetail || !hasFetchedKey
  const pathname = usePathname()
  const matched = pathname.match(/\/app\/([^/]+)/)
  const appId = (matched?.length && matched[1]) ? matched[1] : ''
  const [mode, setMode] = useState('')
  const [publishedConfig, setPublishedConfig] = useState<{
    modelConfig: ModelConfig
    completionParams: CompletionParams
  } | null>(null)

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
    provider: 'openai',
    model_id: 'gpt-3.5-turbo',
    configs: {
      prompt_template: '',
      prompt_variables: [] as PromptVariable[],
    },
    opening_statement: '',
    more_like_this: null,
    suggested_questions_after_answer: null,
    speech_to_text: null,
    dataSets: [],
  })

  const setModelConfig = (newModelConfig: ModelConfig) => {
    doSetModelConfig(newModelConfig)
  }

  const setModelId = (modelId: string) => {
    const newModelConfig = produce(modelConfig, (draft: any) => {
      draft.model_id = modelId
    })
    setModelConfig(newModelConfig)
  }

  const [dataSets, setDataSets] = useState<DataSet[]>([])

  const syncToPublishedConfig = (_publishedConfig: any) => {
    const modelConfig = _publishedConfig.modelConfig
    setModelConfig(_publishedConfig.modelConfig)
    setCompletionParams(_publishedConfig.completionParams)
    setDataSets(modelConfig.dataSets || [])
    // feature
    setIntroduction(modelConfig.opening_statement)
    setMoreLikeThisConfig(modelConfig.more_like_this || {
      enabled: false,
    })
    setSuggestedQuestionsAfterAnswerConfig(modelConfig.suggested_questions_after_answer || {
      enabled: false,
    })
    setSpeechToTextConfig(modelConfig.speech_to_text || {
      enabled: false,
    })
  }

  const [hasSetCustomAPIKEY, setHasSetCustomerAPIKEY] = useState(true)
  const [isTrailFinished, setIsTrailFinished] = useState(false)
  const hasSetAPIKEY = hasSetCustomAPIKEY || !isTrailFinished

  const [isShowSetAPIKey, { setTrue: showSetAPIKey, setFalse: hideSetAPIkey }] = useBoolean()

  const checkAPIKey = async () => {
    const { in_trail, trial_end_reason } = await fetchTenantInfo({ url: '/info' })
    const isTrailFinished = in_trail && trial_end_reason === 'trial_exceeded'
    const hasSetCustomAPIKEY = trial_end_reason === 'using_custom'
    setHasSetCustomerAPIKEY(hasSetCustomAPIKEY)
    setIsTrailFinished(isTrailFinished)
    setHasFetchedKey(true)
  }

  useEffect(() => {
    checkAPIKey()
  }, [])

  useEffect(() => {
    (fetchAppDetail({ url: '/apps', id: appId }) as any).then(async (res: AppDetailResponse) => {
      setMode(res.mode)
      const modelConfig = res.model_config
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

      const config = {
        modelConfig: {
          provider: model.provider,
          model_id: model.name,
          configs: {
            prompt_template: modelConfig.pre_prompt,
            prompt_variables: userInputsFormToPromptVariables(modelConfig.user_input_form),
          },
          opening_statement: modelConfig.opening_statement,
          more_like_this: modelConfig.more_like_this,
          suggested_questions_after_answer: modelConfig.suggested_questions_after_answer,
          speech_to_text: modelConfig.speech_to_text,
          dataSets: datasets || [],
        },
        completionParams: model.completion_params,
      }
      syncToPublishedConfig(config)
      setPublishedConfig(config)

      setHasFetchedDetail(true)
    })
  }, [appId])

  const saveAppConfig = async () => {
    const modelId = modelConfig.model_id
    const promptTemplate = modelConfig.configs.prompt_template
    const promptVariables = modelConfig.configs.prompt_variables

    const postDatasets = dataSets.map(({ id }) => ({
      dataset: {
        enabled: true,
        id,
      },
    }))

    // new model config data struct
    const data: BackendModelConfig = {
      pre_prompt: promptTemplate,
      user_input_form: promptVariablesToUserInputsForm(promptVariables),
      opening_statement: introduction || '',
      more_like_this: moreLikeThisConfig,
      suggested_questions_after_answer: suggestedQuestionsAfterAnswerConfig,
      speech_to_text: speechToTextConfig,
      agent_mode: {
        enabled: true,
        tools: [...postDatasets],
      },
      model: {
        provider: modelConfig.provider,
        name: modelId,
        completion_params: completionParams as any,
      },
    }

    await updateAppModelConfig({ url: `/apps/${appId}/model-config`, body: data })
    const newModelConfig = produce(modelConfig, (draft: any) => {
      draft.opening_statement = introduction
      draft.more_like_this = moreLikeThisConfig
      draft.suggested_questions_after_answer = suggestedQuestionsAfterAnswerConfig
      draft.speech_to_text = speechToTextConfig
      draft.dataSets = dataSets
    })
    setPublishedConfig({
      modelConfig: newModelConfig,
      completionParams,
    })
    notify({ type: 'success', message: t('common.api.success'), duration: 3000 })
  }

  const [showConfirm, setShowConfirm] = useState(false)
  const resetAppConfig = () => {
    syncToPublishedConfig(publishedConfig)
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
      dataSets,
      setDataSets,
    }}
    >
      <>
        <div className="flex flex-col h-full">
          <div className='flex items-center justify-between px-6 border-b shrink-0 h-14 boder-gray-100'>
            <div className='text-xl text-gray-900'>{t('appDebug.pageTitle')}</div>
            <div className='flex items-center'>
              {/* Model and Parameters */}
              <ConfigModel
                mode={mode}
                completionParams={completionParams}
                modelId={modelConfig.model_id}
                setModelId={setModelId}
                onCompletionParamsChange={(newParams: CompletionParams) => {
                  setCompletionParams(newParams)
                }}
                disabled={!hasSetAPIKEY}
                canUseGPT4={hasSetCustomAPIKEY}
                onShowUseGPT4Confirm={() => {
                  setShowUseGPT4Confirm(true)
                }}
              />
              <div className='mx-3 w-[1px] h-[14px] bg-gray-200'></div>
              <Button onClick={() => setShowConfirm(true)} className='shrink-0 mr-2 w-[70px] !h-8 !text-[13px] font-medium'>{t('appDebug.operation.resetConfig')}</Button>
              <Button type='primary' onClick={saveAppConfig} className='shrink-0 w-[70px] !h-8 !text-[13px] font-medium'>{t('appDebug.operation.applyConfig')}</Button>
            </div>
          </div>
          <div className='flex grow h-[200px]'>
            <div className="w-[574px] shrink-0 h-full overflow-y-auto border-r border-gray-100 py-4 px-6">
              <Config />
            </div>
            <div className="relative grow h-full overflow-y-auto  py-4 px-6 bg-gray-50 flex flex-col">
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
          await checkAPIKey()
          hideSetAPIkey()
        }} />}
      </>
    </ConfigContext.Provider>
  )
}
export default React.memo(Configuration)
