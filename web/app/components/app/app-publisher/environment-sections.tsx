'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { ReactNode } from 'react'
import type { DeploymentVersion } from '@/app/components/app/deploy/version'
import { Button } from '@langgenius/dify-ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import SuggestedAction from '@/app/components/app/app-publisher/suggested-action'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { PublisherTimelineMarker } from './sections'

type PublisherEnvironmentSummarySectionProps = {
  deployment?: EnvironmentDeployment
  environmentTabs: ReactNode
  isEnvironmentInUse: boolean
  latestVersion?: DeploymentVersion | null
  onDeployLatest: () => void
  onDeployOtherVersion: () => void
  onGoToPublish: () => void
  onShowAllVersions: () => void
}

type PublisherEnvironmentActionsSectionProps = {
  appId?: string
  deployment?: EnvironmentDeployment
  environmentId: string
}

function environmentHref(path: string, appId: string, environmentId: string) {
  return `/app/${appId}/${path}?environment=${encodeURIComponent(environmentId)}`
}

function PublisherLatestVersionRow({
  latestVersion,
  onShowAllVersions,
}: {
  latestVersion?: DeploymentVersion | null
  onShowAllVersions: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-1 py-0.5 pr-0.5 pl-1">
      <PublisherTimelineMarker position="bottom" />
      <p className="min-w-0 flex-1 truncate system-xs-regular text-text-tertiary">
        <span className="capitalize">
          {t(($) => $['overview.chip.latest'], { ns: 'deployments' })}
        </span>
        {latestVersion ? `: ${latestVersion.name}` : ''}
      </p>
      <button
        type="button"
        className="flex shrink-0 items-center gap-0.5 rounded system-xs-regular text-text-tertiary outline-hidden hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        onClick={onShowAllVersions}
      >
        {t(($) => $['studio.allVersions'], { ns: 'deployments' })}
        <span aria-hidden className="i-ri-arrow-right-s-line size-3.5" />
      </button>
    </div>
  )
}

export function PublisherEnvironmentSummarySection({
  deployment,
  environmentTabs,
  isEnvironmentInUse,
  latestVersion,
  onDeployLatest,
  onDeployOtherVersion,
  onGoToPublish,
  onShowAllVersions,
}: PublisherEnvironmentSummarySectionProps) {
  const { t } = useTranslation()
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const deploymentState = deployment?.deployment
  const deployedVersion = deploymentState?.current_version
  const versionsBehind = deploymentState?.versions_behind
  const versionsBehindLabel =
    versionsBehind === undefined
      ? undefined
      : versionsBehind === 1
        ? t(($) => $['studio.versionsBehind_one'], {
            ns: 'deployments',
            count: versionsBehind,
          })
        : t(($) => $['studio.versionsBehind_other'], {
            ns: 'deployments',
            count: versionsBehind,
          })
  const isLatestVersion = Boolean(
    deployedVersion &&
    (latestVersion
      ? deployedVersion.id === latestVersion.id
      : deploymentState?.versions_behind === 0),
  )
  const deployedAt = deploymentState?.deployed_at
    ? Date.parse(deploymentState.deployed_at)
    : undefined
  const publishedAt =
    deployedAt !== undefined && Number.isFinite(deployedAt) ? deployedAt : undefined
  const publishedBy = deploymentState?.deployed_by?.display_name
  const showNoPublishedVersionState = !isEnvironmentInUse && latestVersion === null

  if (!deployedVersion) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {environmentTabs}
        <div className="flex items-start gap-1 px-1 py-0.5">
          <PublisherTimelineMarker position="top" />
          <div className="min-w-0 flex-1">
            <p className="system-xs-regular text-text-tertiary">
              {showNoPublishedVersionState
                ? t(($) => $['studio.accessPoint.noPublishedTitle'], {
                    ns: 'deployments',
                  })
                : t(($) => $['studio.publisher.notDeployedYet'], {
                    ns: 'deployments',
                  })}
            </p>
            {showNoPublishedVersionState && (
              <p className="system-xs-regular text-text-tertiary">
                {t(($) => $['studio.publisher.noPublishedDescription'], {
                  ns: 'deployments',
                })}
              </p>
            )}
          </div>
        </div>
        {showNoPublishedVersionState ? (
          <Button variant="primary" className="w-full" onClick={onGoToPublish}>
            {t(($) => $['studio.accessPoint.goToPublish'], { ns: 'deployments' })}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="primary"
              className="w-full"
              disabled={!latestVersion}
              onClick={onDeployLatest}
            >
              {t(($) => $['studio.deployLatest'], { ns: 'deployments' })}
            </Button>
            <PublisherLatestVersionRow
              latestVersion={latestVersion}
              onShowAllVersions={onShowAllVersions}
            />
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {environmentTabs}
      <div className="flex items-start gap-1 px-1 py-0.5">
        <PublisherTimelineMarker position="top" />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-center gap-1">
            <span className="truncate system-sm-semibold text-text-secondary">
              {deployedVersion.marked_name || deployedVersion.version}
            </span>
            {versionsBehindLabel && !isLatestVersion && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      role="status"
                      aria-label={versionsBehindLabel}
                      className="inline-flex h-4.5 shrink-0 items-center rounded-[5px] border border-util-colors-orange-orange-500 px-1 system-2xs-medium text-util-colors-orange-orange-600"
                    >
                      <span aria-hidden className="i-ri-arrow-up-line size-3" />
                      {versionsBehind}
                    </span>
                  }
                />
                <TooltipContent role="tooltip">{versionsBehindLabel}</TooltipContent>
              </Tooltip>
            )}
            {isLatestVersion && (
              <span className="inline-flex min-w-4 shrink-0 items-center justify-center rounded-[5px] border border-text-accent bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-accent">
                {t(($) => $['overview.chip.latest'], { ns: 'deployments' })}
              </span>
            )}
          </div>
          {publishedAt !== undefined && publishedBy && (
            <p className="truncate system-xs-regular text-text-tertiary">
              {t(($) => $['common.publishedBy'], {
                ns: 'workflow',
                time: formatTimeFromNow(publishedAt),
                author: publishedBy,
              })}
            </p>
          )}
        </div>
      </div>
      <div className="flex w-full flex-col gap-1">
        <Button
          type="button"
          variant="primary"
          className="w-full"
          disabled={isLatestVersion || !latestVersion}
          onClick={onDeployLatest}
        >
          {t(($) => $['studio.deployLatest'], { ns: 'deployments' })}
        </Button>
        {isLatestVersion && (
          <Button
            type="button"
            variant="tertiary"
            className="w-full gap-1"
            onClick={onDeployOtherVersion}
          >
            {t(($) => $['studio.deployOtherVersion'], { ns: 'deployments' })}
            <span aria-hidden className="i-ri-arrow-right-line size-4" />
          </Button>
        )}
      </div>
      {!isLatestVersion && (
        <PublisherLatestVersionRow
          latestVersion={latestVersion}
          onShowAllVersions={onShowAllVersions}
        />
      )}
    </div>
  )
}

export function PublisherEnvironmentActionsSection({
  appId,
  deployment,
  environmentId,
}: PublisherEnvironmentActionsSectionProps) {
  const { t } = useTranslation()
  const actionsDisabled = !appId || !deployment?.deployment?.current_version
  const accessPointHref = appId ? environmentHref('access-point', appId, environmentId) : undefined
  const deployHref = appId ? environmentHref('deploy', appId, environmentId) : undefined

  return (
    <div className="flex flex-col border-t-[0.5px] border-t-divider-regular p-3">
      <SuggestedAction
        disabled={actionsDisabled}
        description={t(($) => $['common.accessPointDescription'], { ns: 'workflow' })}
        link={accessPointHref}
        icon={<span className="i-custom-vender-agent-v2-access-point size-4" />}
      >
        {t(($) => $['appMenus.accessPoint'], { ns: 'common' })}
      </SuggestedAction>
      <SuggestedAction
        disabled={actionsDisabled}
        description={t(($) => $['common.deployDescription'], { ns: 'workflow' })}
        link={deployHref}
        icon={<span className="i-ri-instance-line size-4" />}
      >
        {t(($) => $['appMenus.deploy'], { ns: 'common' })}
      </SuggestedAction>
    </div>
  )
}
