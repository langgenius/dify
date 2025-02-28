import { useBatchUpdateDocMetadata } from '@/service/knowledge/use-metadata'
import { DataType, type MetadataItemWithValue } from '../types'
import { useState } from 'react'
import Toast from '@/app/components/base/toast'
import type { FullDocumentDetail } from '@/models/datasets'
import { useTranslation } from 'react-i18next'
import { useMetadataMap } from '@/hooks/use-metadata'

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
  const [isEdit, setIsEdit] = useState(false)

  const [list, setList] = useState<MetadataItemWithValue[]>(testList)
  const [tempList, setTempList] = useState<MetadataItemWithValue[]>(list)
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
  const getReadOnlyMetaData = (mainField: 'originInfo' | 'technicalParameters') => {
    const fieldMap = metadataMap[mainField]?.subFieldsMap
    const sourceData = docDetail
    const fieldList = Object.keys(fieldMap).map((key) => {
      const field = fieldMap[key]
      return {
        id: field?.label,
        type: DataType.string,
        name: field?.label,
        value: sourceData[key],
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
