import { useBoolean } from 'ahooks'
import { useBuiltInMetaData, useDatasetMetaData, useUpdateBuiltInStatus } from '@/service/knowledge/use-metadata'
import type { DataSet } from '@/models/datasets'
import { useState } from 'react'

const useEditDocumentMetadata = ({
  datasetId,
  dataset,
}: {
  datasetId: string,
  dataset: DataSet
}) => {
  const [isShowEditModal, {
    setTrue: showEditModal,
    setFalse: hideEditModal,
  }] = useBoolean(false)

  const { data: datasetMetaData } = useDatasetMetaData(datasetId)
  const [builtInEnabled, setBuiltInEnabled] = useState(dataset.built_in_field_enabled)
  const { mutate } = useUpdateBuiltInStatus(datasetId)
  const { data: builtInMetaData } = useBuiltInMetaData()
  return {
    isShowEditModal,
    showEditModal,
    hideEditModal,
    builtInEnabled,
    setBuiltInEnabled: async (enable: boolean) => {
      await mutate(enable)
      setBuiltInEnabled(enable)
    },
    datasetMetaData: datasetMetaData?.data,
    builtInMetaData: builtInMetaData?.fields,
  }
}

export default useEditDocumentMetadata
