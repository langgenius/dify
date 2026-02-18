import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { useMemo } from 'react'
import { transformDataSourceToTool } from '@/app/components/workflow/block-selector/utils'
import { useDataSourceList } from '@/service/use-pipeline'
import { basePath } from '@/utils/var'

export const useDatasourceIcon = (data: DataSourceNodeType) => {
  const { data: dataSourceListData, isSuccess } = useDataSourceList(true)

  const datasourceIcon = useMemo(() => {
    if (!isSuccess)
      return
    const dataSourceList = [...(dataSourceListData || [])]
    dataSourceList.forEach((item) => {
      const icon = item.declaration.identity.icon
      if (typeof icon == 'string' && !icon.includes(basePath))
        item.declaration.identity.icon = `${basePath}${icon}`
    })
    const formattedDataSourceList = dataSourceList.map(item => transformDataSourceToTool(item))
    return formattedDataSourceList?.find(toolWithProvider => toolWithProvider.plugin_id === data.plugin_id)?.icon
  }, [data.plugin_id, dataSourceListData, isSuccess])

  return datasourceIcon
}
