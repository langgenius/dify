import type { NodeProps } from '../../types'
import type { AgentV2NodeType } from './types'
import { useTranslation } from 'react-i18next'
import { SettingItem } from '../_base/components/setting-item'
import { hasValidRosterAgentBinding } from './types'

export function AgentV2Node({ data }: NodeProps<AgentV2NodeType>) {
  const { t } = useTranslation()
  const hasValidAgent = hasValidRosterAgentBinding(data)

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
