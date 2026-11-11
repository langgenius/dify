'use client'

import type { LocalProviderConfig } from './tracing-provider-dialog'
import type { ConfigurableTracingProvider } from '@/app/components/app/tracing/providers'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { Field } from '@langgenius/dify-ui/field'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { Separator } from '@langgenius/dify-ui/separator'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Switch } from '@langgenius/dify-ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { configurableProviders, tracingProviders } from '@/app/components/app/tracing/providers'
import { TracingIcon } from '@/app/components/app/tracing/tracing-icon'
import { ProviderConfigurationDialog } from './tracing-provider-dialog'

type LocalTracingConfiguration = {
  enabled: boolean
  provider: ConfigurableTracingProvider | null
  configs: Partial<Record<ConfigurableTracingProvider, LocalProviderConfig>>
}

type ProviderPanelProps = {
  configured: boolean
  inUse: boolean
  provider: ConfigurableTracingProvider
  onConfigure: () => void
}

const initialConfiguration: LocalTracingConfiguration = {
  enabled: true,
  provider: 'langsmith',
  configs: {
    langsmith: {
      values: { project: 'Contract Review', endpoint: 'https://api.smith.langchain.com' },
      configuredSecrets: ['api_key'],
    },
  },
}

function providerTranslationKey(
  provider: ConfigurableTracingProvider,
  part: 'title' | 'description',
) {
  return `tracing.${provider}.${part}` as const
}

function ProviderPanel({ configured, inUse, provider, onConfigure }: ProviderPanelProps) {
  const { t } = useTranslation(['app'])
  const providerDetails = tracingProviders[provider]

  return (
    <div
      className={cn(
        'relative rounded-xl border-[1.5px] bg-background-section-burn px-4 py-3',
        inUse
          ? 'border-components-option-card-option-selected-border bg-background-section'
          : 'border-transparent',
      )}
      role="group"
      aria-label={t(($) => $[providerTranslationKey(provider, 'title')], { ns: 'app' })}
    >
      {configured && (
        <RadioItem<ConfigurableTracingProvider>
          nativeButton
          value={provider}
          aria-label={t(($) => $[providerTranslationKey(provider, 'title')], { ns: 'app' })}
          render={<Button variant="ghost" />}
          className="absolute inset-0 h-auto w-full cursor-pointer rounded-xl p-0 hover:bg-transparent"
        />
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden className={cn(providerDetails.panelIcon, 'h-6 shrink-0')} />
          {inUse && (
            <span className="rounded-[5px] bg-components-badge-bg-dimm px-1.25 py-0.75 system-2xs-medium-uppercase text-text-accent inset-ring-1 inset-ring-text-accent">
              {t(($) => $['tracing.inUse'], { ns: 'app' })}
            </span>
          )}
        </div>
        <div className="relative shrink-0">
          <Button size="small" onClick={onConfigure}>
            <span aria-hidden className="i-ri-equalizer-2-line size-3.5" />
            {t(($) => $['tracing.config'], { ns: 'app' })}
          </Button>
        </div>
      </div>
      <p className="mt-2 system-xs-regular text-text-tertiary">
        {t(($) => $[providerTranslationKey(provider, 'description')], { ns: 'app' })}
      </p>
    </div>
  )
}

function ExternalAgentTracingConfigurationSession() {
  const { t } = useTranslation(['app'])
  const [configuration, setConfiguration] = useState(initialConfiguration)
  const [editor, setEditor] = useState<{
    config: LocalProviderConfig | undefined
    inUse: boolean
    provider: ConfigurableTracingProvider
    open: boolean
  } | null>(null)
  const configuringProvider = editor?.provider ?? null
  const closeEditor = () => setEditor((current) => current && { ...current, open: false })
  const titleId = useId()
  const selectedProvider = configuration.provider
  const selectedProviderConfig = selectedProvider
    ? configuration.configs[selectedProvider]
    : undefined
  const cannotEnable = !configuration.enabled && (!selectedProvider || !selectedProviderConfig)
  const configuredProviders = configurableProviders.filter(
    (provider) => configuration.configs[provider],
  )
  const availableProviders = configurableProviders.filter(
    (provider) => !configuration.configs[provider],
  )

  const updateConfiguration = (changes: Partial<LocalTracingConfiguration>) => {
    setConfiguration((current) => ({ ...current, ...changes }))
  }

  const openEditor = (provider: ConfigurableTracingProvider) => {
    setEditor({
      config: configuration.configs[provider],
      inUse: configuration.enabled && configuration.provider === provider,
      provider,
      open: true,
    })
  }

  const saveProviderConfig = (
    provider: ConfigurableTracingProvider,
    config: LocalProviderConfig,
  ) => {
    setConfiguration((current) => ({
      ...current,
      enabled: current.configs[provider] ? current.enabled : true,
      provider: current.configs[provider] ? current.provider : provider,
      configs: { ...current.configs, [provider]: config },
    }))
    closeEditor()
  }

  const removeProviderConfig = (provider: ConfigurableTracingProvider) => {
    setConfiguration((current) => {
      const configs = { ...current.configs }
      delete configs[provider]
      const removingInUseProvider = current.provider === provider
      return {
        enabled: removingInUseProvider ? false : current.enabled,
        provider: removingInUseProvider ? null : current.provider,
        configs,
      }
    })
    closeEditor()
  }

  const providerIconClassName = selectedProvider
    ? tracingProviders[selectedProvider].icon
    : undefined
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button className="h-auto gap-0 rounded-xl bg-background-default-lighter p-2 inset-ring-components-panel-border hover:bg-background-default-dodge" />
        }
      >
        {selectedProvider ? (
          <span className="flex items-center gap-2">
            <span className="sr-only">
              {t(($) => $['tracing.config'], { ns: 'app' })}
              {' · '}
              {t(($) => $['tracing.title'], { ns: 'app' })}
              {' · '}
              {t(($) => $[providerTranslationKey(selectedProvider, 'title')], { ns: 'app' })}
              {' · '}
            </span>
            {providerIconClassName && (
              <span aria-hidden className="flex items-center ps-1 pe-2">
                <span className={cn(providerIconClassName, 'h-5')} />
              </span>
            )}
            <span className="flex items-center gap-1">
              <span className="flex size-3 items-center justify-center">
                <StatusDot status={configuration.enabled ? 'success' : 'disabled'} />
              </span>
              <span
                className={cn(
                  'system-xs-semibold-uppercase',
                  configuration.enabled ? 'text-util-colors-green-green-600' : 'text-text-tertiary',
                )}
              >
                {t(($) => $[`tracing.${configuration.enabled ? 'enabled' : 'disabled'}`], {
                  ns: 'app',
                })}
              </span>
            </span>
            <Separator decorative orientation="vertical" className="ms-1 h-3.5" />
            <span aria-hidden className="flex size-6 items-center justify-center rounded-md">
              <span className="i-ri-equalizer-2-line size-4 text-text-tertiary" />
            </span>
          </span>
        ) : (
          <>
            <TracingIcon size="md" />
            <span className="mx-2 system-sm-semibold text-text-secondary">
              {t(($) => $['tracing.title'], { ns: 'app' })}
            </span>
            <span aria-hidden className="rounded-md p-1">
              <span className="i-ri-equalizer-2-line size-4 text-text-tertiary" />
            </span>
            <Separator decorative orientation="vertical" className="mx-2 h-3.5" />
            <span aria-hidden className="rounded-md p-1">
              <span className="i-ri-arrow-down-double-line size-4 text-text-tertiary" />
            </span>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={12}
        className="max-h-[min(32rem,calc(100dvh-8rem))] w-105 max-w-[calc(100vw-2rem)] overflow-y-auto border-none bg-transparent p-0 shadow-none"
      >
        <div className="rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-4 shadow-xl">
          <Field>
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <TracingIcon
                  size="md"
                  className="shrink-0 bg-util-colors-blue-brand-blue-brand-500"
                />
                <PopoverTitle id={titleId} className="title-2xl-semi-bold text-text-primary">
                  {t(($) => $['tracing.tracing'], { ns: 'app' })}
                </PopoverTitle>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="flex items-center gap-1">
                  <span className="flex size-3 items-center justify-center">
                    <StatusDot status={configuration.enabled ? 'success' : 'disabled'} />
                  </span>
                  <span
                    className={cn(
                      'system-xs-semibold-uppercase',
                      configuration.enabled
                        ? 'text-util-colors-green-green-600'
                        : 'text-text-tertiary',
                    )}
                  >
                    {t(($) => $[`tracing.${configuration.enabled ? 'enabled' : 'disabled'}`], {
                      ns: 'app',
                    })}
                  </span>
                </span>
                <Tooltip disabled={!cannotEnable}>
                  <TooltipTrigger
                    render={
                      <Switch
                        size="lg"
                        aria-labelledby={titleId}
                        checked={configuration.enabled}
                        disabled={cannotEnable}
                        onCheckedChange={(enabled) => updateConfiguration({ enabled })}
                      />
                    }
                  />
                  <TooltipContent>
                    {t(($) => $['tracing.disabledTip'], { ns: 'app' })}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </Field>
          <Separator className="my-3 bg-divider-subtle" />
          <RadioGroup<ConfigurableTracingProvider | null>
            aria-label={t(($) => $['tracing.configProviderTitle.configured'], { ns: 'app' })}
            className="block space-y-2"
            value={selectedProvider}
            onValueChange={(provider) => {
              if (provider && configuration.configs[provider])
                updateConfiguration({ enabled: true, provider })
            }}
          >
            {configuredProviders.length > 0 && (
              <>
                <h4 className="mt-3 system-xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['tracing.configProviderTitle.configured'], { ns: 'app' })}
                </h4>
                {configuredProviders.map((provider) => (
                  <ProviderPanel
                    key={provider}
                    configured
                    inUse={provider === selectedProvider}
                    provider={provider}
                    onConfigure={() => openEditor(provider)}
                  />
                ))}
              </>
            )}
            {availableProviders.length > 0 && (
              <>
                <h4 className="mt-3 system-xs-medium-uppercase text-text-tertiary">
                  {t(
                    ($) =>
                      $[
                        configuredProviders.length > 0
                          ? 'tracing.configProviderTitle.moreProviders'
                          : 'tracing.configProviderTitle.notConfigured'
                      ],
                    { ns: 'app' },
                  )}
                </h4>
                {availableProviders.map((provider) => (
                  <ProviderPanel
                    key={provider}
                    configured={false}
                    inUse={false}
                    provider={provider}
                    onConfigure={() => openEditor(provider)}
                  />
                ))}
              </>
            )}
          </RadioGroup>
        </div>
      </PopoverContent>
      <Dialog
        open={editor?.open ?? false}
        onOpenChange={(open) => {
          if (!open) closeEditor()
        }}
        onOpenChangeComplete={(open) => {
          if (!open) setEditor(null)
        }}
      >
        <DialogContent className="w-160">
          {configuringProvider && (
            <ProviderConfigurationDialog
              key={configuringProvider}
              config={editor?.config}
              inUse={editor?.inUse ?? false}
              provider={configuringProvider}
              onRemove={() => removeProviderConfig(configuringProvider)}
              onSave={(config) => saveProviderConfig(configuringProvider, config)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Popover>
  )
}

/**
 * Feature-local, session-only tracing controls for an external Agent preview.
 * `key` resets every configuration draft when the route identity changes.
 */
export function ExternalAgentTracingConfiguration({ agentId }: { agentId: string }) {
  return <ExternalAgentTracingConfigurationSession key={agentId} />
}
