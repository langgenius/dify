import type { AgentLogConversationItemResponse } from '@dify/contracts/api/console/agent/types.gen'
import { useTranslation } from '#i18n'
import { LogSourceIcon } from './source-icon'

export function LogSourceCell({
  source,
}: {
  source?: AgentLogConversationItemResponse['source']
}) {
  const { t } = useTranslation('agentV2')

  if (!source) {
    return (
      <div className="truncate text-text-quaternary">
        {t('agentDetail.logs.notAvailable')}
      </div>
    )
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <LogSourceIcon source={source} />
      <div className="min-w-0 flex-1 truncate">
        {source.app_name}
      </div>
    </div>
  )
}
