import type { NodeProps } from '../../types'
import type { AgentV2NodeType } from './types'
import { AvatarFallback, AvatarImage, AvatarRoot } from '@langgenius/dify-ui/avatar'
import { useTranslation } from 'react-i18next'
import { SettingItem } from '../_base/components/setting-item'
import { useAgentRosterDetail } from './hooks'
import { hasInlineAgentBinding, hasValidRosterAgentBinding } from './types'

function AgentNodeAvatar({
  agent,
  isInlineAgent,
}: {
  agent?: ReturnType<typeof useAgentRosterDetail>['data']
  isInlineAgent: boolean
}) {
  const imageUrl = agent && (agent.icon_type === 'image' || agent.icon_type === 'link') ? agent.icon : undefined

  if (isInlineAgent) {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background-default-burn text-text-tertiary">
        <span aria-hidden className="i-custom-vender-agent-v2-robot-3 size-5" />
      </span>
    )
  }

  if (!agent)
    return <span aria-hidden className="size-8 shrink-0 rounded-full bg-text-quaternary/20" />

  return (
    <AvatarRoot
      size="md"
      className="border-[0.5px] border-divider-regular"
      style={{ background: imageUrl ? undefined : (agent.icon_background || '#FFEAD5') }}
    >
      {imageUrl && (
        <AvatarImage
          src={imageUrl}
          alt={agent.name}
        />
      )}
      <AvatarFallback size="md" className="text-lg text-text-primary-on-surface">
        {agent.icon_type === 'emoji' && agent.icon ? agent.icon : agent.name[0]?.toLocaleUpperCase()}
      </AvatarFallback>
    </AvatarRoot>
  )
}

function AgentNodeModel({
  data,
  agent,
}: {
  data: AgentV2NodeType
  agent?: ReturnType<typeof useAgentRosterDetail>['data']
}) {
  const { t } = useTranslation()
  const isInlineAgent = hasInlineAgentBinding(data)
  const name = isInlineAgent ? t('nodes.agent.roster.inlineSetup.name', { ns: 'workflow' }) : agent?.name
  const role = isInlineAgent ? t('nodes.agent.roster.inlineSetup.type', { ns: 'workflow' }) : ''
  const showRosterPlaceholder = !isInlineAgent && !agent

  return (
    <div className="flex flex-col gap-0.5 py-1">
      <div className="px-2.5 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
        {t('nodes.agent.roster.label', { ns: 'workflow' })}
      </div>
      <div className="px-2.5">
        <div className="flex min-w-0 items-center gap-1 rounded-lg bg-workflow-block-parma-bg p-1">
          <AgentNodeAvatar agent={agent} isInlineAgent={isInlineAgent} />
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            {showRosterPlaceholder
              ? (
                  <div aria-hidden className="flex flex-col gap-1.5 py-0.5">
                    <span className="h-2 w-20 rounded-xs bg-text-quaternary/20" />
                    <span className="h-2 w-14 rounded-xs bg-text-quaternary/15" />
                  </div>
                )
              : (
                  <>
                    <div className="truncate system-xs-regular text-text-secondary">
                      {name}
                    </div>
                    <div className="truncate system-2xs-regular text-text-tertiary">
                      {role}
                    </div>
                  </>
                )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function AgentV2Node({ data }: NodeProps<AgentV2NodeType>) {
  const { t } = useTranslation()
  const hasValidAgent = hasValidRosterAgentBinding(data)
  const isInlineAgent = hasInlineAgentBinding(data)
  const rosterAgentId = data.agent_binding?.binding_type === 'roster_agent' ? data.agent_binding.agent_id : undefined
  const rosterAgentQuery = useAgentRosterDetail(rosterAgentId)

  if (isInlineAgent || hasValidAgent)
    return <AgentNodeModel data={data} agent={rosterAgentQuery.data} />

  return (
    <div className="mb-1 space-y-1 px-3">
      <SettingItem
        label={t('nodes.agent.roster.label', { ns: 'workflow' })}
        status={hasValidAgent ? undefined : 'error'}
        tooltip={hasValidAgent ? undefined : t('errorMsg.fieldRequired', { ns: 'workflow', field: t('nodes.agent.roster.label', { ns: 'workflow' }) })}
      >
        {rosterAgentQuery.data?.name}
      </SettingItem>
    </div>
  )
}
