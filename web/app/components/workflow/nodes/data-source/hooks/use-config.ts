import type { RagPipelineDatasourceProviderResponse } from '@dify/contracts/api/console/rag/types.gen'
import type { ResourceVarInputs } from '../../_base/types'
import type { DataSourceNodeType } from '../types'
import { useCallback, useEffect, useMemo } from 'react'
import { useReactFlow } from 'reactflow'
import { matchDataSource } from '@/app/components/workflow/utils/plugin-install-check'
import { useNodeDataUpdate } from '../../../hooks/use-node-data-update'

export const useConfig = (
  id: string,
  data: DataSourceNodeType,
  dataSourceList?: RagPipelineDatasourceProviderResponse[],
) => {
  const { getNodes } = useReactFlow<DataSourceNodeType>()
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()

  const getNodeData = useCallback(() => {
    const nodes = getNodes()

    return nodes.find((node) => node.id === id)
  }, [getNodes, id])

  const handleNodeDataUpdate = useCallback(
    (data: Partial<DataSourceNodeType>) => {
      handleNodeDataUpdateWithSyncDraft({
        id,
        data,
      })
    },
    [id, handleNodeDataUpdateWithSyncDraft],
  )

  const handleLocalFileDataSourceInit = useCallback(() => {
    const nodeData = getNodeData()

    if (nodeData?.data._dataSourceStartToAdd && nodeData?.data.provider_type === 'local_file') {
      handleNodeDataUpdate({
        ...nodeData.data,
        _dataSourceStartToAdd: false,
      })
    }
  }, [getNodeData, handleNodeDataUpdate])

  useEffect(() => {
    handleLocalFileDataSourceInit()
  }, [handleLocalFileDataSourceInit])

  const handleFileExtensionsChange = useCallback(
    (fileExtensions: string[]) => {
      const nodeData = getNodeData()
      handleNodeDataUpdate({
        ...nodeData?.data,
        fileExtensions,
      })
    },
    [handleNodeDataUpdate, getNodeData],
  )

  const handleParametersChange = useCallback(
    (datasource_parameters: ResourceVarInputs) => {
      const nodeData = getNodeData()
      handleNodeDataUpdate({
        ...nodeData?.data,
        datasource_parameters,
      })
    },
    [handleNodeDataUpdate, getNodeData],
  )

  const outputSchema = useMemo(() => {
    if (!dataSourceList) return []

    const provider = matchDataSource(dataSourceList, data)
    const datasource = provider?.declaration.datasources?.find(
      (item) => item.identity.name === data.datasource_name,
    )
    const properties = datasource?.output_schema?.properties
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return []

    return Object.entries(properties).map(([name, value]: [string, unknown]) => {
      const schema = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
      const type =
        'type' in schema && typeof schema.type === 'string' && schema.type ? schema.type : 'unknown'
      const items = 'items' in schema ? schema.items : undefined
      const itemType =
        items &&
        typeof items === 'object' &&
        'type' in items &&
        typeof items.type === 'string' &&
        items.type
          ? items.type
          : 'unknown'
      return {
        name,
        value,
        type: type === 'array' ? `array[${itemType}]` : type,
        description:
          'description' in schema && typeof schema.description === 'string'
            ? schema.description
            : '',
        isObject: type === 'object',
      }
    })
  }, [data, dataSourceList])

  const hasObjectOutput = outputSchema.some((output) => output.isObject)

  return {
    handleFileExtensionsChange,
    handleParametersChange,
    outputSchema,
    hasObjectOutput,
  }
}
