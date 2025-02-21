import { useBoolean } from 'ahooks'
import { useBuiltInMetaData, useCreateMetaData, useDatasetMetaData, useDeleteMetaData, useRenameMeta, useUpdateBuiltInStatus } from '@/service/knowledge/use-metadata'
import type { DataSet } from '@/models/datasets'
import { useCallback, useState } from 'react'
import type { BuiltInMetadataItem, MetadataItemWithValueLength } from '../types'

const useEditDatasetMetadata = ({
  datasetId,
  dataset,
}: {
  datasetId: string,
  dataset?: DataSet
}) => {
  const [isShowEditModal, {
    setTrue: showEditModal,
    setFalse: hideEditModal,
  }] = useBoolean(false)

  const { data: datasetMetaData } = useDatasetMetaData(datasetId)

  const { mutate: doAddMetaData } = useCreateMetaData(datasetId)
  const handleAddMetaData = useCallback((payload: BuiltInMetadataItem) => {
    doAddMetaData(payload)
  }, [doAddMetaData])

  const { mutate: doRenameMetaData } = useRenameMeta(datasetId)
  const handleRename = useCallback((payload: MetadataItemWithValueLength) => {
    doRenameMetaData(payload)
  }, [doRenameMetaData])

  const { mutate: doDeleteMetaData } = useDeleteMetaData(datasetId)
  const handleDeleteMetaData = useCallback((metaDataId: string) => {
    doDeleteMetaData(metaDataId)
  }, [doDeleteMetaData])

  const [builtInEnabled, setBuiltInEnabled] = useState(dataset?.built_in_field_enabled)
  const { mutate } = useUpdateBuiltInStatus(datasetId)
  const { data: builtInMetaData } = useBuiltInMetaData()
  return {
    isShowEditModal,
    showEditModal,
    hideEditModal,
    datasetMetaData: datasetMetaData?.data,
    handleAddMetaData,
    handleRename,
    handleDeleteMetaData,
    builtInMetaData: builtInMetaData?.fields,
    builtInEnabled,
    setBuiltInEnabled: async (enable: boolean) => {
      await mutate(enable)
      setBuiltInEnabled(enable)
    },
  }
}

export default useEditDatasetMetadata
