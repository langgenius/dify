'use client'
import type { TraceAppConfigResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { ConfigurableTracingProvider } from './providers'
import type { TracingResource } from './resource'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { ProviderCapabilities } from './provider-capabilities'
import { tracingProviders } from './providers'
import { usesAgentTracePipeline } from './resource'

const I18N_PREFIX = 'tracing'

export type ProviderConfigError = {
  onRetry: () => void
  isRetrying: boolean
}

type ProviderPanelProps = {
  resource: TracingResource
  type: ConfigurableTracingProvider
  readOnly: boolean
  pending: boolean
  isChosen: boolean
  config: TraceAppConfigResponse['tracing_config']
  configError?: ProviderConfigError
  onChoose: () => void
}

export function ProviderPanel({
  resource,
  type,
  readOnly,
  pending,
  isChosen,
  config,
  configError,
  onChoose,
}: ProviderPanelProps) {
  const { t } = useTranslation(['app', 'common'])
  const { data: agentTracingEnabled } = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (features) => features.agent_tracing_api_collection_enabled,
    }),
  )
  const iconClassName = tracingProviders[type].panelIcon
  const hasConfigured = !!config

  return (
    <div
      className={cn(
        'relative rounded-xl border-[1.5px] bg-background-section-burn px-4 py-3',
        isChosen
          ? 'border-components-option-card-option-selected-border bg-background-section'
          : 'border-transparent',
      )}
      role="group"
      aria-label={t(($) => $[`${I18N_PREFIX}.${type}.title`], { ns: 'app' })}
    >
      {hasConfigured && !configError && !readOnly && (
        <button
          type="button"
          disabled={pending}
          aria-label={t(($) => $[`${I18N_PREFIX}.${type}.title`], { ns: 'app' })}
          aria-pressed={isChosen}
          className="absolute inset-0 cursor-pointer rounded-xl focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          onClick={() => {
            if (!isChosen) onChoose()
          }}
        />
      )}
      <div className="flex items-center justify-between space-x-1">
        <div className="flex items-center">
          <span aria-hidden className={cn(iconClassName, 'h-6')} />
          {isChosen && (
            <div className="ml-1 flex min-w-4.5 items-center justify-center rounded-[5px] bg-components-badge-bg-dimm px-1.25 py-0.75 system-2xs-medium-uppercase text-text-accent inset-ring-1 inset-ring-text-accent">
              {t(($) => $[`${I18N_PREFIX}.inUse`], { ns: 'app' })}
            </div>
          )}
        </div>
        {configError ? (
          <Button size="small" disabled={configError.isRetrying} onClick={configError.onRetry}>
            {t(($) => $['errorBoundary.tryAgain'], { ns: 'common' })}
          </Button>
        ) : (
          !readOnly && (
            <div className="relative flex items-center justify-between space-x-1">
              {hasConfigured && (
                <a
                  className={buttonVariants({ size: 'small' })}
                  href={config.project_url || undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  role={config.project_url ? undefined : 'link'}
                  aria-disabled={!config.project_url}
                >
                  <span aria-hidden className="i-custom-vender-solid-general-eye size-3" />
                  {t(($) => $[`${I18N_PREFIX}.view`], { ns: 'app' })}
                </a>
              )}
              <DialogTrigger payload={type} render={<Button size="small" disabled={pending} />}>
                <span aria-hidden className="i-ri-equalizer-2-line size-3.5" />
                {t(($) => $[`${I18N_PREFIX}.config`], { ns: 'app' })}
              </DialogTrigger>
            </div>
          )
        )}
      </div>
      <div className="mt-2 system-xs-regular text-text-tertiary">
        {t(($) => $[`${I18N_PREFIX}.${type}.description`], { ns: 'app' })}
      </div>
      {isChosen && usesAgentTracePipeline(resource) && agentTracingEnabled && (
        // Sits above the card-wide selection button, like the card actions.
        <div className="relative">
          <ProviderCapabilities resource={resource} provider={type} />
        </div>
      )}
    </div>
  )
}
