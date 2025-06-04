import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useTranslation } from 'react-i18next'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks'
import type {
  DataSourceNodeType,
  ToolVarInputs,
} from '../types'
import { useToastContext } from '@/app/components/base/toast'

export const useConfig = (id: string) => {
  const store = useStoreApi()
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const { notify } = useToastContext()
  const { t } = useTranslation()

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
