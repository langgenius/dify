import type { PluginDetail } from '@/app/components/plugins/types'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'

type Props = Readonly<{
  detail: Pick<PluginDetail, 'plugin_id'>
}>

const ActionList = ({ detail }: Props) => {
  const { t } = useTranslation(['plugin'])
  const { data: hasProvider } = useQuery(
    consoleQuery.rag.pipelines.datasourcePlugins.get.queryOptions({
      select: (providers) => providers.some((provider) => provider.plugin_id === detail.plugin_id),
    }),
  )

  if (!hasProvider) return null

  return (
    <div className="px-4 pt-2 pb-4">
      <div className="mb-1 py-1">
        <div className="mb-1 flex h-6 items-center justify-between system-sm-semibold-uppercase text-text-secondary">
          {t(($) => $['detailPanel.actionNum'], {
            ns: 'plugin',
            num: 0,
            action: 'action',
          })}
        </div>
      </div>
    </div>
  )
}

export default ActionList
