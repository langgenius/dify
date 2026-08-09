'use client'

import type { WorkflowVersion } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { Node } from '@/app/components/workflow/types'
import { DeploymentStatus as DeploymentStatusEnum } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { BlockEnum, isTriggerNode } from '@/app/components/workflow/types'
import useTimestamp from '@/hooks/use-timestamp'
import { useMCPServerDetail } from '@/service/use-tools'
import { appWorkflowQueryOptions } from '@/service/workflow-queries'
import { ACCESS_POINT_ORDER, getAccessPointHref } from '../access-point'
import { AccessPointIcon } from '../shared/access-point-icon'
import { DeploymentStatus } from '../shared/deployment-status'
import { VersionLabel } from '../shared/version-label'

function Divider() {
  return <div className="i-custom-vender-deploy-line-5 h-10 w-3" />
}

export function BuiltInEnvironmentCard() {
  const { t } = useTranslation('deployments')
  const { formatTime } = useTimestamp()
  const appDetail = useAppStore((state) => state.appDetail)
  const appId = appDetail?.id ?? ''
  const { data: publishedWorkflow } = useQuery(appWorkflowQueryOptions(appId || null))
  const { data: mcpServerDetail } = useMCPServerDetail(appId, Boolean(appId))
  const publishedNodes = Array.isArray(publishedWorkflow?.graph.nodes)
    ? (publishedWorkflow.graph.nodes as Node[])
    : []
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
  const publishedVersion: WorkflowVersion | undefined = publishedWorkflow
    ? {
        created_at: publishedWorkflow.created_at,
        created_by: publishedWorkflow.created_by ?? undefined,
        id: publishedWorkflow.id,
        marked_comment: publishedWorkflow.marked_comment,
        marked_name: publishedWorkflow.marked_name,
        version: publishedWorkflow.version,
        version_number: publishedWorkflow.version_number ?? undefined,
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
            <VersionLabel version={publishedVersion} isLatest />
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
                  href={getAccessPointHref(appId, 'built-in', accessPoint)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* Status and updated time */}
      <div className="flex items-center justify-between gap-4 px-4 py-2.5">
        <DeploymentStatus status={DeploymentStatusEnum.DEPLOYMENT_STATUS_RUNNING} />
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
