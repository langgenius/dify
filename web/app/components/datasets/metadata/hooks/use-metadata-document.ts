import type { BuiltInMetadataItem, MetadataItemWithValue } from '../types'
import type { FullDocumentDetail } from '@/models/datasets'
import { get } from 'es-toolkit/compat'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { useDatasetDetailContext } from '@/context/dataset-detail'
import { useLanguages, useMetadataMap } from '@/hooks/use-metadata'
import { useBatchUpdateDocMetadata, useCreateMetaData, useDatasetMetaData, useDocumentMetaData } from '@/service/knowledge/use-metadata'
import { DataType } from '../types'
import useCheckMetadataName from './use-check-metadata-name'

type Props = {
  datasetId: string
  documentId: string
  docDetail: FullDocumentDetail
}

const useMetadataDocument = ({
  datasetId,
  documentId,
  docDetail,
}: Props) => {
  const { t } = useTranslation()

  const { dataset } = useDatasetDetailContext()
  const embeddingAvailable = !!dataset?.embedding_available

  const { mutateAsync } = useBatchUpdateDocMetadata()
  const { checkName } = useCheckMetadataName()

  const [isEdit, setIsEdit] = useState(false)
  const { data: documentDetail } = useDocumentMetaData({
    datasetId,
    documentId,
  })

  const allList = documentDetail?.doc_metadata || []
  const list = allList.filter(item => item.id !== 'built-in')
  const builtList = allList.filter(item => item.id === 'built-in')
  const [tempList, setTempList] = useState<MetadataItemWithValue[]>(list)
  const { mutateAsync: doAddMetaData } = useCreateMetaData(datasetId)
  const handleSelectMetaData = useCallback((metaData: MetadataItemWithValue) => {
    setTempList((prev) => {
      const index = prev.findIndex(item => item.id === metaData.id)
      if (index === -1)
        return [...prev, metaData]

      return prev
    })
  }, [])
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
    Toast.notify({
      type: 'success',
      message: t('api.actionSuccess', { ns: 'common' }),
    })
  }, [checkName, doAddMetaData, t])

  const hasData = list.length > 0
  const handleSave = async () => {
    await mutateAsync({
      dataset_id: datasetId,
      metadata_list: [{
        document_id: documentId,
        metadata_list: tempList,
      }],
    })
    setIsEdit(false)
    Toast.notify({
      type: 'success',
      message: t('api.actionSuccess', { ns: 'common' }),
    })
  }

  const handleCancel = () => {
    setTempList(list)
    setIsEdit(false)
  }

  const startToEdit = () => {
    setTempList(list)
    setIsEdit(true)
  }

  // built in enabled is set in dataset
  const { data: datasetMetaData } = useDatasetMetaData(datasetId)
  const builtInEnabled = datasetMetaData?.built_in_field_enabled

  // old metadata and technical params
  const metadataMap = useMetadataMap()
  const languageMap = useLanguages()

  const getReadOnlyMetaData = (mainField: 'originInfo' | 'technicalParameters') => {
    const fieldMap = metadataMap[mainField]?.subFieldsMap
    const sourceData = docDetail
    const getTargetMap = (field: string) => {
      if (field === 'language')
        return languageMap

      return {} as any
    }

    const getTargetValue = (field: string) => {
      const val = get(sourceData, field, '')
      if (!val && val !== 0)
        return '-'
      if (fieldMap[field]?.inputType === 'select')
        return getTargetMap(field)[val]
      if (fieldMap[field]?.render)
        return fieldMap[field]?.render?.(val, field === 'hit_count' ? get(sourceData, 'segment_count', 0) as number : undefined)
      return val
    }
    const fieldList = Object.keys(fieldMap).map((key) => {
      const field = fieldMap[key]
      return {
        id: field?.label,
        type: DataType.string,
        name: field?.label,
        value: getTargetValue(key),
      }
    })

    return fieldList
  }

  const originInfo = getReadOnlyMetaData('originInfo')
  const technicalParameters = getReadOnlyMetaData('technicalParameters')

  return {
    embeddingAvailable,
    isEdit,
    setIsEdit,
    list,
    tempList,
    setTempList,
    handleSelectMetaData,
    handleAddMetaData,
    hasData,
    builtList,
    builtInEnabled,
    startToEdit,
    handleSave,
    handleCancel,
    originInfo,
    technicalParameters,
  }
}

export default useMetadataDocument
