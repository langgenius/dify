import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { ReactNode } from 'react'
import type { DeploymentVersion } from '@/app/components/app/deploy/version'
import { DeploymentStatus } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { getWorkflowVersionName } from '@/app/components/workflow/utils/version'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { PublisherTimelineMarker } from '../shared/timeline-marker'
import { PublisherLatestVersionRow } from './latest-version-row'

export function PublisherEnvironmentSummarySection({
  deployment,
  deploymentActionsDisabled,
  environmentTabs,
  isEnvironmentInUse,
  latestVersion,
  onDeployLatest,
  onDeployOtherVersion,
  onGoToPublish,
  onShowAllVersions,
}: {
  deployment?: EnvironmentDeployment
  deploymentActionsDisabled: boolean
  environmentTabs: ReactNode
  isEnvironmentInUse: boolean
  latestVersion?: DeploymentVersion | null
  onDeployLatest: () => void
  onDeployOtherVersion: () => void
  onGoToPublish: () => void
  onShowAllVersions: () => void
}) {
  const { t } = useTranslation()
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const deploymentState = deployment?.deployment
  const deployedVersion = deploymentState?.current_version
  const isDeploying = deploymentState?.status === DeploymentStatus.DEPLOYMENT_STATUS_DEPLOYING
  const deployingVersion = deploymentState?.latest_operation?.target_version
  const deployingVersionName = deployingVersion
    ? getWorkflowVersionName(
        deployingVersion,
        t(($) => $['versionHistory.defaultName'], { ns: 'workflow' }),
      )
    : undefined
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
  const publishedAt = deploymentState?.deployed_at ? deploymentState.deployed_at * 1000 : undefined
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
              disabled={deploymentActionsDisabled || !latestVersion}
              onClick={onDeployLatest}
            >
              {isDeploying
                ? t(($) => $['deployDrawer.deploying'], { ns: 'deployments' })
                : t(($) => $['studio.deployLatest'], { ns: 'deployments' })}
            </Button>
            <PublisherLatestVersionRow
              deployingVersionName={deployingVersionName}
              disabled={deploymentActionsDisabled}
              isDeploying={isDeploying}
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
              {getWorkflowVersionName(
                deployedVersion,
                t(($) => $['versionHistory.defaultName'], { ns: 'workflow' }),
              )}
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
          disabled={deploymentActionsDisabled || isLatestVersion || !latestVersion}
          onClick={onDeployLatest}
        >
          {isDeploying
            ? t(($) => $['deployDrawer.deploying'], { ns: 'deployments' })
            : t(($) => $['studio.deployLatest'], { ns: 'deployments' })}
        </Button>
        {isLatestVersion && !isDeploying && (
          <Button
            type="button"
            variant="tertiary"
            className="w-full gap-1"
            disabled={deploymentActionsDisabled}
            onClick={onDeployOtherVersion}
          >
            {t(($) => $['studio.deployAnotherVersion'], { ns: 'deployments' })}
            <span aria-hidden className="i-ri-arrow-right-line size-4" />
          </Button>
        )}
      </div>
      {(isDeploying || !isLatestVersion) && (
        <PublisherLatestVersionRow
          deployingVersionName={deployingVersionName}
          disabled={deploymentActionsDisabled}
          isDeploying={isDeploying}
          latestVersion={latestVersion}
          onShowAllVersions={onShowAllVersions}
        />
      )}
    </div>
  )
}
