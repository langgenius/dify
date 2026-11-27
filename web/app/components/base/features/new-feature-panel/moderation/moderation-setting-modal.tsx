import type { FC, ReactNode } from 'react'
import type { ModerationConfig, ModerationContentConfig } from '@/models/debug'
import type { CodeBasedExtensionItem } from '@/service/console/code-based-extension-query'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Separator } from '@langgenius/dify-ui/separator'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useQuery } from '@tanstack/react-query'
import { useQueryState } from 'nuqs'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { ApiBasedExtensionSelector } from '@/app/components/header/account-setting/api-based-extension-page/selector'
import { CustomConfigurationStatusEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { modelProviderDetailsQueryOptions } from '@/app/components/header/account-setting/model-provider-page/utils'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import { toast } from '@/app/notifications'
import { useDocLink } from '@/context/i18n'
import { LanguagesSupported } from '@/i18n/language'
import { codeBasedExtensionsQueryOptions } from '@/service/console/code-based-extension-query'
import { useOwnedQueryErrors } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import FormGeneration from './form-generation'
import ModerationContent from './moderation-content'

const systemTypes = ['openai_moderation', 'keywords', 'api']

type Provider = {
  key: string
  name: string
  form_schema?: CodeBasedExtensionItem['form_schema']
}

function ProviderIcon({ type }: { type: string }) {
  if (type === 'openai_moderation')
    return <span className="i-ri-openai-fill size-4 text-text-secondary" aria-hidden />

  if (type === 'keywords')
    return <span className="i-ri-search-line size-4 text-util-colors-green-green-600" aria-hidden />

  return <span className="i-ri-image-line size-4 text-util-colors-violet-violet-600" aria-hidden />
}

function LabeledDivider({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full items-center gap-2">
      <span className="shrink-0 system-xs-medium-uppercase text-text-tertiary">{children}</span>
      <Separator decorative variant="gradient" className="my-0 flex-1" />
    </div>
  )
}

type ModerationSettingModalProps = {
  data: ModerationConfig
  onSave: (moderationConfig: ModerationConfig) => void
}

const ModerationSettingModal: FC<ModerationSettingModalProps> = ({ data, onSave }) => {
  const { t } = useTranslation(['appDebug', 'common', 'navigation'])
  const docLink = useDocLink()
  const locale = useLocale()
  const modelProvidersQuery = useQuery(modelProviderDetailsQueryOptions())
  const { data: modelProviders, isPending: isLoading } = modelProvidersQuery
  const localeDataRef = useRef<ModerationConfig>(data)
  const [localeData, setLocaleData] = useState<ModerationConfig>(data)
  const [, setSettingsDestination] = useQueryState(settingsQueryParamName, settingsQueryParser)
  const updateLocaleData = useCallback(
    (
      update: ModerationConfig | ((current: ModerationConfig) => ModerationConfig),
      options: { render?: boolean } = {},
    ) => {
      const nextLocaleData = typeof update === 'function' ? update(localeDataRef.current) : update

      localeDataRef.current = nextLocaleData

      if (options.render !== false) setLocaleData(nextLocaleData)
    },
    [],
  )
  const handleOpenSettingsModal = () => {
    setSettingsDestination('provider')
  }
  const codeBasedExtensionsQuery = useQuery(codeBasedExtensionsQueryOptions('moderation'))
  const codeBasedExtensionList = codeBasedExtensionsQuery.data
  // Without these lists the OpenAI status and the code-based providers are unknown, not missing.
  const failedLoad = useOwnedQueryErrors([modelProvidersQuery, codeBasedExtensionsQuery])
  const loadErrorMessage = useRequestErrorMessage(failedLoad?.error)
  const openaiProvider = modelProviders?.data.find(
    (item) => item.provider === 'langgenius/openai/openai',
  )
  const systemOpenaiProviderEnabled = openaiProvider?.system_configuration.enabled
  const systemOpenaiProviderQuota = systemOpenaiProviderEnabled
    ? openaiProvider?.system_configuration.quota_configurations.find(
        (item) => item.quota_type === openaiProvider.system_configuration.current_quota_type,
      )
    : undefined
  const systemOpenaiProviderCanUse = systemOpenaiProviderQuota?.is_valid
  const customOpenaiProvidersCanUse =
    openaiProvider?.custom_configuration.status === CustomConfigurationStatusEnum.active
  const isOpenAIProviderConfigured = customOpenaiProvidersCanUse || systemOpenaiProviderCanUse
  const providers: Provider[] = [
    {
      key: 'openai_moderation',
      name: t(($) => $['feature.moderation.modal.provider.openai'], { ns: 'appDebug' }),
    },
    {
      key: 'keywords',
      name: t(($) => $['feature.moderation.modal.provider.keywords'], { ns: 'appDebug' }),
    },
    {
      key: 'api',
      name: t(($) => $['apiBasedExtension.selector.title'], { ns: 'common' }),
    },
    ...(codeBasedExtensionList
      ? codeBasedExtensionList.data.map((item) => {
          return {
            key: item.name,
            name: locale === 'zh-Hans' ? item.label['zh-Hans'] : item.label['en-US'],
            form_schema: item.form_schema,
          }
        })
      : []),
  ]

  const currentProvider = providers.find((provider) => provider.key === localeData.type)

  const handleDataTypeChange = (type: string) => {
    let config: undefined | Record<string, string>
    const currProvider = providers.find((provider) => provider.key === type)

    if (systemTypes.findIndex((t) => t === type) < 0 && currProvider?.form_schema) {
      config = currProvider?.form_schema.reduce(
        (prev, next) => {
          if (next.default !== undefined) prev[next.variable] = next.default
          return prev
        },
        {} as Record<string, string>,
      )
    }
    updateLocaleData((current) => ({
      ...current,
      type,
      config,
    }))
  }

  const handleDataKeywordsChange = (value: string) => {
    const arr = value.split('\n').reduce((prev: string[], next: string) => {
      if (next !== '') prev.push(next.slice(0, 100))
      if (next === '' && prev[prev.length - 1] !== '') prev.push(next)

      return prev
    }, [])

    updateLocaleData((current) => ({
      ...current,
      config: {
        ...current.config,
        keywords: arr.slice(0, 100).join('\n'),
      },
    }))
  }

  const handleDataContentChange = (
    contentType: 'inputs_config' | 'outputs_config',
    contentConfig: ModerationContentConfig,
  ) => {
    const previousContentConfig = localeDataRef.current.config?.[contentType]
    const shouldRender = previousContentConfig?.enabled !== contentConfig.enabled

    updateLocaleData(
      (current) => ({
        ...current,
        config: {
          ...current.config,
          [contentType]: contentConfig,
        },
      }),
      { render: shouldRender },
    )
  }

  const handleDataApiBasedChange = (apiBasedExtensionId: string) => {
    updateLocaleData((current) => ({
      ...current,
      config: {
        ...current.config,
        api_based_extension_id: apiBasedExtensionId,
      },
    }))
  }

  const handleDataExtraChange = (extraValue: Record<string, string>) => {
    updateLocaleData((current) => ({
      ...current,
      config: {
        ...current.config,
        ...extraValue,
      },
    }))
  }

  const formatData = (originData: ModerationConfig) => {
    const { enabled, type, config } = originData
    const { inputs_config, outputs_config } = config!
    const params: NonNullable<ModerationConfig['config']> = {}

    if (type === 'keywords' && config?.keywords !== undefined) params.keywords = config.keywords

    if (type === 'api' && config?.api_based_extension_id !== undefined)
      params.api_based_extension_id = config.api_based_extension_id

    if (systemTypes.findIndex((t) => t === type) < 0 && currentProvider?.form_schema) {
      currentProvider.form_schema.forEach((form) => {
        const value = config?.[form.variable]
        if (value !== undefined) params[form.variable] = value
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
    const currentLocaleData = localeDataRef.current
    const providerForSave = providers.find((provider) => provider.key === currentLocaleData.type)

    /* v8 ignore next -- UI-invariant guard: same condition is used in Save button disabled logic, so when true handleSave has no user-triggerable invocation path. @preserve */
    if (currentLocaleData.type === 'openai_moderation' && !isOpenAIProviderConfigured) return

    if (
      !currentLocaleData.config?.inputs_config?.enabled &&
      !currentLocaleData.config?.outputs_config?.enabled
    ) {
      toast.error(t(($) => $['feature.moderation.modal.content.condition'], { ns: 'appDebug' }))
      return
    }

    if (currentLocaleData.type === 'keywords' && !currentLocaleData.config.keywords) {
      toast.error(
        t(($) => $['errorMessage.valueOfVarRequired'], {
          ns: 'appDebug',
          key: locale !== LanguagesSupported[1] ? 'keywords' : '关键词',
        }),
      )
      return
    }

    if (currentLocaleData.type === 'api' && !currentLocaleData.config.api_based_extension_id) {
      toast.error(
        t(($) => $['errorMessage.valueOfVarRequired'], {
          ns: 'appDebug',
          key: locale !== LanguagesSupported[1] ? 'API Extension' : 'API 扩展',
        }),
      )
      return
    }

    if (
      systemTypes.findIndex((t) => t === currentLocaleData.type) < 0 &&
      providerForSave?.form_schema
    ) {
      for (let i = 0; i < providerForSave.form_schema.length; i++) {
        if (
          !currentLocaleData.config?.[providerForSave.form_schema[i]!.variable] &&
          providerForSave.form_schema[i]!.required
        ) {
          toast.error(
            t(($) => $['errorMessage.valueOfVarRequired'], {
              ns: 'appDebug',
              key:
                locale !== LanguagesSupported[1]
                  ? providerForSave.form_schema[i]!.label['en-US']
                  : providerForSave.form_schema[i]!.label['zh-Hans'],
            }),
          )
          return
        }
      }
    }

    if (
      currentLocaleData.config.inputs_config?.enabled &&
      !currentLocaleData.config.inputs_config.preset_response &&
      currentLocaleData.type !== 'api'
    ) {
      toast.error(t(($) => $['feature.moderation.modal.content.errorMessage'], { ns: 'appDebug' }))
      return
    }

    if (
      currentLocaleData.config.outputs_config?.enabled &&
      !currentLocaleData.config.outputs_config.preset_response &&
      currentLocaleData.type !== 'api'
    ) {
      toast.error(t(($) => $['feature.moderation.modal.content.errorMessage'], { ns: 'appDebug' }))
      return
    }

    onSave(formatData(currentLocaleData))
  }

  return (
    <>
      <form
        className="contents"
        onSubmit={(event) => {
          // Portalled child forms still bubble submit events through the React tree.
          if (event.target !== event.currentTarget) return

          event.preventDefault()
          handleSave()
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t(($) => $['feature.moderation.modal.title'], { ns: 'appDebug' })}
          </DialogTitle>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <div className="system-sm-medium text-text-secondary">
              {t(($) => $['feature.moderation.modal.provider.title'], { ns: 'appDebug' })}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {providers.map((provider) => (
                <button
                  type="button"
                  key={provider.key}
                  className={cn(
                    'flex min-h-17 flex-col items-start justify-center gap-1.5 rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg px-3 py-2 text-start text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
                    localeData.type !== provider.key &&
                      'hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs',
                    localeData.type === provider.key &&
                      'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-xs',
                    localeData.type === 'openai_moderation' &&
                      provider.key === 'openai_moderation' &&
                      !isOpenAIProviderConfigured &&
                      'text-text-disabled',
                  )}
                  onClick={() => handleDataTypeChange(provider.key)}
                >
                  <div className="flex size-8 items-center justify-center rounded-lg border-[0.5px] border-divider-regular bg-background-default-dodge">
                    <ProviderIcon type={provider.key} />
                  </div>
                  <span className="w-full truncate system-xs-regular">{provider.name}</span>
                </button>
              ))}
            </div>
            {failedLoad && loadErrorMessage && (
              <Alert type="error" className="mt-2">
                <AlertTitle>{loadErrorMessage}</AlertTitle>
                <AlertActions>
                  <Button size="small" loading={failedLoad.retrying} onClick={failedLoad.retry}>
                    {t(($) => $['operation.retry'], { ns: 'common' })}
                  </Button>
                </AlertActions>
              </Alert>
            )}
            {!isLoading &&
              !!modelProviders &&
              !isOpenAIProviderConfigured &&
              localeData.type === 'openai_moderation' && (
                <Alert type="warning" className="mt-2">
                  <AlertTitle>
                    {t(($) => $['feature.moderation.modal.openaiNotConfig.before'], {
                      ns: 'appDebug',
                    })}
                    <button
                      type="button"
                      className="cursor-pointer text-text-accent"
                      onClick={handleOpenSettingsModal}
                    >
                      &nbsp;
                      {t(($) => $['settings.provider'], { ns: 'navigation' })}
                      &nbsp;
                    </button>
                    {t(($) => $['feature.moderation.modal.openaiNotConfig.after'], {
                      ns: 'appDebug',
                    })}
                  </AlertTitle>
                </Alert>
              )}
          </div>
          {localeData.type === 'keywords' && (
            <div className="flex flex-col gap-1">
              <div className="system-sm-medium text-text-secondary">
                {t(($) => $['feature.moderation.modal.provider.keywords'], { ns: 'appDebug' })}
              </div>
              <div className="system-xs-regular text-text-tertiary">
                {t(($) => $['feature.moderation.modal.keywords.tip'], { ns: 'appDebug' })}
              </div>
              {/* Keep this counter composed locally; extract only if more textarea counter cases repeat. */}
              <div className="relative h-22">
                <Textarea
                  aria-label={
                    t(($) => $['feature.moderation.modal.provider.keywords'], {
                      ns: 'appDebug',
                    }) as string
                  }
                  value={localeData.config?.keywords || ''}
                  onValueChange={handleDataKeywordsChange}
                  className="size-full resize-none pb-8"
                  placeholder={t(($) => $['feature.moderation.modal.keywords.placeholder'], {
                    ns: 'appDebug',
                  })}
                />
                <div className="absolute inset-e-2 bottom-2 flex h-5 items-center rounded-md bg-background-section px-1 system-2xs-medium-uppercase text-text-quaternary">
                  <span>
                    {(localeData.config?.keywords || '').split('\n').filter(Boolean).length}
                  </span>
                  /
                  <span className="text-text-tertiary">
                    100
                    {t(($) => $['feature.moderation.modal.keywords.line'], { ns: 'appDebug' })}
                  </span>
                </div>
              </div>
            </div>
          )}
          {localeData.type === 'api' && (
            <div className="flex flex-col gap-1">
              <div className="flex h-6 items-center justify-between">
                <div className="system-sm-medium text-text-secondary">
                  {t(($) => $['apiBasedExtension.selector.title'], { ns: 'common' })}
                </div>
                <a
                  href={docLink('/use-dify/workspace/api-extension/api-extension')}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center system-xs-regular text-text-tertiary hover:text-primary-600"
                >
                  <span className="me-1 i-custom-vender-line-education-book-open-01 size-3 text-text-tertiary group-hover:text-primary-600" />
                  {t(($) => $['apiBasedExtension.link'], { ns: 'common' })}
                </a>
              </div>
              <ApiBasedExtensionSelector
                value={localeData.config?.api_based_extension_id || ''}
                onChange={handleDataApiBasedChange}
              />
            </div>
          )}
          {systemTypes.findIndex((t) => t === localeData.type) < 0 &&
            currentProvider?.form_schema && (
              <FormGeneration
                forms={currentProvider?.form_schema}
                value={localeData.config}
                onChange={handleDataExtraChange}
              />
            )}
          <div className="flex flex-col gap-2">
            <LabeledDivider>
              {t(($) => $['feature.moderation.title'], { ns: 'appDebug' })}
            </LabeledDivider>
            <ModerationContent
              key={`inputs-${localeData.type}-${localeData.config?.inputs_config?.preset_response ?? ''}`}
              title={t(($) => $['feature.moderation.modal.content.input'], { ns: 'appDebug' })}
              config={localeData.config?.inputs_config || { enabled: false, preset_response: '' }}
              onConfigChange={(config) => handleDataContentChange('inputs_config', config)}
              info={
                (localeData.type === 'api' &&
                  t(($) => $['feature.moderation.modal.content.fromApi'], { ns: 'appDebug' })) ||
                ''
              }
              showPreset={localeData.type !== 'api'}
            />
            <ModerationContent
              key={`outputs-${localeData.type}-${localeData.config?.outputs_config?.preset_response ?? ''}`}
              title={t(($) => $['feature.moderation.modal.content.output'], { ns: 'appDebug' })}
              config={localeData.config?.outputs_config || { enabled: false, preset_response: '' }}
              onConfigChange={(config) => handleDataContentChange('outputs_config', config)}
              info={
                (localeData.type === 'api' &&
                  t(($) => $['feature.moderation.modal.content.fromApi'], { ns: 'appDebug' })) ||
                ''
              }
              showPreset={localeData.type !== 'api'}
            />
            <div className="py-0.5 system-xs-regular text-text-tertiary">
              {t(($) => $['feature.moderation.modal.content.condition'], { ns: 'appDebug' })}
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" size="medium" className="min-w-18" />}>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </DialogClose>
          <Button
            variant="primary"
            size="medium"
            type="submit"
            disabled={localeData.type === 'openai_moderation' && !isOpenAIProviderConfigured}
            className="min-w-18"
          >
            {t(($) => $['operation.save'], { ns: 'common' })}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

export default ModerationSettingModal
