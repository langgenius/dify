'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'

type StrategyKey = 'economy' | 'medium' | 'longHorizon'
type IsolationKey = 'global' | 'perApp' | 'perRun'

type Option<T extends string> = {
  value: T
  icon: string
}

const strategyOptions: Array<Option<StrategyKey>> = [
  { value: 'economy', icon: 'i-ri-leaf-line' },
  { value: 'medium', icon: 'i-ri-scales-3-line' },
  { value: 'longHorizon', icon: 'i-ri-rocket-2-line' },
]

const isolationOptions: Array<Option<IsolationKey>> = [
  { value: 'global', icon: 'i-ri-global-line' },
  { value: 'perApp', icon: 'i-ri-apps-2-line' },
  { value: 'perRun', icon: 'i-ri-flashlight-line' },
]

function SegmentOption({
  active,
  description,
  icon,
  label,
  onSelect,
}: {
  active: boolean
  description: string
  icon: string
  label: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'flex min-h-13 min-w-0 flex-col items-center justify-center gap-0.5 rounded-md border px-2 py-1.5 text-center transition-colors focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
        active
          ? 'border-components-button-primary-border bg-components-button-primary-bg text-components-button-primary-text shadow-xs'
          : 'border-transparent text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
      )}
      onClick={onSelect}
    >
      <span className="flex min-w-0 items-center gap-1 system-xs-semibold">
        <span aria-hidden className={`${icon} size-3.5 shrink-0`} />
        <span className="truncate">{label}</span>
      </span>
      <span className={cn(
        'max-w-full truncate system-2xs-regular',
        active ? 'text-components-button-primary-text/85' : 'text-text-quaternary',
      )}
      >
        {description}
      </span>
    </button>
  )
}

export function MemorySettings() {
  const { t } = useTranslation('agentV2')
  const [strategy, setStrategy] = useState<StrategyKey>('medium')
  const [isolation, setIsolation] = useState<IsolationKey>('perApp')

  return (
    <div className="rounded-xl border border-components-panel-border bg-components-panel-bg p-4 shadow-xs">
      <div className="mb-3 flex items-center gap-1">
        <h2 className="system-xl-semibold text-text-primary">
          {t('agentDetail.memorySettings.title')}
        </h2>
        <Infotip
          aria-label={t('agentDetail.memorySettings.description')}
          iconClassName="i-ri-information-line"
          popupClassName="max-w-[240px]"
        >
          {t('agentDetail.memorySettings.description')}
        </Infotip>
      </div>

      <div className="space-y-3 rounded-lg bg-components-panel-on-panel-item-bg">
        <fieldset>
          <legend className="sr-only">
            {t('agentDetail.memorySettings.strategyLabel')}
          </legend>
          <p className="mb-1.5 system-xs-regular text-text-tertiary">
            {t('agentDetail.memorySettings.description')}
          </p>
          <div className="grid grid-cols-1 gap-1 rounded-lg border border-divider-subtle bg-background-section-burn p-0.5 sm:grid-cols-3">
            {strategyOptions.map(option => (
              <SegmentOption
                key={option.value}
                active={strategy === option.value}
                icon={option.icon}
                label={t(`agentDetail.memorySettings.strategies.${option.value}.label`)}
                description={t(`agentDetail.memorySettings.strategies.${option.value}.budget`)}
                onSelect={() => setStrategy(option.value)}
              />
            ))}
          </div>
        </fieldset>

        <div className="h-px bg-divider-subtle" />

        <fieldset>
          <legend className="mb-1.5 system-xs-regular text-text-tertiary">
            {t('agentDetail.memorySettings.isolation.description')}
          </legend>
          <div className="grid grid-cols-1 gap-1 rounded-lg border border-divider-subtle bg-background-section-burn p-0.5 sm:grid-cols-3">
            {isolationOptions.map(option => (
              <SegmentOption
                key={option.value}
                active={isolation === option.value}
                icon={option.icon}
                label={t(`agentDetail.memorySettings.isolation.${option.value}.label`)}
                description={t(`agentDetail.memorySettings.isolation.${option.value}.scope`)}
                onSelect={() => setIsolation(option.value)}
              />
            ))}
          </div>
        </fieldset>

        <div className="h-px bg-divider-subtle" />

        <div className="flex flex-wrap items-center justify-between gap-3 px-0.5 pt-0.5">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 system-xs-regular text-text-tertiary">
              <span>{t('agentDetail.memorySettings.export.title')}</span>
              <span className="inline-flex items-center gap-1 rounded border border-util-colors-blue-blue-200 bg-util-colors-blue-blue-50 px-1.5 py-0.5 system-2xs-semibold-uppercase text-util-colors-blue-blue-700">
                <span aria-hidden className="i-ri-shield-keyhole-line size-3" />
                {t('agentDetail.memorySettings.export.admin')}
              </span>
            </div>
            <p className="mt-0.5 system-2xs-regular text-text-tertiary">
              {t('agentDetail.memorySettings.export.description')}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-components-button-secondary-border bg-components-button-secondary-bg px-2.5 system-xs-semibold text-components-button-secondary-text shadow-xs hover:bg-components-button-secondary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span aria-hidden className="i-ri-download-line size-3.5" />
            {t('agentDetail.memorySettings.export.download')}
          </button>
        </div>
      </div>
    </div>
  )
}
