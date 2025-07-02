import {
  useCallback,
  useEffect,
} from 'react'
import { useStoreApi } from 'reactflow'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks'
import type {
  DataSourceNodeType,
  ToolVarInputs,
} from '../types'
import { DEFAULT_FILE_EXTENSIONS_IN_LOCAL_FILE_DATA_SOURCE } from '../constants'

export const useConfig = (id: string) => {
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
        fileExtensions: DEFAULT_FILE_EXTENSIONS_IN_LOCAL_FILE_DATA_SOURCE,
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

  return {
    handleFileExtensionsChange,
    handleParametersChange,
  }
}
