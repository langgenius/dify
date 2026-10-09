import type { NodeProps } from '../../types'
import type { AgentV2NodeType } from './types'
import type { AppIconType } from '@/types/app'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useUpdateNodeInternals } from 'reactflow'
import AppIcon from '@/app/components/base/app-icon'
import { NodeBranches } from '../_base/components/branch-list/node-branches'
import { SettingItem } from '../_base/components/setting-item'
import { useAgentRosterDetail, useWorkflowInlineAgentDetail } from './hooks'
import { hasInlineAgentBinding, hasValidRosterAgentBinding } from './types'

const getAppIconType = (iconType?: string | null): AppIconType | null => {
  if (iconType === 'emoji' || iconType === 'image' || iconType === 'link') return iconType

  return null
}

function AgentNodeAvatar({
  agent,
  isInlineAgent,
}: {
  agent?: ReturnType<typeof useAgentRosterDetail>['data']
  isInlineAgent: boolean
}) {
  if (isInlineAgent) {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background-default-burn text-text-tertiary">
        <span aria-hidden className="i-custom-vender-agent-v2-configure h-3.5 w-3" />
      </span>
    )
  }

  if (!agent)
    return <span aria-hidden className="size-8 shrink-0 rounded-full bg-text-quaternary/20" />

  return (
    <AppIcon
      size="small"
      iconType={getAppIconType(agent.icon_type)}
      icon={agent.icon ?? undefined}
      background={agent.icon_background}
      imageUrl={agent.icon ?? undefined}
    />
  )
}

function AgentNodeAvatarPlaceholder() {
  return <span aria-hidden className="size-8 shrink-0 rounded-full bg-text-quaternary/20" />
}

function AgentNodeModel({
  data,
  agent,
  isLoading,
}: {
  data: AgentV2NodeType
  agent?: ReturnType<typeof useAgentRosterDetail>['data']
  isLoading: boolean
}) {
  const { t } = useTranslation(['workflow', 'workflowAgent'])
  const isInlineAgent = hasInlineAgentBinding(data)
  const name = isInlineAgent
    ? t(($) => $['nodes.agent.roster.inlineSetup.name'], { ns: 'workflowAgent' })
    : agent?.name
  const role = isInlineAgent
    ? t(($) => $['nodes.agent.roster.inlineSetup.type'], { ns: 'workflowAgent' })
    : ''
  const showPlaceholder = isLoading || (!isInlineAgent && !agent)

  return (
    <div className="flex flex-col gap-0.5 py-1">
      <div className="px-2.5 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
        {t(($) => $['nodes.agent.roster.label'], { ns: 'workflow' })}
      </div>
      <div className="px-2.5">
        <div className="flex min-w-0 items-center gap-1 rounded-lg bg-workflow-block-parma-bg p-1">
          {showPlaceholder ? (
            <AgentNodeAvatarPlaceholder />
          ) : (
            <AgentNodeAvatar agent={agent} isInlineAgent={isInlineAgent} />
          )}
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            {showPlaceholder ? (
              <div aria-hidden className="flex flex-col gap-1.5 py-0.5">
                <span className="h-2 w-20 rounded-xs bg-text-quaternary/20" />
                <span className="h-2 w-14 rounded-xs bg-text-quaternary/15" />
              </div>
            ) : (
              <>
                <div className="truncate system-xs-regular text-text-secondary">{name}</div>
                <div className="truncate system-2xs-regular text-text-tertiary">{role}</div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function AgentV2Node(props: NodeProps<AgentV2NodeType>) {
  const { id, data } = props
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, data.agent_output_routes, updateNodeInternals])
  const { t } = useTranslation(['workflow', 'workflowAgent'])
  const hasValidAgent = hasValidRosterAgentBinding(data)
  const isInlineAgent = hasInlineAgentBinding(data)
  const rosterAgentId =
    data.agent_binding?.binding_type === 'roster_agent' ? data.agent_binding.agent_id : undefined
  const inlineAgentId =
    data.agent_binding?.binding_type === 'inline_agent' ? data.agent_binding.agent_id : undefined
  const rosterAgentQuery = useAgentRosterDetail(rosterAgentId)
  const inlineAgentQuery = useWorkflowInlineAgentDetail(id, inlineAgentId)
  const isInlineAgentDetailLoading = isInlineAgent && !!inlineAgentId && inlineAgentQuery.isPending

  if (isInlineAgent || hasValidAgent)
    return (
      <>
        <AgentNodeModel
          data={data}
          agent={rosterAgentQuery.data}
          isLoading={isInlineAgentDetailLoading}
        />
        {data.agent_output_routes?.enabled && (
          <div className="px-3 pb-2">
            <NodeBranches
              node={props}
              branches={(data.agent_output_routes.routes ?? []).map((route) => ({
                ...route,
                name: route.name ?? '',
              }))}
              defaultLabel={(index) =>
                t(($) => $['nodes.agent.outputRoutes.route'], { ns: 'workflow', index })
              }
            />
          </div>
        )}
      </>
    )

  return (
    <div className="mb-1 space-y-1 px-3">
      <SettingItem
        label={t(($) => $['nodes.agent.roster.label'], { ns: 'workflow' })}
        status={hasValidAgent ? undefined : 'error'}
        tooltip={
          hasValidAgent
            ? undefined
            : t(($) => $['errorMsg.fieldRequired'], {
                ns: 'workflow',
                field: t(($) => $['nodes.agent.roster.label'], { ns: 'workflow' }),
              })
        }
      >
        {rosterAgentQuery.data?.name}
      </SettingItem>
    </div>
  )
}
