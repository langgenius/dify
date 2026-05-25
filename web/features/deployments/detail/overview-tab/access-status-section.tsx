'use client'

import type { AccessChannels } from '@dify/contracts/enterprise/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import Link from '@/next/link'
import { OVERVIEW_CARD_CLASS_NAME, OVERVIEW_ICON_CLASS_NAME, OVERVIEW_INTERACTIVE_CARD_CLASS_NAME, OVERVIEW_STATUS_BADGE_CLASS_NAME } from './card-styles'

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
              OVERVIEW_INTERACTIVE_CARD_CLASS_NAME,
              'group flex min-h-18 min-w-0 items-start gap-3',
            )}
          >
            <span
              aria-hidden
              className={OVERVIEW_ICON_CLASS_NAME}
            >
              <span className={cn('size-4', item.icon)} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex min-w-0 items-center justify-between gap-3">
                <span className="truncate system-sm-medium text-text-primary">
                  {item.label}
                </span>
                <span
                  className={cn(
                    OVERVIEW_STATUS_BADGE_CLASS_NAME,
                    item.enabled
                      ? 'text-util-colors-green-green-700'
                      : 'text-text-tertiary',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      item.enabled ? 'bg-util-colors-green-green-500' : 'bg-text-quaternary',
                    )}
                  />
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
            className={cn(OVERVIEW_CARD_CLASS_NAME, 'flex min-h-18 min-w-0 items-start gap-3')}
          >
            <SkeletonRectangle className="my-0 size-8 shrink-0 animate-pulse rounded-lg" />
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="flex min-w-0 items-center justify-between gap-3">
                <SkeletonRectangle className="my-0 h-3.5 w-20 animate-pulse" />
                <SkeletonRectangle className="my-0 h-6 w-14 shrink-0 animate-pulse rounded-md" />
              </span>
              <SkeletonRectangle className="my-0 h-3 w-4/5 animate-pulse" />
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
