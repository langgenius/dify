'use client'

import type { ExternalTracingConfigurationResponse } from '@dify/contracts/api/console/external-agents/types.gen'
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
import { skipToken, useMutation, useQueries } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { configurableProviders, tracingProviders } from '@/app/components/app/tracing/providers'
import { TracingIcon } from '@/app/components/app/tracing/tracing-icon'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { consoleQuery } from '@/service/console'
import { ProviderConfigurationDialog } from './tracing-provider-dialog'

type ProviderConfiguration = {
  enabled: boolean
  provider: ConfigurableTracingProvider | null
  configs: Partial<Record<ConfigurableTracingProvider, ExternalTracingConfigurationResponse>>
}

type ProviderPanelProps = {
  configured: boolean
  inUse: boolean
  provider: ConfigurableTracingProvider
  onConfigure: () => void
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

function ExternalAgentTracingConfigurationSession({ agentId }: { agentId: string }) {
  const { t } = useTranslation(['app', 'common', 'agentRoster'])
  const canManage = useAtomValue(isCurrentWorkspaceManagerAtom)
  const queries = useQueries({
    queries: configurableProviders.map((provider) =>
      consoleQuery.externalAgents.byAgentId.tracingConfig.byProvider.get.queryOptions({
        input: canManage ? { params: { agent_id: agentId, provider } } : skipToken,
        retry: false,
      }),
    ),
  })
  const save = useMutation(
    consoleQuery.externalAgents.byAgentId.tracingConfig.byProvider.put.mutationOptions({
      context: { silent: true },
    }),
  )
  const remove = useMutation(
    consoleQuery.externalAgents.byAgentId.tracingConfig.byProvider.delete.mutationOptions({
      context: { silent: true },
    }),
  )
  const [editor, setEditor] = useState<{
    config: ExternalTracingConfigurationResponse | undefined
    inUse: boolean
    provider: ConfigurableTracingProvider
    open: boolean
  } | null>(null)
  const titleId = useId()
  const configs: ProviderConfiguration['configs'] = {}
  configurableProviders.forEach((provider, index) => {
    const config = queries[index]?.data?.configuration
    if (config) configs[provider] = config
  })
  const configuredProviders = configurableProviders.filter((provider) => configs[provider])
  const selectedProvider =
    configuredProviders.find((provider) => configs[provider]?.enabled) ??
    configuredProviders[0] ??
    null
  const configuration = {
    provider: selectedProvider,
    enabled: selectedProvider ? configs[selectedProvider]?.enabled === true : false,
    configs,
  }
  const configuringProvider = editor?.provider ?? null
  const closeEditor = () => setEditor((current) => current && { ...current, open: false })
  const selectedProviderConfig = selectedProvider ? configs[selectedProvider] : undefined
  const isWriting = save.isPending || remove.isPending
  const cannotEnable = isWriting || (!configuration.enabled && !selectedProviderConfig)
  const availableProviders = configurableProviders.filter((provider) => !configs[provider])
  const failure = save.error ?? remove.error
  const failureMessage =
    failure instanceof Error
      ? failure.message
      : failure
        ? t(($) => $['external.api.saveFailed'], { ns: 'agentRoster' })
        : undefined

  function updateConfiguration(changes: {
    enabled?: boolean
    provider?: ConfigurableTracingProvider
  }) {
    const provider = changes.provider ?? selectedProvider
    const config = provider ? configs[provider] : undefined
    if (!provider || !config || isWriting) return
    const values = Object.fromEntries(
      tracingProviders[provider].fields
        .filter((field) => !field.secret && config.values[field.name] !== undefined)
        .map((field) => [field.name, config.values[field.name]]),
    )
    save.mutate({
      params: { agent_id: agentId, provider },
      body: {
        config: values,
        enabled: changes.enabled ?? configuration.enabled,
        capture_content: config.capture_content,
        expected_revision: config.revision,
      },
    })
  }
  function openEditor(provider: ConfigurableTracingProvider) {
    if (isWriting) return
    save.reset()
    remove.reset()
    setEditor({
      config: configs[provider],
      inUse: configuration.enabled && provider === selectedProvider,
      provider,
      open: true,
    })
  }
  function saveProviderConfig(
    provider: ConfigurableTracingProvider,
    values: Record<string, string>,
    captureContent: boolean,
  ) {
    if (isWriting) return
    save.mutate(
      {
        params: { agent_id: agentId, provider },
        body: {
          config: values,
          enabled: editor?.config?.enabled ?? true,
          capture_content: captureContent,
          expected_revision: editor?.config?.revision ?? 0,
        },
      },
      { onSuccess: closeEditor },
    )
  }
  function removeProviderConfig(provider: ConfigurableTracingProvider) {
    if (!editor?.config || isWriting) return
    remove.mutate(
      {
        params: { agent_id: agentId, provider },
        query: { expected_revision: editor.config.revision },
      },
      { onSuccess: closeEditor },
    )
  }
  async function refreshEditor() {
    if (!editor) return
    const provider = editor.provider
    const response = await queries[configurableProviders.indexOf(provider)]?.refetch()
    if (response?.isSuccess)
      setEditor((current) =>
        current?.provider === provider
          ? { ...current, config: response.data.configuration ?? undefined }
          : current,
      )
  }
  if (!canManage) return null
  if (queries.some((query) => query.isError)) return null
  if (queries.some((query) => query.isPending))
    return <Button loading>{t(($) => $['tracing.title'], { ns: 'app' })}</Button>

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
          {failureMessage && !editor?.open && (
            <p role="alert" className="mt-2 system-xs-regular text-text-destructive">
              {failureMessage}
            </p>
          )}
          <Separator className="my-3 bg-divider-subtle" />
          <RadioGroup<ConfigurableTracingProvider | null>
            aria-label={t(($) => $['tracing.configProviderTitle.configured'], { ns: 'app' })}
            className="block space-y-2"
            value={selectedProvider}
            disabled={isWriting}
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
                    inUse={configuration.enabled && provider === selectedProvider}
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
              onSave={(config, captureContent) =>
                saveProviderConfig(configuringProvider, config, captureContent)
              }
              pending={isWriting}
              error={failureMessage}
              onRefresh={() => void refreshEditor()}
            />
          )}
        </DialogContent>
      </Dialog>
    </Popover>
  )
}

export function ExternalAgentTracingConfiguration({ agentId }: { agentId: string }) {
  return <ExternalAgentTracingConfigurationSession key={agentId} agentId={agentId} />
}
