import type {
  DataSourceNodeType,
  ToolVarInputs,
} from '../types'
import {
  useCallback,
  useEffect,
  useMemo,
} from 'react'
import { useStoreApi } from 'reactflow'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks'

export const useConfig = (id: string, dataSourceList?: any[]) => {
  const store = useStoreApi()
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()

  const getNodeData = useCallback(() => {
    const { getNodes } = store.getState()
    const nodes = getNodes()

    return nodes.find(node => node.id === id)
  }, [store, id])

  const handleNodeDataUpdate = useCallback((data: Partial<DataSourceNodeType>) => {
    handleNodeDataUpdateWithSyncDraft({
      id,
      data,
    })
  }, [id, handleNodeDataUpdateWithSyncDraft])

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

  const handleFileExtensionsChange = useCallback((fileExtensions: string[]) => {
    const nodeData = getNodeData()
    handleNodeDataUpdate({
      ...nodeData?.data,
      fileExtensions,
    })
  }, [handleNodeDataUpdate, getNodeData])

  const handleParametersChange = useCallback((datasource_parameters: ToolVarInputs) => {
    const nodeData = getNodeData()
    handleNodeDataUpdate({
      ...nodeData?.data,
      datasource_parameters,
    })
  }, [handleNodeDataUpdate, getNodeData])

  const outputSchema = useMemo(() => {
    const nodeData = getNodeData()
    if (!nodeData?.data || !dataSourceList)
      return []

    const currentDataSource = dataSourceList.find((ds: any) => ds.plugin_id === nodeData.data.plugin_id)
    const currentDataSourceItem = currentDataSource?.tools?.find((tool: any) => tool.name === nodeData.data.datasource_name)
    const output_schema = currentDataSourceItem?.output_schema

    const res: any[] = []
    if (!output_schema || !output_schema.properties)
      return res

    Object.keys(output_schema.properties).forEach((outputKey) => {
      const output = output_schema.properties[outputKey]
      const type = output.type
      if (type === 'object') {
        res.push({
          name: outputKey,
          value: output,
        })
      }
      else {
        res.push({
          name: outputKey,
          type: output.type === 'array'
            ? `Array[${output.items?.type.slice(0, 1).toLocaleUpperCase()}${output.items?.type.slice(1)}]`
            : `${output.type.slice(0, 1).toLocaleUpperCase()}${output.type.slice(1)}`,
          description: output.description,
        })
      }
    })
    return res
  }, [getNodeData, dataSourceList])

  const hasObjectOutput = useMemo(() => {
    const nodeData = getNodeData()
    if (!nodeData?.data || !dataSourceList)
      return false

    const currentDataSource = dataSourceList.find((ds: any) => ds.plugin_id === nodeData.data.plugin_id)
    const currentDataSourceItem = currentDataSource?.tools?.find((tool: any) => tool.name === nodeData.data.datasource_name)
    const output_schema = currentDataSourceItem?.output_schema

    if (!output_schema || !output_schema.properties)
      return false

    const properties = output_schema.properties
    return Object.keys(properties).some(key => properties[key].type === 'object')
  }, [getNodeData, dataSourceList])

  return {
    handleFileExtensionsChange,
    handleParametersChange,
    outputSchema,
    hasObjectOutput,
  }
}
