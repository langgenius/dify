import type { NodeProps } from '../../types'
import type { AgentV2NodeType } from './types'
import { AvatarFallback, AvatarImage, AvatarRoot } from '@langgenius/dify-ui/avatar'
import { useTranslation } from 'react-i18next'
import { SettingItem } from '../_base/components/setting-item'
import { hasInlineAgentBinding, hasValidRosterAgentBinding } from './types'

function AgentNodeAvatar({
  data,
}: {
  data: AgentV2NodeType
}) {
  const agent = data.agent_roster
  const imageUrl = agent && (agent.icon_type === 'image' || agent.icon_type === 'link') ? agent.icon : undefined

  if (hasInlineAgentBinding(data)) {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background-default-burn text-text-tertiary">
        <span aria-hidden className="i-custom-vender-solid-mediaAndDevices-robot size-5" />
      </span>
    )
  }

  if (!agent)
    return null

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
}: {
  data: AgentV2NodeType
}) {
  const { t } = useTranslation()
  const isInlineAgent = hasInlineAgentBinding(data)

  return (
    <div className="mb-1 px-3 py-1">
      <div className="mb-0.5 px-0.5 system-2xs-medium-uppercase text-text-tertiary">
        {t('nodes.agent.roster.label', { ns: 'workflow' })}
      </div>
      <div className="flex min-w-0 items-center gap-1 rounded-lg bg-workflow-block-parma-bg p-1">
        <AgentNodeAvatar data={data} />
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <div className="truncate system-xs-regular text-text-secondary">
            {isInlineAgent
              ? t('nodes.agent.roster.inlineSetup.name', { ns: 'workflow' })
              : data.agent_roster?.name}
          </div>
          <div className="truncate system-2xs-regular text-text-tertiary">
            {isInlineAgent
              ? t('nodes.agent.roster.inlineSetup.type', { ns: 'workflow' })
              : data.agent_roster?.role}
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

  if (isInlineAgent || hasValidAgent)
    return <AgentNodeModel data={data} />

  return (
    <div className="mb-1 space-y-1 px-3">
      <SettingItem
        label={t('nodes.agent.roster.label', { ns: 'workflow' })}
        status={hasValidAgent ? undefined : 'error'}
        tooltip={hasValidAgent ? undefined : t('errorMsg.fieldRequired', { ns: 'workflow', field: t('nodes.agent.roster.label', { ns: 'workflow' }) })}
      >
        {data.agent_roster?.name}
      </SettingItem>
    </div>
  )
}
