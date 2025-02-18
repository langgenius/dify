import type { ChangeEvent, FC } from 'react'
import { useState } from 'react'
import useSWR from 'swr'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import ModerationContent from './moderation-content'
import FormGeneration from './form-generation'
import ApiBasedExtensionSelector from '@/app/components/header/account-setting/api-based-extension-page/selector'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
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
import cn from '@/utils/classnames'

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
  const openaiProvider = modelProviders?.data.find(item => item.provider === 'langgenius/openai/openai')
  const systemOpenaiProviderEnabled = openaiProvider?.system_configuration.enabled
  const systemOpenaiProviderQuota = systemOpenaiProviderEnabled ? openaiProvider?.system_configuration.quota_configurations.find(item => item.quota_type === openaiProvider.system_configuration.current_quota_type) : undefined
  const systemOpenaiProviderCanUse = systemOpenaiProviderQuota?.is_valid
  const customOpenaiProvidersCanUse = openaiProvider?.custom_configuration.status === CustomConfigurationStatusEnum.active
  const isOpenAIProviderConfigured = customOpenaiProvidersCanUse || systemOpenaiProviderCanUse
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
    if (localeData.type === 'openai_moderation' && !isOpenAIProviderConfigured)
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
      className='!mt-14 !w-[600px] !max-w-none !p-6'
    >
      <div className='flex items-center justify-between'>
        <div className='text-text-primary title-2xl-semi-bold'>{t('appDebug.feature.moderation.modal.title')}</div>
        <div className='cursor-pointer p-1' onClick={onCancel}><RiCloseLine className='text-text-tertiary h-4 w-4'/></div>
      </div>
      <div className='py-2'>
        <div className='text-text-primary text-sm font-medium leading-9'>
          {t('appDebug.feature.moderation.modal.provider.title')}
        </div>
        <div className='grid grid-cols-3 gap-2.5'>
          {
            providers.map(provider => (
              <div
                key={provider.key}
                className={cn(
                  'system-sm-regular bg-components-option-card-option-bg border-components-option-card-option-border text-text-secondary flex h-8 cursor-default items-center rounded-md border px-2',
                  localeData.type !== provider.key && 'hover:bg-components-option-card-option-bg-hover hover:border-components-option-card-option-border-hover hover:shadow-xs cursor-pointer',
                  localeData.type === provider.key && 'bg-components-option-card-option-selected-bg border-components-option-card-option-selected-border system-sm-medium shadow-xs border-[1.5px]',
                  localeData.type === 'openai_moderation' && provider.key === 'openai_moderation' && !isOpenAIProviderConfigured && 'text-text-disabled',
                )}
                onClick={() => handleDataTypeChange(provider.key)}
              >
                <div className={cn(
                  'border-components-radio-border bg-components-radio-bg shadow-xs mr-2 h-4 w-4 rounded-full border',
                  localeData.type === provider.key && 'border-components-radio-border-checked border-[5px]',
                )}></div>
                {provider.name}
              </div>
            ))
          }
        </div>
        {
          !isLoading && !isOpenAIProviderConfigured && localeData.type === 'openai_moderation' && (
            <div className='mt-2 flex items-center rounded-lg border border-[#FEF0C7] bg-[#FFFAEB] px-3 py-2'>
              <InfoCircle className='mr-1 h-4 w-4 text-[#F79009]' />
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
            <div className='text-text-primary mb-1 text-sm font-medium'>{t('appDebug.feature.moderation.modal.provider.keywords')}</div>
            <div className='text-text-tertiary mb-2 text-xs'>{t('appDebug.feature.moderation.modal.keywords.tip')}</div>
            <div className='bg-components-input-bg-normal relative h-[88px] rounded-lg px-3 py-2'>
              <textarea
                value={localeData.config?.keywords || ''}
                onChange={handleDataKeywordsChange}
                className='text-text-secondary block h-full w-full resize-none appearance-none bg-transparent text-sm outline-none'
                placeholder={t('appDebug.feature.moderation.modal.keywords.placeholder') || ''}
              />
              <div className='bg-background-section text-text-quaternary absolute bottom-2 right-2 flex h-5 items-center rounded-md px-1 text-xs font-medium'>
                <span>{(localeData.config?.keywords || '').split('\n').filter(Boolean).length}</span>/<span className='text-text-tertiary'>100 {t('appDebug.feature.moderation.modal.keywords.line')}</span>
              </div>
            </div>
          </div>
        )
      }
      {
        localeData.type === 'api' && (
          <div className='py-2'>
            <div className='flex h-9 items-center justify-between'>
              <div className='text-text-primary text-sm font-medium'>{t('common.apiBasedExtension.selector.title')}</div>
              <a
                href={t('common.apiBasedExtension.linkUrl') || '/'}
                target='_blank' rel='noopener noreferrer'
                className='text-text-tertiary hover:text-primary-600 group flex items-center text-xs'
              >
                <BookOpen01 className='text-text-tertiary group-hover:text-primary-600 mr-1 h-3 w-3' />
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
      <Divider bgStyle='gradient' className='my-3 h-px' />
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
      <div className='text-text-tertiary mb-8 mt-1 text-xs font-medium'>{t('appDebug.feature.moderation.modal.content.condition')}</div>
      <div className='flex items-center justify-end'>
        <Button
          onClick={onCancel}
          className='mr-2'
        >
          {t('common.operation.cancel')}
        </Button>
        <Button
          variant='primary'
          onClick={handleSave}
          disabled={localeData.type === 'openai_moderation' && !isOpenAIProviderConfigured}
        >
          {t('common.operation.save')}
        </Button>
      </div>
    </Modal>
  )
}

export default ModerationSettingModal
