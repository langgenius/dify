import { useCallback, useMemo, useState } from 'react'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { DataSourceItem } from '@/app/components/workflow/block-selector/types'
import { basePath } from '@/utils/var'
import { useDataSourceList } from '@/service/use-pipeline'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { transformDataSourceToTool } from '@/app/components/workflow/block-selector/utils'

export const useDatasourceIcon = (data: DataSourceNodeType) => {
  const pipelineId = useDatasetDetailContextWithSelector(s => s.dataset?.pipeline_id)
  const [dataSourceList, setDataSourceList] = useState<ToolWithProvider[]>([])

  const handleUpdateDataSourceList = useCallback((dataSourceList: DataSourceItem[]) => {
    dataSourceList.forEach((item) => {
      const icon = item.declaration.identity.icon
      if (typeof icon == 'string' && !icon.includes(basePath))
        item.declaration.identity.icon = `${basePath}${icon}`
    })
    const formattedDataSourceList = dataSourceList.map(item => transformDataSourceToTool(item))
    setDataSourceList!(formattedDataSourceList)
  }, [])

  useDataSourceList(!!pipelineId, handleUpdateDataSourceList)

  const datasourceIcon = useMemo(() => {
    return dataSourceList?.find(toolWithProvider => toolWithProvider.plugin_id === data.plugin_id)?.icon
  }, [data, dataSourceList])

  return datasourceIcon
}
