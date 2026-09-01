import type { DeploymentVersion } from '@/app/components/app/deploy/version'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { PublisherDeployingMarker } from '../publisher-deploying-marker'
import { PublisherTimelineMarker } from '../shared/timeline-marker'

export function PublisherLatestVersionRow({
  deployingVersionName,
  disabled,
  isDeploying,
  latestVersion,
  onShowAllVersions,
}: {
  deployingVersionName?: string
  disabled: boolean
  isDeploying: boolean
  latestVersion?: DeploymentVersion | null
  onShowAllVersions: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-1 py-0.5 pr-0.5 pl-1">
      {isDeploying ? <PublisherDeployingMarker /> : <PublisherTimelineMarker position="bottom" />}
      <p
        role={isDeploying ? 'status' : undefined}
        className={cn(
          'min-w-0 flex-1 truncate',
          isDeploying
            ? 'system-xs-medium text-text-accent'
            : 'system-xs-regular text-text-tertiary',
        )}
      >
        {isDeploying ? (
          deployingVersionName ? (
            t(($) => $['studio.publisher.deployingVersion'], {
              ns: 'deployments',
              version: deployingVersionName,
            })
          ) : (
            t(($) => $['deployDrawer.deploying'], { ns: 'deployments' })
          )
        ) : (
          <>
            <span className="capitalize">
              {t(($) => $['overview.chip.latest'], { ns: 'deployments' })}
            </span>
            {latestVersion ? `: ${latestVersion.name}` : ''}
          </>
        )}
      </p>
      <button
        type="button"
        disabled={disabled}
        className="flex shrink-0 items-center gap-0.5 rounded system-xs-regular text-text-tertiary outline-hidden hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:text-text-disabled"
        onClick={onShowAllVersions}
      >
        {t(($) => $['studio.allVersions'], { ns: 'deployments' })}
        <span aria-hidden className="i-ri-arrow-right-s-line size-3.5" />
      </button>
    </div>
  )
}
