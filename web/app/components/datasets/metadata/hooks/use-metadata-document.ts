import { useBatchUpdateDocMetadata } from '@/service/knowledge/use-metadata'
import { DataType, type MetadataItemWithValue } from '../types'
import { useState } from 'react'
import Toast from '@/app/components/base/toast'
import { useTranslation } from 'react-i18next'

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
}

const useMetadataDocument = ({
  datasetId,
  documentId,
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
  }
}

export default useMetadataDocument
