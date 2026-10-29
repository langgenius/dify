import type { PluginDetail } from '@/app/components/plugins/types'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ToolItem from '@/app/components/tools/provider/tool-item'
import {
  selectBuiltinProviderTools,
  selectToolCollections,
} from '@/app/components/tools/utils/query-select'
import { consoleQuery } from '@/service/console'

type Props = Readonly<{
  detail: PluginDetail
}>

const ActionList = ({ detail }: Props) => {
  const { t } = useTranslation(['plugin'])
  const providerBriefInfo = detail.declaration?.tool?.identity
  const providerKey = providerBriefInfo ? `${detail.plugin_id}/${providerBriefInfo.name}` : ''
  const { data: collectionList = [] } = useQuery(
    consoleQuery.workspaces.current.toolProviders.get.queryOptions({
      input: { query: {} },
      select: selectToolCollections,
    }),
  )
  const provider = useMemo(() => {
    return collectionList.find((collection) => collection.name === providerKey)
  }, [collectionList, providerKey])
  const { data } = useQuery(
    consoleQuery.workspaces.current.toolProvider.builtin.byProvider.tools.get.queryOptions({
      input: { params: { provider: providerKey } },
      enabled: !!providerKey,
      select: selectBuiltinProviderTools,
    }),
  )

  if (!providerKey || !data || !provider) return null

  return (
    <div className="px-4 pt-2 pb-4">
      <div className="mb-1 py-1">
        <div className="mb-1 flex h-6 items-center justify-between system-sm-semibold-uppercase text-text-secondary">
          {t(($) => $['detailPanel.actionNum'], {
            ns: 'plugin',
            num: data.length,
            action: data.length > 1 ? 'actions' : 'action',
          })}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {data.map((tool) => (
          <ToolItem
            key={`${detail.plugin_id}${tool.name}`}
            disabled={false}
            collection={provider}
            tool={tool}
            isBuiltIn={true}
          />
        ))}
      </div>
    </div>
  )
}

export default ActionList
