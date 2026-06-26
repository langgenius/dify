'use client'

import type { AccessChannels, ApiKeySummary } from '@dify/contracts/enterprise/types.gen'
import { RuntimeInstanceStatus } from '@dify/contracts/enterprise/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import Link from '@/next/link'
import { deploymentRouteAppInstanceIdAtom } from '../../../route-state'
import { DeploymentStatusBadge } from '../../../shared/ui/deployment-status-badge'
import { OVERVIEW_CARD_CLASS_NAME, OVERVIEW_ICON_CLASS_NAME, OVERVIEW_INTERACTIVE_CARD_CLASS_NAME } from '../components/card-styles'

type AccessStatusSectionProps = {
  accessChannels?: AccessChannels
}

type ApiTokenSummarySectionProps = {
  accessChannels?: AccessChannels
  apiKeySummary?: ApiKeySummary
  deployedEnvironmentCount: number
}

type AccessStatusItem = {
  key: 'webapp' | 'cli'
  href: string
  icon: string
  label: string
  enabled: boolean
  meta: string
}

const ACCESS_STATUS_SKELETON_KEYS = ['webapp', 'cli']

export function AccessStatusSection({ accessChannels }: AccessStatusSectionProps) {
  const { t } = useTranslation('deployments')
  const appInstanceId = useAtomValue(deploymentRouteAppInstanceIdAtom)

  if (!appInstanceId)
    return null

  const items: AccessStatusItem[] = [
    {
      key: 'webapp',
      href: `/deployments/${appInstanceId}/access`,
      icon: 'i-ri-global-line',
      label: t('card.access.webApp'),
      enabled: Boolean(accessChannels?.webAppEnabled),
      meta: t('overview.accessMeta.webApp'),
    },
    {
      key: 'cli',
      href: `/deployments/${appInstanceId}/access`,
      icon: 'i-ri-terminal-box-line',
      label: t('card.access.cli'),
      enabled: Boolean(accessChannels?.webAppEnabled),
      meta: t('overview.accessMeta.cli'),
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
                <span className="flex shrink-0 items-center gap-2">
                  <StatusBadge enabled={item.enabled} />
                  <span
                    aria-hidden
                    className="i-ri-arrow-right-line size-4 text-text-quaternary opacity-60 transition group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-visible:translate-x-0.5 group-focus-visible:opacity-100"
                  />
                </span>
              </span>
              <span className="truncate text-xs text-text-tertiary">
                {item.meta}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}

export function ApiTokenSummarySection({
  accessChannels,
  apiKeySummary,
  deployedEnvironmentCount,
}: ApiTokenSummarySectionProps) {
  const { t } = useTranslation('deployments')
  const appInstanceId = useAtomValue(deploymentRouteAppInstanceIdAtom)
  const apiEnabled = Boolean(accessChannels?.developerApiEnabled)
  const apiKeyCount = apiKeySummary?.apiKeyCount ?? 0

  if (!appInstanceId)
    return null

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h3 className="system-sm-semibold text-text-primary">
        {t('overview.api')}
      </h3>

      <Link
        href={`/deployments/${appInstanceId}/api-tokens`}
        className={cn(
          OVERVIEW_INTERACTIVE_CARD_CLASS_NAME,
          'group flex min-h-18 min-w-0 items-start gap-3',
        )}
      >
        <span aria-hidden className={OVERVIEW_ICON_CLASS_NAME}>
          <span className="i-ri-code-s-slash-line size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="flex min-w-0 items-center justify-between gap-3">
            <span className="truncate system-sm-medium text-text-primary">
              {t('card.access.api')}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <StatusBadge enabled={apiEnabled} />
              <span
                aria-hidden
                className="i-ri-arrow-right-line size-4 text-text-quaternary opacity-60 transition group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-visible:translate-x-0.5 group-focus-visible:opacity-100"
              />
            </span>
          </span>
          {apiEnabled
            ? (
                <span className="flex min-w-0 flex-wrap gap-2">
                  <span className="inline-flex h-6 min-w-0 items-center rounded-md bg-background-section-burn px-2 system-xs-medium text-text-secondary">
                    {t('overview.apiKeysCount', { count: apiKeyCount })}
                  </span>
                  {/* "deployed environments" = envs with a runtime deployment, not envs-with-keys */}
                  <span className="inline-flex h-6 min-w-0 items-center rounded-md bg-background-section-burn px-2 system-xs-medium text-text-secondary">
                    {t('overview.apiTokenSummary.environments', { count: deployedEnvironmentCount })}
                  </span>
                </span>
              )
            : (
                <span className="truncate text-xs text-text-tertiary">
                  {t('overview.accessMeta.apiTokens')}
                </span>
              )}
        </span>
      </Link>
    </section>
  )
}

function StatusBadge({ enabled }: {
  enabled: boolean
}) {
  const { t } = useTranslation('deployments')

  return (
    <DeploymentStatusBadge
      status={enabled ? RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_READY : RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYED}
      label={enabled ? t('overview.enabled') : t('overview.disabled')}
    />
  )
}

export function ApiTokenSummarySectionSkeleton() {
  const { t } = useTranslation('deployments')

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h3 className="system-sm-semibold text-text-primary">
        {t('overview.api')}
      </h3>
      <ApiTokenSummaryCardSkeleton />
    </section>
  )
}

function ApiTokenSummaryCardSkeleton() {
  return (
    <div
      data-slot="deployment-overview-api-token-card-skeleton"
      className={cn(OVERVIEW_CARD_CLASS_NAME, 'flex min-h-18 min-w-0 items-start gap-3')}
    >
      <SkeletonRectangle className="my-0 size-8 shrink-0 animate-pulse rounded-lg" />
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="flex min-w-0 items-center justify-between gap-3">
          <SkeletonRectangle className="my-0 h-3.5 w-20 animate-pulse" />
          <SkeletonRectangle className="my-0 h-6 w-14 shrink-0 animate-pulse rounded-md" />
        </span>
        <span className="flex gap-2">
          <SkeletonRectangle className="my-0 h-6 w-24 animate-pulse rounded-md" />
          <SkeletonRectangle className="my-0 h-6 w-32 animate-pulse rounded-md" />
        </span>
      </span>
    </div>
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
