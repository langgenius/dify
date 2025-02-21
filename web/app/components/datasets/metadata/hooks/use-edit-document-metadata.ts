import { useBoolean } from 'ahooks'
import { useBuiltInMetaData, useDatasetMetaData, useDeleteMetaData, useUpdateBuiltInStatus } from '@/service/knowledge/use-metadata'
import type { DataSet } from '@/models/datasets'
import { useCallback, useState } from 'react'

const useEditDocumentMetadata = ({
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
    handleDeleteMetaData,
    builtInMetaData: builtInMetaData?.fields,
    builtInEnabled,
    setBuiltInEnabled: async (enable: boolean) => {
      await mutate(enable)
      setBuiltInEnabled(enable)
    },
  }
}

export default useEditDocumentMetadata
