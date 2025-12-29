import type { BuiltInMetadataItem, MetadataItemWithValueLength } from '../types'
import type { DataSet } from '@/models/datasets'
import { useBoolean } from 'ahooks'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { useBuiltInMetaDataFields, useCreateMetaData, useDatasetMetaData, useDeleteMetaData, useRenameMeta, useUpdateBuiltInStatus } from '@/service/knowledge/use-metadata'
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
  const { t } = useTranslation()
  const [isShowEditModal, {
    setTrue: showEditModal,
    setFalse: hideEditModal,
  }] = useBoolean(false)

  useEffect(() => {
    const isShowManageMetadata = localStorage.getItem(isShowManageMetadataLocalStorageKey)
    if (isShowManageMetadata) {
      showEditModal()
      localStorage.removeItem(isShowManageMetadataLocalStorageKey)
    }
  }, [])

  const { data: datasetMetaData } = useDatasetMetaData(datasetId)
  const { mutate: doAddMetaData } = useCreateMetaData(datasetId)
  const { checkName } = useCheckMetadataName()
  const handleAddMetaData = useCallback(async (payload: BuiltInMetadataItem) => {
    const errorMsg = checkName(payload.name).errorMsg
    if (errorMsg) {
      Toast.notify({
        message: errorMsg,
        type: 'error',
      })
      return Promise.reject(new Error(errorMsg))
    }
    await doAddMetaData(payload)
  }, [checkName, doAddMetaData])

  const { mutate: doRenameMetaData } = useRenameMeta(datasetId)
  const handleRename = useCallback(async (payload: MetadataItemWithValueLength) => {
    const errorMsg = checkName(payload.name).errorMsg
    if (errorMsg) {
      Toast.notify({
        message: errorMsg,
        type: 'error',
      })
      return Promise.reject(new Error(errorMsg))
    }
    await doRenameMetaData(payload)
    onUpdateDocList()
  }, [checkName, doRenameMetaData, onUpdateDocList])

  const { mutateAsync: doDeleteMetaData } = useDeleteMetaData(datasetId)
  const handleDeleteMetaData = useCallback(async (metaDataId: string) => {
    await doDeleteMetaData(metaDataId)
    onUpdateDocList()
  }, [doDeleteMetaData, onUpdateDocList])

  const [builtInEnabled, setBuiltInEnabled] = useState(datasetMetaData?.built_in_field_enabled)
  useEffect(() => { // wait for api response to set the right value
    setBuiltInEnabled(datasetMetaData?.built_in_field_enabled)
  }, [datasetMetaData])
  const { mutateAsync: toggleBuiltInStatus } = useUpdateBuiltInStatus(datasetId)
  const { data: builtInMetaData } = useBuiltInMetaDataFields()
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
      await toggleBuiltInStatus(enable)
      setBuiltInEnabled(enable)
      Toast.notify({
        message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }),
        type: 'success',
      })
    },
  }
}

export default useEditDatasetMetadata
