import { useBatchUpdateDocMetadata } from '@/service/knowledge/use-metadata'
import type { BuiltInMetadataItem } from '../types'
import { DataType, type MetadataItemWithValue } from '../types'
import { useCallback, useState } from 'react'
import Toast from '@/app/components/base/toast'
import type { FullDocumentDetail } from '@/models/datasets'
import { useTranslation } from 'react-i18next'
import { useLanguages, useMetadataMap } from '@/hooks/use-metadata'
import { get } from 'lodash-es'
import { useCreateMetaData } from '@/service/knowledge/use-metadata'
import useCheckMetadataName from './use-check-metadata-name'

const testList = [
  {
    id: '1',
    name: 'Doc type',
    value: 'PDF',
    type: DataType.string,
  },
  {
    id: '2',
    name: 'Title',
    value: 'PDF',
    type: DataType.string,
  },
  {
    id: '3',
    name: 'Date',
    value: null,
    type: DataType.time,
  },
]

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

  const { mutate } = useBatchUpdateDocMetadata()
  const { checkName } = useCheckMetadataName()

  const [isEdit, setIsEdit] = useState(false)

  const [list, setList] = useState<MetadataItemWithValue[]>(testList)
  const [tempList, setTempList] = useState<MetadataItemWithValue[]>(list)
  const { mutate: doAddMetaData } = useCreateMetaData(datasetId)
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
      message: t('common.api.actionSuccess'),
    })
  }, [checkName, doAddMetaData, t])

  const hasData = list.length > 0
  const handleSave = async () => {
    await mutate({
      dataset_id: datasetId,
      metadata_list: [{
        document_id: documentId,
        metadata_list: tempList,
      }],
    })
    setList(tempList)
    setIsEdit(false)
    Toast.notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
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

  const builtInEnabled = true

  const builtList = [
    {
      id: '1',
      name: 'OriginalfileNmae',
      value: 'Steve Jobs The Man Who Thought Different.pdf',
      type: DataType.string,
    },
    {
      id: '2',
      name: 'Title',
      value: 'PDF',
      type: DataType.string,
    },
  ]

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
    isEdit,
    setIsEdit,
    list,
    setList,
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
