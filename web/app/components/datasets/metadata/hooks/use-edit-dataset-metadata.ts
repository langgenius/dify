import type { BuiltInMetadataItem, MetadataItemWithValueLength } from '../types'
import type { DataSet } from '@/models/datasets'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useBoolean } from 'ahooks'
import { useCallback, useEffect, useState } from 'react'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { isShowManageMetadataLocalStorageKey } from '../types'
import useCheckMetadataName from './use-check-metadata-name'

const useEditDatasetMetadata = ({
  datasetId,
  // dataset,
  onUpdateDocList,
}: {
  datasetId: string
  dataset?: DataSet
  onUpdateDocList: () => void
}) => {
  const [isShowEditModal, { setTrue: showEditModal, setFalse: hideEditModal }] = useBoolean(false)
  useEffect(() => {
    const isShowManageMetadata = localStorage.getItem(isShowManageMetadataLocalStorageKey)
    if (isShowManageMetadata) {
      showEditModal()
      localStorage.removeItem(isShowManageMetadataLocalStorageKey)
    }
  }, [])
  const { data: datasetMetaData } = useQuery(
    consoleQuery.datasets.byDatasetId.metadata.get.queryOptions({
      input: { params: { dataset_id: datasetId } },
    }),
  )
  const { mutateAsync: createMetaData } = useMutation(
    consoleQuery.datasets.byDatasetId.metadata.post.mutationOptions(),
  )
  const { checkName } = useCheckMetadataName()
  const handleAddMetaData = useCallback(
    async (payload: BuiltInMetadataItem) => {
      const errorMsg = checkName(payload.name).errorMsg
      if (errorMsg) {
        toast.error(errorMsg)
        return Promise.reject(new Error(errorMsg))
      }
      await createMetaData({ params: { dataset_id: datasetId }, body: payload })
    },
    [checkName, createMetaData, datasetId],
  )
  const { mutateAsync: renameMetaData } = useMutation(
    consoleQuery.datasets.byDatasetId.metadata.byMetadataId.patch.mutationOptions(),
  )
  const handleRename = useCallback(
    async (payload: MetadataItemWithValueLength) => {
      const errorMsg = checkName(payload.name).errorMsg
      if (errorMsg) {
        toast.error(errorMsg)
        return Promise.reject(new Error(errorMsg))
      }
      await renameMetaData({
        params: { dataset_id: datasetId, metadata_id: payload.id },
        body: { name: payload.name },
      })
      onUpdateDocList()
    },
    [checkName, renameMetaData, datasetId, onUpdateDocList],
  )
  const { mutateAsync: deleteMetaData } = useMutation(
    consoleQuery.datasets.byDatasetId.metadata.byMetadataId.delete.mutationOptions(),
  )
  const handleDeleteMetaData = useCallback(
    async (metaDataId: string) => {
      await deleteMetaData({ params: { dataset_id: datasetId, metadata_id: metaDataId } })
      onUpdateDocList()
    },
    [deleteMetaData, datasetId, onUpdateDocList],
  )
  const [builtInEnabled, setBuiltInEnabled] = useState(datasetMetaData?.built_in_field_enabled)
  useEffect(() => {
    setBuiltInEnabled(datasetMetaData?.built_in_field_enabled)
  }, [datasetMetaData])
  const { mutateAsync: updateBuiltInStatus } = useMutation(
    consoleQuery.datasets.byDatasetId.metadata.builtIn.byAction.post.mutationOptions(),
  )
  const { data: builtInMetaData } = useQuery(
    consoleQuery.datasets.metadata.builtIn.get.queryOptions(),
  )
  return {
    isShowEditModal,
    showEditModal,
    hideEditModal,
    datasetMetaData: datasetMetaData?.doc_metadata,
    handleAddMetaData,
    handleRename,
    handleDeleteMetaData,
    builtInMetaData: builtInMetaData?.fields,
    builtInEnabled,
    setBuiltInEnabled: async (enable: boolean) => {
      await updateBuiltInStatus({
        params: { dataset_id: datasetId, action: enable ? 'enable' : 'disable' },
      })
      setBuiltInEnabled(enable)
    },
  }
}
export default useEditDatasetMetadata
