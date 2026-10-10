import type { BuiltInMetadataItem, MetadataItemWithValueLength } from '../types'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useBoolean } from 'ahooks'
import { useCallback, useEffect, useState } from 'react'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { isShowManageMetadataLocalStorageKey } from '../types'
import useCheckMetadataName from './use-check-metadata-name'

const useEditDatasetMetadata = ({ datasetId }: { datasetId: string }) => {
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
  const { mutateAsync: doAddMetaData } = useMutation(
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
      await doAddMetaData({ params: { dataset_id: datasetId }, body: payload })
    },
    [checkName, doAddMetaData, datasetId],
  )
  const { mutateAsync: doRenameMetaData } = useMutation(
    consoleQuery.datasets.byDatasetId.metadata.byMetadataId.patch.mutationOptions(),
  )
  const handleRename = useCallback(
    async (payload: MetadataItemWithValueLength) => {
      const errorMsg = checkName(payload.name).errorMsg
      if (errorMsg) {
        toast.error(errorMsg)
        return Promise.reject(new Error(errorMsg))
      }
      await doRenameMetaData({
        params: { dataset_id: datasetId, metadata_id: payload.id },
        body: { name: payload.name },
      })
    },
    [checkName, doRenameMetaData, datasetId],
  )
  const { mutateAsync: doDeleteMetaData } = useMutation(
    consoleQuery.datasets.byDatasetId.metadata.byMetadataId.delete.mutationOptions(),
  )
  const handleDeleteMetaData = useCallback(
    async (metaDataId: string) => {
      await doDeleteMetaData({ params: { dataset_id: datasetId, metadata_id: metaDataId } })
    },
    [doDeleteMetaData, datasetId],
  )
  const [builtInEnabled, setBuiltInEnabled] = useState(datasetMetaData?.built_in_field_enabled)
  useEffect(() => {
    setBuiltInEnabled(datasetMetaData?.built_in_field_enabled)
  }, [datasetMetaData])
  const { mutateAsync: toggleBuiltInStatus } = useMutation(
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
      await toggleBuiltInStatus({
        params: { dataset_id: datasetId, action: enable ? 'enable' : 'disable' },
      })
      setBuiltInEnabled(enable)
    },
  }
}
export default useEditDatasetMetadata
