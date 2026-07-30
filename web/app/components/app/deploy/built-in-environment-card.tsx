'use client'

import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { BlockEnum, isTriggerNode } from '@/app/components/workflow/types'
import useTimestamp from '@/hooks/use-timestamp'
import { useMCPServerDetail } from '@/service/use-tools'
import { useAppWorkflow } from '@/service/use-workflow'
import { AccessPointIcon } from './access-point-icon'
import { DeploymentStatus } from './deployment-status'
import { ACCESS_POINT_ORDER } from './mock-data'
import { VersionLabel } from './version-label'

function Divider() {
  return <div className="i-custom-vender-deploy-line-5 h-10 w-3" />
}

export function BuiltInEnvironmentCard() {
  const { t } = useTranslation('deployments')
  const { formatTime } = useTimestamp()
  const appDetail = useAppStore((state) => state.appDetail)
  const appId = appDetail?.id ?? ''
  const { data: publishedWorkflow } = useAppWorkflow(appId)
  const { data: mcpServerDetail } = useMCPServerDetail(appId, Boolean(appId))
  const publishedNodes = publishedWorkflow?.graph.nodes ?? []
  const hasStartNode = publishedNodes.some((node) => node.data.type === BlockEnum.Start)
  const hasTriggerNode = publishedNodes.some((node) => isTriggerNode(node.data.type))
  const serviceModeAvailable = Boolean(publishedWorkflow && hasStartNode && !hasTriggerNode)
  const activeAccessPoints = {
    mcp: serviceModeAvailable && mcpServerDetail?.status === 'active',
    serviceApi: serviceModeAvailable && Boolean(appDetail?.enable_api),
    trigger: Boolean(publishedWorkflow && hasTriggerNode),
    webApp: serviceModeAvailable && Boolean(appDetail?.enable_site),
  }
  const publishedBy = publishedWorkflow?.created_by?.name ?? appDetail?.author_name ?? '--'
  const updatedBy = publishedWorkflow?.updated_by?.name ?? publishedBy
  const liveVersion = publishedWorkflow
    ? {
        description: publishedWorkflow.marked_comment || undefined,
        latest: true,
        name: publishedWorkflow.marked_name || publishedWorkflow.version,
        publishedAt: publishedWorkflow.created_at * 1000,
        publishedBy,
      }
    : undefined

  return (
    <section
      aria-labelledby="built-in-environment-title"
      className="shrink-0 rounded-[14px] bg-background-section p-1"
    >
      <div className="flex flex-col gap-2.5 rounded-[10px] border-[0.5px] border-divider-subtle bg-components-panel-bg p-4">
        {/* Icon */}
        <div className="flex size-9 items-center justify-center rounded-lg border-[0.5px] border-divider-regular">
          <span aria-hidden className="i-ri-instance-line size-5 text-text-secondary" />
        </div>
        {/* Info */}
        <div className="flex items-center gap-10">
          <div className="flex flex-col gap-1">
            <h2 id="built-in-environment-title" className="system-md-semibold text-text-primary">
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
            <VersionLabel version={liveVersion} />
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
                  active={activeAccessPoints[accessPoint]}
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
          {publishedWorkflow
            ? t(($) => $['studio.updatedAtBy'], {
                name: updatedBy,
                time: formatTime(publishedWorkflow.updated_at, 'MM-DD HH:mm'),
              })
            : '--'}
        </p>
      </div>
    </section>
  )
}
