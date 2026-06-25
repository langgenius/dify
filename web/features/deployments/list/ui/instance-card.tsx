'use client'

import type {
  AppInstanceSummary,
} from '@dify/contracts/enterprise/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { DeploymentActionsMenu } from '../../components/deployment-actions'
import { CreateReleaseControl } from '../../create-release'
import { openDeployDrawerAtom } from '../../deploy-drawer/state'
import {
  DeploymentAccessLinks,
  DeploymentStatusContent,
  ReleaseMetaTooltip,
} from './instance-card-sections'
import {
  getInstanceTabHref,
  isActiveDeployment,
  isReleaseDeployed,
} from './instance-card-utils'

export function InstanceCard({ summary }: {
  summary: AppInstanceSummary
}) {
  const { t } = useTranslation('deployments')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const openDeployDrawer = useSetAtom(openDeployDrawerAtom)
  const appInstance = summary.appInstance
  const appInstanceId = appInstance.id
  const appName = appInstance.displayName
  const detailHref = getInstanceTabHref(appInstanceId, 'overview')
  const description = appInstance.description.trim()
  const access = summary.accessChannels
  const releaseRows = summary.latestRelease ? [summary.latestRelease] : []
  const hasRelease = releaseRows.length > 0
  const activeDeploymentRows = summary.environmentDeployments.filter(isActiveDeployment)
  const latestRelease = releaseRows[0]
  const latestReleaseTime = latestRelease?.createdAt
  const latestReleaseTimeMs = latestReleaseTime ? Date.parse(latestReleaseTime) : Number.NaN
  const latestReleaseDeployed = isReleaseDeployed(latestRelease, activeDeploymentRows)
  const releaseMeta = latestRelease
    ? [
        latestRelease.displayName,
        Number.isNaN(latestReleaseTimeMs) ? undefined : formatTimeFromNow(latestReleaseTimeMs),
      ].filter(Boolean).join(' · ')
    : t('card.notDeployed')
  const showDeployAction = hasRelease && activeDeploymentRows.length === 0
  const showFooterCreateReleaseAction = !hasRelease

  return (
    <div
      className="group relative col-span-1 inline-flex min-h-40 min-w-0 cursor-default flex-col rounded-xl border border-solid border-components-card-border bg-components-card-bg shadow-xs transition-[border-color,box-shadow] duration-200 ease-in-out hover:border-components-panel-border-subtle hover:shadow-md"
    >
      <DeploymentActionsMenu
        appInstanceId={appInstanceId}
        placement="bottom-end"
        sideOffset={4}
        className="pointer-events-none absolute top-3 right-3 z-10 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
        triggerClassName="data-popup-open:pointer-events-auto data-popup-open:opacity-100"
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <Link
          href={detailHref}
          className="block min-w-0 rounded-t-xl px-4 pt-4 outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        >
          <h3 className="truncate title-md-semi-bold text-text-primary">
            {appName}
          </h3>
          {description
            ? (
                <p className="mt-2 line-clamp-2 system-xs-regular text-text-tertiary">
                  {description}
                </p>
              )
            : (
                <p className="mt-2 truncate system-xs-regular text-text-quaternary">
                  {t('card.noDescription')}
                </p>
              )}
        </Link>

        <div role="group" aria-label={t('card.tooltip.deploymentStatus')} className="min-h-8 px-4 pt-4 pb-3">
          <DeploymentStatusContent
            rows={activeDeploymentRows}
            emptyAction={showDeployAction
              ? (
                  <Button
                    variant="secondary-accent"
                    size="small"
                    className="max-w-full"
                    onClick={() => openDeployDrawer({ appInstanceId })}
                  >
                    <span className="truncate">{t('card.menu.deploy')}</span>
                  </Button>
                )
              : undefined}
          />
        </div>

        <div className="mt-auto flex min-h-11 min-w-0 items-center gap-3 border-t border-divider-subtle px-4 py-2">
          {showFooterCreateReleaseAction
            ? (
                <div className="-ml-2 flex min-w-0 grow items-center">
                  <CreateReleaseControl
                    appInstanceId={appInstanceId}
                    variant="secondary-accent"
                    label={t('card.createFirstRelease')}
                    className="max-w-full"
                  />
                </div>
              )
            : <DeploymentAccessLinks appInstanceId={appInstanceId} access={access} />}
          <ReleaseMetaTooltip release={latestRelease} deployed={latestReleaseDeployed}>
            <Link
              href={latestRelease ? getInstanceTabHref(appInstanceId, 'releases') : getInstanceTabHref(appInstanceId, 'instances')}
              className="min-w-0 shrink truncate text-right system-xs-medium text-text-secondary hover:text-text-primary"
            >
              {releaseMeta}
            </Link>
          </ReleaseMetaTooltip>
        </div>
      </div>
    </div>
  )
}
