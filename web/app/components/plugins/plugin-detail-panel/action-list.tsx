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

const ActionList = ({
  detail,
}: Props) => {
  const { t } = useTranslation()
  const providerBriefInfo = detail.declaration.tool.identity
  const providerKey = `${detail.plugin_id}/${providerBriefInfo.name}`
  const { data: collectionList = [] } = useAllToolProviders()
  const provider = useMemo(() => {
    return collectionList.find(collection => collection.name === providerKey)
  }, [collectionList, providerKey])
  const { data } = useBuiltinTools(providerKey)

  if (!data || !provider)
    return null

  return (
    <div className='px-4 pb-4 pt-2'>
      <div className='mb-1 py-1'>
        <div className='system-sm-semibold-uppercase mb-1 flex h-6 items-center justify-between text-text-secondary'>
          {t('plugin.detailPanel.actionNum', { num: data.length, action: data.length > 1 ? 'actions' : 'action' })}
        </div>
      </div>
      <div className='flex flex-col gap-2'>
        {data.map(tool => (
          <ToolItem
            key={`${detail.plugin_id}${tool.name}`}
            disabled={false}
            collection={provider}
            tool={tool}
            isBuiltIn={true}
            isModel={false}
          />
        ))}
      </div>
    </div>
  )
}

export default ActionList
