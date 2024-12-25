import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ToolItem from '@/app/components/tools/provider/tool-item'
import {
  useAllToolProviders,
  useBuiltinTools,
} from '@/service/use-tools'
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
  const { data: collectionList = [] } = useAllToolProviders()

  const provider = useMemo(() => {
    return collectionList.find(collection => collection.name === providerKey)
  }, [collectionList, providerKey])
  const { data } = useBuiltinTools(providerKey)

  if (!data || !provider)
    return null

  return (
    <div className='px-4 pt-2 pb-4'>
      <div className='mb-1 py-1'>
        <div className='mb-1 h-6 flex items-center justify-between text-text-secondary system-sm-semibold-uppercase'>
          {t('plugin.detailPanel.strategyNum', { num: data.length, strategy: data.length > 1 ? 'strategies' : 'strategy' })}
        </div>
      </div>
      <div className='flex flex-col gap-2'>
        {data.map(tool => (
          <ToolItem
            key={`${detail.plugin_id}${tool.name}`}
            collection={provider}
            tool={tool}
            isBuiltIn
            isModel={false}
          />
        ))}
      </div>
    </div>
  )
}

export default AgentStrategyList
