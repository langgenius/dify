import type { ChangeEvent, FC } from 'react'
import { useState } from 'react'
import useSWR from 'swr'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import ModerationContent from './moderation-content'
import FormGeneration from './form-generation'
import ApiBasedExtensionSelector from '@/app/components/header/account-setting/api-based-extension-page/selector'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { BookOpen01 } from '@/app/components/base/icons/src/vender/line/education'
import type { ModerationConfig, ModerationContentConfig } from '@/models/debug'
import { useToastContext } from '@/app/components/base/toast'
import {
  fetchCodeBasedExtensionList,
  fetchModelProviders,
} from '@/service/common'
import type { CodeBasedExtensionItem } from '@/models/common'
import I18n from '@/context/i18n'
import { LanguagesSupported } from '@/i18n/language'
import { InfoCircle } from '@/app/components/base/icons/src/vender/line/general'
import { useModalContext } from '@/context/modal-context'
import { CustomConfigurationStatusEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'

const systemTypes = ['openai_moderation', 'keywords', 'api']

type Provider = {
  key: string
  name: string
  form_schema?: CodeBasedExtensionItem['form_schema']
}

type ModerationSettingModalProps = {
  data: ModerationConfig
  onCancel: () => void
  onSave: (moderationConfig: ModerationConfig) => void
}

const ModerationSettingModal: FC<ModerationSettingModalProps> = ({
  data,
  onCancel,
  onSave,
}) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const { locale } = useContext(I18n)
  const { data: modelProviders, isLoading, mutate } = useSWR('/workspaces/current/model-providers', fetchModelProviders)
  const [localeData, setLocaleData] = useState<ModerationConfig>(data)
  const { setShowAccountSettingModal } = useModalContext()
  const handleOpenSettingsModal = () => {
    setShowAccountSettingModal({
      payload: 'provider',
      onCancelCallback: () => {
        mutate()
      },
    })
  }
  const { data: codeBasedExtensionList } = useSWR(
    '/code-based-extension?module=moderation',
    fetchCodeBasedExtensionList,
  )
  const openaiProvider = modelProviders?.data.find(item => item.provider === 'openai')
  const systemOpenaiProviderEnabled = openaiProvider?.system_configuration.enabled
  const systemOpenaiProviderQuota = systemOpenaiProviderEnabled ? openaiProvider?.system_configuration.quota_configurations.find(item => item.quota_type === openaiProvider.system_configuration.current_quota_type) : undefined
  const systemOpenaiProviderCanUse = systemOpenaiProviderQuota?.is_valid
  const customOpenaiProvidersCanUse = openaiProvider?.custom_configuration.status === CustomConfigurationStatusEnum.active
  const openaiProviderConfiged = customOpenaiProvidersCanUse || systemOpenaiProviderCanUse
  const providers: Provider[] = [
    {
      key: 'openai_moderation',
      name: t('appDebug.feature.moderation.modal.provider.openai'),
    },
    {
      key: 'keywords',
      name: t('appDebug.feature.moderation.modal.provider.keywords'),
    },
    {
      key: 'api',
      name: t('common.apiBasedExtension.selector.title'),
    },
    ...(
      codeBasedExtensionList
        ? codeBasedExtensionList.data.map((item) => {
          return {
            key: item.name,
            name: locale === 'zh-Hans' ? item.label['zh-Hans'] : item.label['en-US'],
            form_schema: item.form_schema,
          }
        })
        : []
    ),
  ]

  const currentProvider = providers.find(provider => provider.key === localeData.type)

  const handleDataTypeChange = (type: string) => {
    let config: undefined | Record<string, any>
    const currProvider = providers.find(provider => provider.key === type)

    if (systemTypes.findIndex(t => t === type) < 0 && currProvider?.form_schema) {
      config = currProvider?.form_schema.reduce((prev, next) => {
        prev[next.variable] = next.default
        return prev
      }, {} as Record<string, any>)
    }
    setLocaleData({
      ...localeData,
      type,
      config,
    })
  }

  const handleDataKeywordsChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value

    const arr = value.split('\n').reduce((prev: string[], next: string) => {
      if (next !== '')
        prev.push(next.slice(0, 100))
      if (next === '' && prev[prev.length - 1] !== '')
        prev.push(next)

      return prev
    }, [])

    setLocaleData({
      ...localeData,
      config: {
        ...localeData.config,
        keywords: arr.slice(0, 100).join('\n'),
      },
    })
  }

  const handleDataContentChange = (contentType: string, contentConfig: ModerationContentConfig) => {
    setLocaleData({
      ...localeData,
      config: {
        ...localeData.config,
        [contentType]: contentConfig,
      },
    })
  }

  const handleDataApiBasedChange = (apiBasedExtensionId: string) => {
    setLocaleData({
      ...localeData,
      config: {
        ...localeData.config,
        api_based_extension_id: apiBasedExtensionId,
      },
    })
  }

  const handleDataExtraChange = (extraValue: Record<string, string>) => {
    setLocaleData({
      ...localeData,
      config: {
        ...localeData.config,
        ...extraValue,
      },
    })
  }

  const formatData = (originData: ModerationConfig) => {
    const { enabled, type, config } = originData
    const { inputs_config, outputs_config } = config!
    const params: Record<string, string | undefined> = {}

    if (type === 'keywords')
      params.keywords = config?.keywords

    if (type === 'api')
      params.api_based_extension_id = config?.api_based_extension_id

    if (systemTypes.findIndex(t => t === type) < 0 && currentProvider?.form_schema) {
      currentProvider.form_schema.forEach((form) => {
        params[form.variable] = config?.[form.variable]
      })
    }

    return {
      type,
      enabled,
      config: {
        inputs_config: inputs_config || { enabled: false },
        outputs_config: outputs_config || { enabled: false },
        ...params,
      },
    }
  }

  const handleSave = () => {
    if (localeData.type === 'openai_moderation' && !openaiProviderConfiged)
      return

    if (!localeData.config?.inputs_config?.enabled && !localeData.config?.outputs_config?.enabled) {
      notify({ type: 'error', message: t('appDebug.feature.moderation.modal.content.condition') })
      return
    }

    if (localeData.type === 'keywords' && !localeData.config.keywords) {
      notify({ type: 'error', message: t('appDebug.errorMessage.valueOfVarRequired', { key: locale !== LanguagesSupported[1] ? 'keywords' : '关键词' }) })
      return
    }

    if (localeData.type === 'api' && !localeData.config.api_based_extension_id) {
      notify({ type: 'error', message: t('appDebug.errorMessage.valueOfVarRequired', { key: locale !== LanguagesSupported[1] ? 'API Extension' : 'API 扩展' }) })
      return
    }

    if (systemTypes.findIndex(t => t === localeData.type) < 0 && currentProvider?.form_schema) {
      for (let i = 0; i < currentProvider.form_schema.length; i++) {
        if (!localeData.config?.[currentProvider.form_schema[i].variable] && currentProvider.form_schema[i].required) {
          notify({
            type: 'error',
            message: t('appDebug.errorMessage.valueOfVarRequired', { key: locale !== LanguagesSupported[1] ? currentProvider.form_schema[i].label['en-US'] : currentProvider.form_schema[i].label['zh-Hans'] }),
          })
          return
        }
      }
    }

    if (localeData.config.inputs_config?.enabled && !localeData.config.inputs_config.preset_response && localeData.type !== 'api') {
      notify({ type: 'error', message: t('appDebug.feature.moderation.modal.content.errorMessage') })
      return
    }

    if (localeData.config.outputs_config?.enabled && !localeData.config.outputs_config.preset_response && localeData.type !== 'api') {
      notify({ type: 'error', message: t('appDebug.feature.moderation.modal.content.errorMessage') })
      return
    }

    onSave(formatData(localeData))
  }

  return (
    <Modal
      isShow
      onClose={() => { }}
      className='!p-8 !pb-6 !mt-14 !max-w-none !w-[640px]'
    >
      <div className='mb-2 text-xl font-semibold text-[#1D2939]'>
        {t('appDebug.feature.moderation.modal.title')}
      </div>
      <div className='py-2'>
        <div className='leading-9 text-sm font-medium text-gray-900'>
          {t('appDebug.feature.moderation.modal.provider.title')}
        </div>
        <div className='grid gap-2.5 grid-cols-3'>
          {
            providers.map(provider => (
              <div
                key={provider.key}
                className={`
                  flex items-center px-3 py-2 rounded-lg text-sm text-gray-900 cursor-pointer
                  ${localeData.type === provider.key ? 'bg-white border-[1.5px] border-primary-400 shadow-sm' : 'border border-gray-100 bg-gray-25'}
                  ${localeData.type === 'openai_moderation' && provider.key === 'openai_moderation' && !openaiProviderConfiged && 'opacity-50'}
                `}
                onClick={() => handleDataTypeChange(provider.key)}
              >
                <div className={`
                  mr-2 w-4 h-4 rounded-full border 
                  ${localeData.type === provider.key ? 'border-[5px] border-primary-600' : 'border border-gray-300'}`} />
                {provider.name}
              </div>
            ))
          }
        </div>
        {
          !isLoading && !openaiProviderConfiged && localeData.type === 'openai_moderation' && (
            <div className='flex items-center mt-2 px-3 py-2 bg-[#FFFAEB] rounded-lg border border-[#FEF0C7]'>
              <InfoCircle className='mr-1 w-4 h-4 text-[#F79009]' />
              <div className='flex items-center text-xs font-medium text-gray-700'>
                {t('appDebug.feature.moderation.modal.openaiNotConfig.before')}
                <span
                  className='text-primary-600 cursor-pointer'
                  onClick={handleOpenSettingsModal}
                >
                  &nbsp;{t('common.settings.provider')}&nbsp;
                </span>
                {t('appDebug.feature.moderation.modal.openaiNotConfig.after')}
              </div>
            </div>
          )
        }
      </div>
      {
        localeData.type === 'keywords' && (
          <div className='py-2'>
            <div className='mb-1 text-sm font-medium text-gray-900'>{t('appDebug.feature.moderation.modal.provider.keywords')}</div>
            <div className='mb-2 text-xs text-gray-500'>{t('appDebug.feature.moderation.modal.keywords.tip')}</div>
            <div className='relative px-3 py-2 h-[88px] bg-gray-100 rounded-lg'>
              <textarea
                value={localeData.config?.keywords || ''}
                onChange={handleDataKeywordsChange}
                className='block w-full h-full bg-transparent text-sm outline-none appearance-none resize-none'
                placeholder={t('appDebug.feature.moderation.modal.keywords.placeholder') || ''}
              />
              <div className='absolute bottom-2 right-2 flex items-center px-1 h-5 rounded-md bg-gray-50 text-xs font-medium text-gray-300'>
                <span>{(localeData.config?.keywords || '').split('\n').filter(Boolean).length}</span>/<span className='text-gray-500'>100 {t('appDebug.feature.moderation.modal.keywords.line')}</span>
              </div>
            </div>
          </div>
        )
      }
      {
        localeData.type === 'api' && (
          <div className='py-2'>
            <div className='flex items-center justify-between h-9'>
              <div className='text-sm font-medium text-gray-900'>{t('common.apiBasedExtension.selector.title')}</div>
              <a
                href={t('common.apiBasedExtension.linkUrl') || '/'}
                target='_blank' rel='noopener noreferrer'
                className='group flex items-center text-xs text-gray-500 hover:text-primary-600'
              >
                <BookOpen01 className='mr-1 w-3 h-3 text-gray-500 group-hover:text-primary-600' />
                {t('common.apiBasedExtension.link')}
              </a>
            </div>
            <ApiBasedExtensionSelector
              value={localeData.config?.api_based_extension_id || ''}
              onChange={handleDataApiBasedChange}
            />
          </div>
        )
      }
      {
        systemTypes.findIndex(t => t === localeData.type) < 0
        && currentProvider?.form_schema
        && (
          <FormGeneration
            forms={currentProvider?.form_schema}
            value={localeData.config}
            onChange={handleDataExtraChange}
          />
        )
      }
      <div className='my-3 h-[1px] bg-gradient-to-r from-[#F3F4F6]'></div>
      <ModerationContent
        title={t('appDebug.feature.moderation.modal.content.input') || ''}
        config={localeData.config?.inputs_config || { enabled: false, preset_response: '' }}
        onConfigChange={config => handleDataContentChange('inputs_config', config)}
        info={(localeData.type === 'api' && t('appDebug.feature.moderation.modal.content.fromApi')) || ''}
        showPreset={!(localeData.type === 'api')}
      />
      <ModerationContent
        title={t('appDebug.feature.moderation.modal.content.output') || ''}
        config={localeData.config?.outputs_config || { enabled: false, preset_response: '' }}
        onConfigChange={config => handleDataContentChange('outputs_config', config)}
        info={(localeData.type === 'api' && t('appDebug.feature.moderation.modal.content.fromApi')) || ''}
        showPreset={!(localeData.type === 'api')}
      />
      <div className='mt-1 mb-8 text-xs font-medium text-gray-500'>{t('appDebug.feature.moderation.modal.content.condition')}</div>
      <div className='flex items-center justify-end'>
        <Button
          onClick={onCancel}
          className='mr-2 text-sm font-medium'
        >
          {t('common.operation.cancel')}
        </Button>
        <Button
          type='primary'
          className='text-sm font-medium'
          onClick={handleSave}
          disabled={localeData.type === 'openai_moderation' && !openaiProviderConfiged}
        >
          {t('common.operation.save')}
        </Button>
      </div>
    </Modal>
  )
}

export default ModerationSettingModal
