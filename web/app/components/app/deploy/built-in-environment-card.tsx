'use client'

import { useTranslation } from 'react-i18next'
import { AccessPointIcon } from './access-point-icon'
import { DeploymentStatus } from './deployment-status'
import { ACCESS_POINT_ORDER, BUILT_IN_ENVIRONMENT } from './mock-data'
import { VersionLabel } from './version-label'

function Divider() {
  return (
    <div className="i-custom-vender-deploy-line-5 w-3 h-10" />
  )
}

export function BuiltInEnvironmentCard() {
  const { t } = useTranslation('deployments')

  return (
    <section
      aria-labelledby="built-in-environment-title"
      className="rounded-[14px] bg-background-section p-1 shrink-0"
    >
      <div className="flex flex-col gap-2.5 rounded-[10px] border-[0.5px] border-divider-subtle bg-components-panel-bg p-4">
        {/* Icon */}
        <div className="flex size-9 items-center justify-center rounded-lg border-[0.5px] border-divider-regular">
          <span aria-hidden className="i-ri-instance-line size-5 text-text-secondary" />
        </div>
        {/* Info */}
        <div className="flex items-center gap-10">
          <div className="flex flex-col gap-1">
            <h2
              id="built-in-environment-title"
              className="system-md-semibold text-text-primary"
            >
              {t(($) => $['studio.builtInTitle'])}
            </h2>
            <p className="truncate system-xs-regular text-text-tertiary">
              {t(($) => $['studio.builtInDescription'])}
            </p>
          </div>
          <Divider />
          <div className="flex flex-col gap-1">
            <div className="system-2xs-medium-uppercase text-text-tertiary">
              {t(($) => $['studio.liveVersion'])}
            </div>
            <VersionLabel version={BUILT_IN_ENVIRONMENT.version} />
          </div>
          <Divider />
          <div className="flex flex-col gap-1">
            <div className="system-xs-medium-uppercase text-text-tertiary">
              {t(($) => $['studio.accessPoints'])}
            </div>
            <div className="flex items-center gap-1">
              {ACCESS_POINT_ORDER.map((accessPoint) => (
                <AccessPointIcon
                  key={accessPoint}
                  accessPoint={accessPoint}
                  active={BUILT_IN_ENVIRONMENT.accessPoints.includes(accessPoint)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* Status and updated time */}
      <div className="flex items-center justify-between gap-4 px-4 py-2.5">
        <DeploymentStatus status="running" />
        <p className="truncate system-xs-regular text-text-tertiary">
          {t(($) => $['studio.updatedAtBy'], {
            name: BUILT_IN_ENVIRONMENT.actor,
            time: BUILT_IN_ENVIRONMENT.updatedAt,
          })}
        </p>
      </div>
    </section>
  )
}
