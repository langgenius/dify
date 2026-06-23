'use client'

import type { AgentIconType, AgentReferencingWorkflowResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import useTimestamp from '@/hooks/use-timestamp'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'

type WorkflowReferencesTableProps = {
  agentId: string
}

const workflowTableColSpan = 5

const getWorkflowReferenceHref = (reference: AgentReferencingWorkflowResponse) => `/app/${reference.app_id}/workflow`

export function WorkflowReferencesTable({
  agentId,
}: WorkflowReferencesTableProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const workflowReferencesQuery = useQuery(consoleQuery.agent.byAgentId.referencingWorkflows.get.queryOptions({
    input: {
      params: {
        agent_id: agentId,
      },
    },
  }))
  const workflowReferences = workflowReferencesQuery.data?.data ?? []

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1212px] table-fixed border-collapse">
        <colgroup>
          <col className="w-[572px]" />
          <col className="w-40" />
          <col className="w-32" />
          <col className="w-[204px]" />
          <col className="w-36" />
        </colgroup>
        <thead>
          <tr className="h-7 rounded-lg bg-background-section-burn text-left system-xs-semibold-uppercase text-text-tertiary">
            <th scope="col" className="rounded-l-lg px-3 font-semibold">
              {t('agentDetail.access.workflow.table.name')}
            </th>
            <th scope="col" className="px-3 font-semibold">
              {t('agentDetail.access.workflow.table.version')}
            </th>
            <th scope="col" className="px-3 font-semibold">
              {t('agentDetail.access.workflow.table.nodes')}
            </th>
            <th scope="col" className="px-3 font-semibold">
              {t('agentDetail.access.workflow.table.lastUpdated')}
            </th>
            <th scope="col" className="rounded-r-lg px-3 font-semibold">
              {t('agentDetail.access.workflow.table.actions')}
            </th>
          </tr>
        </thead>
        <tbody className="system-sm-regular text-text-secondary">
          {workflowReferencesQuery.isPending && (
            <WorkflowAccessStateRow>
              {t('agentDetail.access.workflow.loading')}
            </WorkflowAccessStateRow>
          )}
          {workflowReferencesQuery.isError && (
            <WorkflowAccessStateRow>
              <div className="flex items-center justify-center gap-2">
                <span>{t('agentDetail.access.workflow.loadFailed')}</span>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => {
                    void workflowReferencesQuery.refetch()
                  }}
                >
                  {tCommon('operation.retry')}
                </Button>
              </div>
            </WorkflowAccessStateRow>
          )}
          {workflowReferencesQuery.isSuccess && workflowReferences.length === 0 && (
            <WorkflowAccessStateRow>
              {t('agentDetail.access.workflow.empty')}
            </WorkflowAccessStateRow>
          )}
          {workflowReferencesQuery.isSuccess && workflowReferences.map(reference => (
            <WorkflowAccessRow
              key={`${reference.app_id}:${reference.workflow_id}`}
              reference={reference}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function WorkflowAccessRow({
  reference,
}: {
  reference: AgentReferencingWorkflowResponse
}) {
  const { t } = useTranslation('agentV2')
  const { formatTime } = useTimestamp()
  const imageUrl = (reference.app_icon_type === 'image' || reference.app_icon_type === 'link') ? reference.app_icon : undefined
  const iconType = (imageUrl ? 'image' : reference.app_icon_type) as AgentIconType | null | undefined
  const updatedAt = reference.app_updated_at != null
    ? formatTime(reference.app_updated_at, t('roster.dateTimeFormat'))
    : t('agentDetail.access.workflow.notAvailable')
  const nodeCount = reference.node_ids?.length ?? 0

  return (
    <tr className="h-10 border-b border-divider-subtle hover:bg-background-default-hover">
      <td className="px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className="shrink-0">
            <AppIcon
              size="small"
              rounded
              iconType={iconType}
              icon={reference.app_icon ?? undefined}
              background={reference.app_icon_background}
              imageUrl={imageUrl}
            />
          </span>
          <span className="truncate">
            {reference.app_name}
          </span>
        </div>
      </td>
      <td className="truncate px-3" translate="no">
        {reference.workflow_version}
      </td>
      <td className="px-3 tabular-nums">
        {t('agentDetail.access.workflow.nodeCount', { count: nodeCount })}
      </td>
      <td className="px-3 tabular-nums" translate="no">
        {updatedAt}
      </td>
      <td className="px-3">
        <Link
          href={getWorkflowReferenceHref(reference)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('agentDetail.access.workflow.openInStudioFor', { name: reference.app_name })}
          className="inline-flex items-center gap-0.5 rounded-sm text-text-secondary hover:text-text-accent hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          {t('agentDetail.access.workflow.openInStudio')}
          <span aria-hidden className="i-ri-external-link-line size-4" />
        </Link>
      </td>
    </tr>
  )
}

function WorkflowAccessStateRow({
  children,
}: {
  children: ReactNode
}) {
  return (
    <tr className="h-20 border-b border-divider-subtle">
      <td colSpan={workflowTableColSpan} aria-live="polite" className="px-3 text-center text-text-tertiary">
        {children}
      </td>
    </tr>
  )
}
