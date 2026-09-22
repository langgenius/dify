import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { useQuery } from '@tanstack/react-query'
import { resolveDatasourceIcon } from '@/app/components/rag-pipeline/utils/datasource-icon'
import { matchDataSource } from '@/app/components/workflow/utils/plugin-install-check'
import { consoleQuery } from '@/service/console'

export const useDatasourceIcon = (data: DataSourceNodeType) => {
  const { data: dataSourceList } = useQuery(
    consoleQuery.rag.pipelines.datasourcePlugins.get.queryOptions(),
  )
  const provider = dataSourceList && matchDataSource(dataSourceList, data)
  return provider && resolveDatasourceIcon(provider.declaration.identity.icon)
}
