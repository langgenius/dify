'use client'
import type {
  AppTracePayload,
  AppTraceResponse,
  TraceAppConfigResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { DialogActions } from '@langgenius/dify-ui/dialog'
import type { ProviderConfigError } from './provider-panel'
import type { ConfigurableTracingProvider } from './providers'
import type { TracingResource } from './resource'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { Field, FieldDescription } from '@langgenius/dify-ui/field'
import { PopoverDescription, PopoverTitle } from '@langgenius/dify-ui/popover'
import { Separator } from '@langgenius/dify-ui/separator'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Switch } from '@langgenius/dify-ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useIsMutating, useQuery } from '@tanstack/react-query'
import { useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { ProviderConfigModal } from './provider-config-modal'
import { ProviderPanel } from './provider-panel'
import { configurableProviders, hasProviderForm } from './providers'
import { usesAgentTracePipeline } from './resource'
import { TracePolicy } from './trace-policy'
import { TracingIcon } from './tracing-icon'

type ConfigPopupProps = {
  resource: TracingResource
  configErrors?: Partial<Record<ConfigurableTracingProvider, ProviderConfigError>>
  readOnly: boolean
  pending: boolean
  policyError?: string
  policy?: AppTraceResponse
  onPolicyChange: (changes: Partial<AppTracePayload>) => Promise<void>
  configs: Partial<Record<ConfigurableTracingProvider, TraceAppConfigResponse['tracing_config']>>
}

export function ConfigPopup({
  resource,
  configErrors,
  readOnly,
  pending,
  policyError,
  policy,
  onPolicyChange,
  configs,
}: ConfigPopupProps) {
  const { t } = useTranslation(['app'])
  const dialogActionsRef = useRef<DialogActions>(null)
  const firstInputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const enabled = policy?.enabled ?? false
  const chosenProvider = hasProviderForm(policy?.tracing_provider) ? policy.tracing_provider : null
  const cannotEnable = !readOnly && !enabled && (!chosenProvider || !configs[chosenProvider])
  const switchDescription = readOnly
    ? t(($) => $['tracing.readOnly'])
    : cannotEnable
      ? t(($) => $['tracing.disabledTip'])
      : undefined
  const chooseProvider = (provider: ConfigurableTracingProvider) =>
    onPolicyChange({ tracing_provider: provider, enabled: true })
  const closeConfig = () => dialogActionsRef.current?.close()
  const isConfigMutating =
    useIsMutating({
      mutationKey:
        resource.kind === 'agent'
          ? consoleQuery.agent.byAgentId.traceConfig.key({ type: 'mutation' })
          : consoleQuery.apps.byAppId.traceConfig.key({ type: 'mutation' }),
    }) > 0
  const { data: agentTracingEnabled } = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (features) => features.agent_tracing_api_collection_enabled,
    }),
  )
  // Agent tracing settings only matter once traces have a destination.
  const agentTracingSection =
    usesAgentTracePipeline(resource) && chosenProvider && agentTracingEnabled !== undefined
      ? agentTracingEnabled
        ? 'settings'
        : 'unavailable'
      : null
  const groups = [
    configurableProviders.filter((provider) => !!configs[provider]),
    configurableProviders.filter((provider) => !configs[provider]),
  ] as const
  return (
    <Dialog<ConfigurableTracingProvider>
      actionsRef={dialogActionsRef}
      disablePointerDismissal
      onOpenChange={(open, details) => {
        // A closed dialog could not show a failed save or removal; success closes it imperatively.
        if (!open && isConfigMutating && details.reason !== 'imperative-action') details.cancel()
      }}
    >
      {({ payload: provider }) => (
        <>
          <div className="max-h-[min(32rem,calc(100dvh-8rem))] w-105 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-4 shadow-xl">
            <Field>
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <TracingIcon
                    size="md"
                    className="shrink-0 bg-util-colors-blue-brand-blue-brand-500"
                  />
                  <PopoverTitle id={titleId} className="title-2xl-semi-bold text-text-primary">
                    {t(($) => $['tracing.tracing'])}
                  </PopoverTitle>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="flex items-center gap-1">
                    <span className="flex size-3 items-center justify-center">
                      <StatusDot status={enabled ? 'success' : 'disabled'} />
                    </span>
                    <span
                      className={cn(
                        'system-xs-semibold-uppercase',
                        enabled ? 'text-util-colors-green-green-600' : 'text-text-tertiary',
                      )}
                    >
                      {t(($) => $[enabled ? 'tracing.enabled' : 'tracing.disabled'])}
                    </span>
                  </span>
                  <Tooltip disabled={!switchDescription}>
                    <TooltipTrigger
                      render={
                        <Switch
                          size="lg"
                          aria-labelledby={titleId}
                          checked={enabled}
                          readOnly={readOnly}
                          disabled={cannotEnable}
                          onCheckedChange={(enabled) => {
                            void onPolicyChange({ enabled }).catch(() => {})
                          }}
                        />
                      }
                    />
                    <TooltipContent>{switchDescription}</TooltipContent>
                  </Tooltip>
                </div>
              </div>
              {switchDescription && (
                <FieldDescription className="sr-only">{switchDescription}</FieldDescription>
              )}
            </Field>
            <PopoverDescription className="mt-2 system-xs-regular text-text-tertiary">
              {t(($) => $['tracing.tracingDescription'])}
            </PopoverDescription>
            {policyError && (
              <p role="alert" className="mt-2 system-sm-regular text-text-destructive">
                {policyError}
              </p>
            )}
            {agentTracingSection === 'unavailable' ? (
              // Capture settings and provider support have no effect without Agent tracing.
              <p
                role="note"
                className="my-3 flex gap-1.5 rounded-lg bg-background-section px-2.5 py-2 system-xs-regular text-text-tertiary"
              >
                <span aria-hidden className="mt-px i-ri-information-2-line size-3.5 shrink-0" />
                {t(($) => $['tracing.agentTracingUnavailable'])}
              </p>
            ) : (
              <>
                {agentTracingSection === 'settings' && (
                  <>
                    <Separator className="my-3 bg-divider-subtle" />
                    <TracePolicy policy={policy} readOnly={readOnly} onChange={onPolicyChange} />
                  </>
                )}
                <Separator className="my-3 bg-divider-subtle" />
              </>
            )}
            {readOnly ? (
              chosenProvider ? (
                <ProviderPanel
                  resource={resource}
                  type={chosenProvider}
                  readOnly
                  pending={pending}
                  config={configs[chosenProvider]}
                  isChosen
                  onChoose={() => {}}
                />
              ) : (
                <p className="system-sm-regular text-text-secondary">
                  {t(($) => $['tracing.configProviderTitle.notConfigured'])}
                </p>
              )
            ) : (
              <div className="space-y-2">
                {groups.flatMap((group, index) =>
                  group.length > 0
                    ? [
                        <h4
                          key={index === 0 ? 'configured' : 'available'}
                          className="mt-3 system-xs-medium-uppercase text-text-tertiary"
                        >
                          {t(
                            ($) =>
                              $[
                                `tracing.configProviderTitle.${index === 0 ? 'configured' : groups[0].length > 0 ? 'moreProviders' : 'notConfigured'}`
                              ],
                          )}
                        </h4>,
                        ...group.map((item) => (
                          <ProviderPanel
                            key={item}
                            resource={resource}
                            type={item}
                            readOnly={readOnly}
                            pending={pending}
                            config={configs[item]}
                            configError={configErrors?.[item]}
                            isChosen={chosenProvider === item}
                            onChoose={() => {
                              void chooseProvider(item).catch(() => {})
                            }}
                          />
                        )),
                      ]
                    : [],
                )}
              </div>
            )}
          </div>
          {!readOnly && (
            <DialogContent
              initialFocus={firstInputRef}
              // Recedes behind the nested remove confirmation instead of stacking flat under it.
              className="max-h-[calc(100dvh-2rem)] w-160 translate-y-[calc(-50%+1.25rem*var(--nested-dialogs))] scale-[calc(1-0.1*var(--nested-dialogs))] p-0 transition-[translate,scale,opacity,filter] data-nested-dialog-open:brightness-95"
            >
              {provider && (
                <ProviderConfigModal
                  resource={resource}
                  type={provider}
                  payload={configs[provider]}
                  firstInputRef={firstInputRef}
                  onSaved={closeConfig}
                  onRemoved={closeConfig}
                />
              )}
            </DialogContent>
          )}
        </>
      )}
    </Dialog>
  )
}
