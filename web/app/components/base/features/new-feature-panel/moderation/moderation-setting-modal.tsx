import type { ChangeEvent, FC } from 'react'
import type { CodeBasedExtensionItem } from '@/models/common'
import type { ModerationConfig, ModerationContentConfig } from '@/models/debug'
import { RiCloseLine } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import { BookOpen01 } from '@/app/components/base/icons/src/vender/line/education'
import { InfoCircle } from '@/app/components/base/icons/src/vender/line/general'
import Modal from '@/app/components/base/modal'
import { useToastContext } from '@/app/components/base/toast'
import ApiBasedExtensionSelector from '@/app/components/header/account-setting/api-based-extension-page/selector'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { CustomConfigurationStatusEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDocLink, useLocale } from '@/context/i18n'
import { useModalContext } from '@/context/modal-context'
import { LanguagesSupported } from '@/i18n-config/language'
import { useCodeBasedExtensions, useModelProviders } from '@/service/use-common'
import { cn } from '@/utils/classnames'
import FormGeneration from './form-generation'
import ModerationContent from './moderation-content'

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
  const docLink = useDocLink()
  const { notify } = useToastContext()
  const locale = useLocale()
  const { data: modelProviders, isPending: isLoading, refetch: refetchModelProviders } = useModelProviders()
  const [localeData, setLocaleData] = useState<ModerationConfig>(data)
  const { setShowAccountSettingModal } = useModalContext()
  const handleOpenSettingsModal = () => {
    setShowAccountSettingModal({
      payload: ACCOUNT_SETTING_TAB.PROVIDER,
      onCancelCallback: () => {
        refetchModelProviders()
      },
    })
  }
  const { data: codeBasedExtensionList } = useCodeBasedExtensions('moderation')
  const openaiProvider = modelProviders?.data.find(item => item.provider === 'langgenius/openai/openai')
  const systemOpenaiProviderEnabled = openaiProvider?.system_configuration.enabled
  const systemOpenaiProviderQuota = systemOpenaiProviderEnabled ? openaiProvider?.system_configuration.quota_configurations.find(item => item.quota_type === openaiProvider.system_configuration.current_quota_type) : undefined
  const systemOpenaiProviderCanUse = systemOpenaiProviderQuota?.is_valid
  const customOpenaiProvidersCanUse = openaiProvider?.custom_configuration.status === CustomConfigurationStatusEnum.active
  const isOpenAIProviderConfigured = customOpenaiProvidersCanUse || systemOpenaiProviderCanUse
  const providers: Provider[] = [
    {
      key: 'openai_moderation',
      name: t('feature.moderation.modal.provider.openai', { ns: 'appDebug' }),
    },
    {
      key: 'keywords',
      name: t('feature.moderation.modal.provider.keywords', { ns: 'appDebug' }),
    },
    {
      key: 'api',
      name: t('apiBasedExtension.selector.title', { ns: 'common' }),
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
      notify({ type: 'error', message: t('feature.moderation.modal.content.condition', { ns: 'appDebug' }) })
      return
    }

    if (localeData.type === 'keywords' && !localeData.config.keywords) {
      notify({ type: 'error', message: t('errorMessage.valueOfVarRequired', { ns: 'appDebug', key: locale !== LanguagesSupported[1] ? 'keywords' : '关键词' }) })
      return
    }

    if (localeData.type === 'api' && !localeData.config.api_based_extension_id) {
      notify({ type: 'error', message: t('errorMessage.valueOfVarRequired', { ns: 'appDebug', key: locale !== LanguagesSupported[1] ? 'API Extension' : 'API 扩展' }) })
      return
    }

    if (systemTypes.findIndex(t => t === localeData.type) < 0 && currentProvider?.form_schema) {
      for (let i = 0; i < currentProvider.form_schema.length; i++) {
        if (!localeData.config?.[currentProvider.form_schema[i].variable] && currentProvider.form_schema[i].required) {
          notify({
            type: 'error',
            message: t('errorMessage.valueOfVarRequired', { ns: 'appDebug', key: locale !== LanguagesSupported[1] ? currentProvider.form_schema[i].label['en-US'] : currentProvider.form_schema[i].label['zh-Hans'] }),
          })
          return
        }
      }
    }

    if (localeData.config.inputs_config?.enabled && !localeData.config.inputs_config.preset_response && localeData.type !== 'api') {
      notify({ type: 'error', message: t('feature.moderation.modal.content.errorMessage', { ns: 'appDebug' }) })
      return
    }

    if (localeData.config.outputs_config?.enabled && !localeData.config.outputs_config.preset_response && localeData.type !== 'api') {
      notify({ type: 'error', message: t('feature.moderation.modal.content.errorMessage', { ns: 'appDebug' }) })
      return
    }

    onSave(formatData(localeData))
  }

  return (
    <Modal
      isShow
      onClose={noop}
      className="!mt-14 !w-[600px] !max-w-none !p-6"
    >
      <div className="flex items-center justify-between">
        <div className="title-2xl-semi-bold text-text-primary">{t('feature.moderation.modal.title', { ns: 'appDebug' })}</div>
        <div className="cursor-pointer p-1" onClick={onCancel}><RiCloseLine className="h-4 w-4 text-text-tertiary" /></div>
      </div>
      <div className="py-2">
        <div className="text-sm font-medium leading-9 text-text-primary">
          {t('feature.moderation.modal.provider.title', { ns: 'appDebug' })}
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {
            providers.map(provider => (
              <div
                key={provider.key}
                className={cn(
                  'system-sm-regular flex h-8 cursor-default items-center rounded-md border border-components-option-card-option-border bg-components-option-card-option-bg px-2 text-text-secondary',
                  localeData.type !== provider.key && 'cursor-pointer hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs',
                  localeData.type === provider.key && 'system-sm-medium border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-xs',
                  localeData.type === 'openai_moderation' && provider.key === 'openai_moderation' && !isOpenAIProviderConfigured && 'text-text-disabled',
                )}
                onClick={() => handleDataTypeChange(provider.key)}
              >
                <div className={cn(
                  'mr-2 h-4 w-4 rounded-full border border-components-radio-border bg-components-radio-bg shadow-xs',
                  localeData.type === provider.key && 'border-[5px] border-components-radio-border-checked',
                )}
                >
                </div>
                {provider.name}
              </div>
            ))
          }
        </div>
        {
          !isLoading && !isOpenAIProviderConfigured && localeData.type === 'openai_moderation' && (
            <div className="mt-2 flex items-center rounded-lg border border-[#FEF0C7] bg-[#FFFAEB] px-3 py-2">
              <InfoCircle className="mr-1 h-4 w-4 text-[#F79009]" />
              <div className="flex items-center text-xs font-medium text-gray-700">
                {t('feature.moderation.modal.openaiNotConfig.before', { ns: 'appDebug' })}
                <span
                  className="cursor-pointer text-primary-600"
                  onClick={handleOpenSettingsModal}
                >
                  &nbsp;
                  {t('settings.provider', { ns: 'common' })}
&nbsp;
                </span>
                {t('feature.moderation.modal.openaiNotConfig.after', { ns: 'appDebug' })}
              </div>
            </div>
          )
        }
      </div>
      {
        localeData.type === 'keywords' && (
          <div className="py-2">
            <div className="mb-1 text-sm font-medium text-text-primary">{t('feature.moderation.modal.provider.keywords', { ns: 'appDebug' })}</div>
            <div className="mb-2 text-xs text-text-tertiary">{t('feature.moderation.modal.keywords.tip', { ns: 'appDebug' })}</div>
            <div className="relative h-[88px] rounded-lg bg-components-input-bg-normal px-3 py-2">
              <textarea
                value={localeData.config?.keywords || ''}
                onChange={handleDataKeywordsChange}
                className="block h-full w-full resize-none appearance-none bg-transparent text-sm text-text-secondary outline-none"
                placeholder={t('feature.moderation.modal.keywords.placeholder', { ns: 'appDebug' }) || ''}
              />
              <div className="absolute bottom-2 right-2 flex h-5 items-center rounded-md bg-background-section px-1 text-xs font-medium text-text-quaternary">
                <span>{(localeData.config?.keywords || '').split('\n').filter(Boolean).length}</span>
                /
                <span className="text-text-tertiary">
                  100
                  {t('feature.moderation.modal.keywords.line', { ns: 'appDebug' })}
                </span>
              </div>
            </div>
          </div>
        )
      }
      {
        localeData.type === 'api' && (
          <div className="py-2">
            <div className="flex h-9 items-center justify-between">
              <div className="text-sm font-medium text-text-primary">{t('apiBasedExtension.selector.title', { ns: 'common' })}</div>
              <a
                href={docLink('/use-dify/workspace/api-extension/api-extension')}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center text-xs text-text-tertiary hover:text-primary-600"
              >
                <BookOpen01 className="mr-1 h-3 w-3 text-text-tertiary group-hover:text-primary-600" />
                {t('apiBasedExtension.link', { ns: 'common' })}
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
      <Divider bgStyle="gradient" className="my-3 h-px" />
      <ModerationContent
        title={t('feature.moderation.modal.content.input', { ns: 'appDebug' }) || ''}
        config={localeData.config?.inputs_config || { enabled: false, preset_response: '' }}
        onConfigChange={config => handleDataContentChange('inputs_config', config)}
        info={(localeData.type === 'api' && t('feature.moderation.modal.content.fromApi', { ns: 'appDebug' })) || ''}
        showPreset={localeData.type !== 'api'}
      />
      <ModerationContent
        title={t('feature.moderation.modal.content.output', { ns: 'appDebug' }) || ''}
        config={localeData.config?.outputs_config || { enabled: false, preset_response: '' }}
        onConfigChange={config => handleDataContentChange('outputs_config', config)}
        info={(localeData.type === 'api' && t('feature.moderation.modal.content.fromApi', { ns: 'appDebug' })) || ''}
        showPreset={localeData.type !== 'api'}
      />
      <div className="mb-8 mt-1 text-xs font-medium text-text-tertiary">{t('feature.moderation.modal.content.condition', { ns: 'appDebug' })}</div>
      <div className="flex items-center justify-end">
        <Button
          onClick={onCancel}
          className="mr-2"
        >
          {t('operation.cancel', { ns: 'common' })}
        </Button>
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={localeData.type === 'openai_moderation' && !isOpenAIProviderConfigured}
        >
          {t('operation.save', { ns: 'common' })}
        </Button>
      </div>
    </Modal>
  )
}

export default ModerationSettingModal
