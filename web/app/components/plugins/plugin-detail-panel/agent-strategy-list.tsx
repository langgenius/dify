import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import StrategyItem from '@/app/components/plugins/plugin-detail-panel/strategy-item'
import {
  useStrategyProviderDetail,
} from '@/service/use-strategy'
import type { PluginDetail } from '@/app/components/plugins/types'

type Props = {
  detail: PluginDetail
}

const AgentStrategyList = ({
  detail,
}: Props) => {
  const { t } = useTranslation()
  const providerBriefInfo = detail.declaration.agent_strategy.identity
  const providerKey = `${detail.plugin_id}/${providerBriefInfo.name}`
  const { data: strategyProviderDetail } = useStrategyProviderDetail(providerKey)

  const providerDetail = useMemo(() => {
    return {
      ...strategyProviderDetail?.declaration.identity,
      tenant_id: detail.tenant_id,
    }
  }, [detail.tenant_id, strategyProviderDetail?.declaration.identity])

  const strategyList = useMemo(() => {
    if (!strategyProviderDetail)
      return []

    return strategyProviderDetail.declaration.strategies
  }, [strategyProviderDetail])

  if (!strategyProviderDetail)
    return null

  return (
    <div className='px-4 pt-2 pb-4'>
      <div className='mb-1 py-1'>
        <div className='mb-1 h-6 flex items-center justify-between text-text-secondary system-sm-semibold-uppercase'>
          {t('plugin.detailPanel.strategyNum', { num: strategyList.length, strategy: strategyList.length > 1 ? 'strategies' : 'strategy' })}
        </div>
      </div>
      <div className='flex flex-col gap-2'>
        {strategyList.map(strategyDetail => (
          <StrategyItem
            key={`${strategyDetail.identity.provider}${strategyDetail.identity.name}`}
            provider={providerDetail as any}
            detail={strategyDetail}
          />
        ))}
      </div>
    </div>
  )
}

export default AgentStrategyList
