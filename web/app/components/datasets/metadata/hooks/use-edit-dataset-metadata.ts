import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { MetadataLoadError } from '../metadata-dataset/dataset-metadata-drawer'
import type { BuiltInMetadataItem, MetadataItemWithValueLength } from '../types'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useBoolean } from 'ahooks'
import { useCallback, useEffect } from 'react'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryErrors } from '@/service/use-owned-query-error'
import { isShowManageMetadataLocalStorageKey } from '../types'
import useCheckMetadataName from './use-check-metadata-name'

const useEditDatasetMetadata = ({
  datasetId,
  // dataset,
  onUpdateDocList,
}: {
  datasetId: string
  dataset?: DatasetDetailWithPartialMembersResponse
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
  const datasetMetaDataQueryOptions = consoleQuery.datasets.byDatasetId.metadata.get.queryOptions({
    input: { params: { dataset_id: datasetId } },
  })
  const datasetMetaDataQuery = useQuery(datasetMetaDataQueryOptions)
  const datasetMetaData = datasetMetaDataQuery.data
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
  const { mutateAsync: updateBuiltInStatus } = useMutation(
    consoleQuery.datasets.byDatasetId.metadata.builtIn.byAction.post.mutationOptions(),
  )
  const builtInMetaDataQuery = useQuery(consoleQuery.datasets.metadata.builtIn.get.queryOptions())
  const builtInMetaData = builtInMetaDataQuery.data
  // The drawer cannot list or manage metadata it never loaded; a failed refetch keeps the cached
  // lists and is reported by the query cache.
  // The only caller renders it in the drawer, so it is claimed only while the drawer is open.
  const metadataLoad = useOwnedQueryErrors(
    isShowEditModal ? [datasetMetaDataQuery, builtInMetaDataQuery] : [],
  )
  const metadataLoadError: MetadataLoadError | undefined = metadataLoad && {
    error: metadataLoad.error,
    retrying: metadataLoad.retrying,
    onRetry: metadataLoad.retry,
  }
  return {
    isShowEditModal,
    showEditModal,
    hideEditModal,
    datasetMetaData: datasetMetaData?.doc_metadata,
    handleAddMetaData,
    handleRename,
    handleDeleteMetaData,
    builtInMetaData: builtInMetaData?.fields,
    metadataLoadError,
    builtInEnabled: datasetMetaData?.built_in_field_enabled,
    setBuiltInEnabled: async (enable: boolean) => {
      // The policy shows the new state at once, then reloads the metadata.
      await updateBuiltInStatus({
        params: { dataset_id: datasetId, action: enable ? 'enable' : 'disable' },
      })
    },
  }
}
export default useEditDatasetMetadata
