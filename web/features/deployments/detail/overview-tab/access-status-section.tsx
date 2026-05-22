'use client'

import type { AccessChannels } from '@dify/contracts/enterprise/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import Link from '@/next/link'

type AccessStatusSectionProps = {
  appInstanceId: string
  accessChannels?: AccessChannels
  apiKeyCount?: number
}

type AccessStatusItem = {
  key: 'webapp' | 'cli' | 'api'
  href: string
  icon: string
  label: string
  enabled: boolean
  meta?: string
}

const ACCESS_STATUS_SKELETON_KEYS = ['webapp', 'cli', 'api']

export function AccessStatusSection({ appInstanceId, accessChannels, apiKeyCount }: AccessStatusSectionProps) {
  const { t } = useTranslation('deployments')
  const items: AccessStatusItem[] = [
    {
      key: 'webapp',
      href: `/deployments/${appInstanceId}/access`,
      icon: 'i-ri-global-line',
      label: t('card.access.webApp'),
      enabled: Boolean(accessChannels?.webAppEnabled),
    },
    {
      key: 'cli',
      href: `/deployments/${appInstanceId}/access`,
      icon: 'i-ri-terminal-box-line',
      label: t('card.access.cli'),
      enabled: Boolean(accessChannels?.webAppEnabled),
    },
    {
      key: 'api',
      href: `/deployments/${appInstanceId}/api`,
      icon: 'i-ri-code-s-slash-line',
      label: t('card.access.api'),
      enabled: Boolean(accessChannels?.developerApiEnabled),
      meta: accessChannels?.developerApiEnabled && apiKeyCount != null
        ? t('overview.apiKeysCount', { count: apiKeyCount })
        : undefined,
    },
  ]

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h3 className="system-sm-semibold text-text-primary">
        {t('overview.accessStatus')}
      </h3>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3">
        {items.map(item => (
          <Link
            key={item.key}
            href={item.href}
            className={cn(
              'group flex min-w-0 items-start gap-3 rounded-xl border p-4 transition-colors',
              item.enabled
                ? 'border-components-panel-border bg-components-panel-bg hover:bg-components-panel-on-panel-item-bg-hover'
                : 'border-divider-subtle bg-background-default-subtle hover:bg-state-base-hover',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-lg',
                item.enabled
                  ? 'bg-util-colors-green-green-50 text-util-colors-green-green-700'
                  : 'bg-background-section-burn text-text-tertiary',
              )}
            >
              <span className={cn('size-4.5', item.icon)} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex min-w-0 items-center justify-between gap-3">
                <span className="truncate system-sm-medium text-text-primary">
                  {item.label}
                </span>
                <span
                  className={cn(
                    'inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-xs',
                    item.enabled
                      ? 'bg-util-colors-green-green-50 text-util-colors-green-green-700'
                      : 'bg-background-section-burn text-text-tertiary',
                  )}
                >
                  {item.enabled ? t('overview.enabled') : t('overview.disabled')}
                </span>
              </span>
              <span className="truncate text-xs text-text-tertiary">
                {item.meta || t('overview.notConfigured')}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}

export function AccessStatusSectionSkeleton() {
  const { t } = useTranslation('deployments')

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h3 className="system-sm-semibold text-text-primary">
        {t('overview.accessStatus')}
      </h3>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3">
        {ACCESS_STATUS_SKELETON_KEYS.map(key => (
          <div
            key={key}
            data-slot="deployment-overview-access-card-skeleton"
            className="flex min-w-0 items-start gap-3 rounded-xl border border-components-panel-border bg-components-panel-bg p-4"
          >
            <SkeletonRectangle className="my-0 size-9 shrink-0 animate-pulse rounded-lg" />
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="flex min-w-0 items-center justify-between gap-3">
                <SkeletonRectangle className="my-0 h-3.5 w-20 animate-pulse" />
                <SkeletonRectangle className="my-0 h-5 w-12 shrink-0 animate-pulse rounded-md" />
              </span>
              <SkeletonRectangle className="my-0 h-3 w-4/5 animate-pulse" />
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
