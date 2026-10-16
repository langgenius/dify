'use client'
import type { TraceAppConfigResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { ConfigurableTracingProvider } from './providers'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'
import { tracingProviders } from './providers'

const I18N_PREFIX = 'tracing'

export type ProviderConfigError = {
  onRetry: () => void
  isRetrying: boolean
}

type ProviderPanelProps = {
  type: ConfigurableTracingProvider
  readOnly: boolean
  pending: boolean
  isChosen: boolean
  config: TraceAppConfigResponse['tracing_config']
  configError?: ProviderConfigError
  onChoose: () => void
}

export function ProviderPanel({
  type,
  readOnly,
  pending,
  isChosen,
  config,
  configError,
  onChoose,
}: ProviderPanelProps) {
  const { t } = useTranslation(['app', 'common'])
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
            <div className="ml-1 flex h-4 items-center rounded-sm border border-text-accent-secondary px-1 system-2xs-medium-uppercase text-text-accent-secondary">
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
                <span aria-hidden className="i-ri-equalizer-2-line size-3" />
                {t(($) => $[`${I18N_PREFIX}.config`], { ns: 'app' })}
              </DialogTrigger>
            </div>
          )
        )}
      </div>
      <div className="mt-2 system-xs-regular text-text-tertiary">
        {t(($) => $[`${I18N_PREFIX}.${type}.description`], { ns: 'app' })}
      </div>
    </div>
  )
}
