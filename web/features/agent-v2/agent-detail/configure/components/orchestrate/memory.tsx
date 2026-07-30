'use client'

import type { AgentSoulMemoryConfig } from '@dify/contracts/api/console/agent/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'

type MemorySettingsProps = {
  isPending: boolean
  memory?: AgentSoulMemoryConfig
}

const memoryConfigFields = [
  {
    key: 'budget',
    icon: 'i-ri-scales-3-line',
    labelKey: 'agentDetail.memorySettings.budgetLabel',
  },
  {
    key: 'scope',
    icon: 'i-ri-global-line',
    labelKey: 'agentDetail.memorySettings.scopeLabel',
  },
] as const

function MemoryConfigValue({
  icon,
  isPending,
  label,
  value,
}: {
  icon: string
  isPending: boolean
  label: string
  value?: string | null
}) {
  const { t } = useTranslation('agentV2')

  return (
    <div className="flex min-h-19 min-w-0 items-start gap-3 rounded-lg border border-divider-subtle bg-background-section-burn p-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-divider-subtle bg-components-panel-bg text-text-tertiary">
        <span aria-hidden className={`${icon} size-4`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="system-xs-semibold-uppercase text-text-tertiary">{label}</div>
        {isPending ? (
          <SkeletonRectangle className="mt-2 h-4 w-28 animate-pulse rounded-md" />
        ) : (
          <div
            className={cn(
              'mt-1 truncate system-sm-semibold',
              value ? 'text-text-primary' : 'text-text-quaternary',
            )}
            translate={value ? 'no' : undefined}
          >
            {value || t(($) => $['agentDetail.memorySettings.notConfigured'])}
          </div>
        )}
      </div>
    </div>
  )
}

export function MemorySettings({ isPending, memory }: MemorySettingsProps) {
  const { t } = useTranslation('agentV2')

  return (
    <div className="rounded-xl border border-components-panel-border bg-components-panel-bg p-4 shadow-xs">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-state-accent-hover text-text-accent-light-mode-only">
          <span aria-hidden className="i-ri-brain-line size-5" />
        </div>
        <div className="min-w-0">
          <h2 className="system-xl-semibold text-text-primary">
            {t(($) => $['agentDetail.memorySettings.title'])}
          </h2>
          <p className="mt-1 system-sm-regular text-text-tertiary">
            {t(($) => $['agentDetail.memorySettings.description'])}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {memoryConfigFields.map((field) => (
          <MemoryConfigValue
            key={field.key}
            icon={field.icon}
            isPending={isPending}
            label={t(($) => $[field.labelKey])}
            value={memory?.[field.key]}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-divider-subtle pt-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 system-xs-regular text-text-tertiary">
            <span>{t(($) => $['agentDetail.memorySettings.export.title'])}</span>
            <span className="inline-flex items-center gap-1 rounded-[5px] bg-components-badge-bg-dimm px-1.5 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
              {t(($) => $['agentDetail.memorySettings.export.soon'])}
            </span>
          </div>
          <p className="mt-0.5 system-2xs-regular text-text-tertiary">
            {t(($) => $['agentDetail.memorySettings.export.description'])}
          </p>
        </div>
        <Button variant="secondary" size="small" disabled className="gap-1.5">
          <span aria-hidden className="i-ri-download-line size-3.5" />
          {t(($) => $['agentDetail.memorySettings.export.download'])}
        </Button>
      </div>
    </div>
  )
}
