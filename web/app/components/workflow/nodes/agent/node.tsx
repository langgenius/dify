import type { NodeProps } from '../../types'
import type { AgentNodeType } from './types'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { useHooksStore } from '../../hooks-store/store'
import { SettingItem } from '../_base/components/setting-item'
import { getRosterAgentFromComposer } from './helpers'

export function AgentNode({ id, data }: NodeProps<AgentNodeType>) {
  const { t } = useTranslation()
  const appId = useHooksStore(s => s.configsMap?.flowId)
  const composerQuery = useQuery({
    ...consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryOptions({
      input: appId
        ? {
            params: {
              app_id: appId,
              node_id: id,
            },
          }
        : skipToken,
    }),
  })
  const rosterAgent = getRosterAgentFromComposer(composerQuery.data, data.agent_roster)

  return (
    <div className="mb-1 space-y-1 px-3">
      <SettingItem
        label={t('nodes.agent.roster.label', { ns: 'workflow' })}
        status={rosterAgent ? undefined : 'error'}
        tooltip={rosterAgent ? undefined : t('errorMsg.fieldRequired', { ns: 'workflow', field: t('nodes.agent.roster.label', { ns: 'workflow' }) })}
      >
        {rosterAgent?.name}
      </SettingItem>
    </div>
  )
}
