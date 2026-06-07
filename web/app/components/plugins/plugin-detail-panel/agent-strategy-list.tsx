import type { PluginDetail } from '@/app/components/plugins/types'
import type { Locale } from '@/i18n-config'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import StrategyItem from '@/app/components/plugins/plugin-detail-panel/strategy-item'
import {
  useStrategyProviderDetail,
} from '@/service/use-strategy'

type Props = {
  detail: PluginDetail
}

const emptyI18nObject = {} as Record<Locale, string>

const AgentStrategyList = ({
  detail,
}: Props) => {
  const { t } = useTranslation()
  const providerBriefInfo = detail.declaration.agent_strategy?.identity
  const providerName = providerBriefInfo?.name ?? ''
  const providerKey = `${detail.plugin_id}/${providerName}`
  const { data: strategyProviderDetail } = useStrategyProviderDetail(providerKey)

  const providerDetail = useMemo(() => {
    const identity = strategyProviderDetail?.declaration.identity
    return {
      author: identity?.author ?? '',
      name: identity?.name ?? '',
      description: identity?.description ?? emptyI18nObject,
      icon: identity?.icon ?? '',
      label: identity?.label ?? emptyI18nObject,
      tags: identity?.tags ?? [],
      tenant_id: detail.tenant_id,
    }
  }, [detail.tenant_id, strategyProviderDetail?.declaration.identity])

  const strategyList = useMemo(() => {
    if (!strategyProviderDetail)
      return []

    return strategyProviderDetail.declaration.strategies
  }, [strategyProviderDetail])

  if (!providerName || !strategyProviderDetail)
    return null

  return (
    <div className="px-4 pt-2 pb-4">
      <div className="mb-1 py-1">
        <div className="mb-1 flex h-6 items-center justify-between system-sm-semibold-uppercase text-text-secondary">
          {t('detailPanel.strategyNum', { ns: 'plugin', num: strategyList.length, strategy: strategyList.length > 1 ? 'strategies' : 'strategy' })}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {strategyList.map(strategyDetail => (
          <StrategyItem
            key={`${strategyDetail.identity.provider}${strategyDetail.identity.name}`}
            provider={providerDetail}
            detail={strategyDetail}
          />
        ))}
      </div>
    </div>
  )
}

export default AgentStrategyList
