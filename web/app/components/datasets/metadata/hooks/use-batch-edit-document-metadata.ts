import { useBoolean } from 'ahooks'
import type { MetadataItemInBatchEdit, MetadataItemWithValue } from '../types'
import { DataType } from '../types'
import type { SimpleDocumentDetail } from '@/models/datasets'
import { useMemo } from 'react'

// compare
// original and edited list.
// Use the edited list, except the original and edited value is both multiple value.
const testMetadataList: MetadataItemWithValue[][] = [
  [
    { id: 'str-same-value', name: 'name', type: DataType.string, value: 'Joel' },
    { id: 'num', name: 'age', type: DataType.number, value: 10 },
    { id: 'str-with-different-value', name: 'hobby', type: DataType.string, value: 'bbb' },
  ],
  [
    { id: 'str-same-value', name: 'name', type: DataType.string, value: 'Joel' },
    { id: 'str-with-different-value', name: 'hobby', type: DataType.string, value: 'ccc' },
  ],
]

type Props = {
  list: SimpleDocumentDetail[]
}

const useBatchEditDocumentMetadata = ({
  list,
}: Props) => {
  const [isShowEditModal, {
    setTrue: showEditModal,
    setFalse: hideEditModal,
  }] = useBoolean(false)

  const originalList: MetadataItemInBatchEdit[] = useMemo(() => {
    const idNameValue: Record<string, { value: string | number | null, isMultipleValue: boolean }> = {}
    // TODO: mock backend data struct
    // const metaDataList: MetadataItemWithValue[][] = list.map((item, i) => {
    //   if (item.doc_metadata)
    //     return item.doc_metadata

    //   return testMetadataList[i] || []
    // })
    const metaDataList = testMetadataList
    const res: MetadataItemInBatchEdit[] = []
    metaDataList.forEach((metaData) => {
      metaData.forEach((item) => {
        // if (item.value === 'ccc') {
        //   debugger
        // }
        if (idNameValue[item.id]?.isMultipleValue)
          return
        const itemInRes = res.find(i => i.id === item.id)
        if (!idNameValue[item.id]) {
          idNameValue[item.id] = {
            value: item.value,
            isMultipleValue: false,
          }
        }

        if (itemInRes && itemInRes.value !== item.value) {
          idNameValue[item.id].isMultipleValue = true
          itemInRes.isMultipleValue = true
          itemInRes.value = null
          return
        }
        if (!itemInRes) {
          res.push({
            ...item,
            isMultipleValue: false,
          })
        }
      })
    })
    return res
  }, [])

  const formateToBackendList = (editedList: MetadataItemInBatchEdit[], isApplyToAllSelectDocument: boolean) => {
    const updatedList = editedList.filter((editedItem) => {
      const originalItem = originalList.find(i => i.id === editedItem.id)
      if (!originalItem) // added item
        return true
      if (editedItem.value !== originalItem.value)
        return true
      return false
    })
    const removedList = originalList.filter((originalItem) => {
      const editedItem = editedList.find(i => i.id === originalItem.id)
      if (!editedItem) // removed item
        return true
      return false
    })

    const res: { document_id: string, metadata_list: MetadataItemWithValue[] }[] = list.map((item, i) => {
      // the new metadata will override the old one
      const oldMetadataList = item.doc_metadata || testMetadataList[i] // TODO: used mock data
      const newMetadataList: MetadataItemWithValue[] = oldMetadataList
        .filter((item) => {
          return !removedList.find(removedItem => removedItem.id === item.id)
        })
        .map((item) => {
          const editedItem = updatedList.find(i => i.id === item.id)
          if (editedItem)
            return editedItem
          return item
        })
      if (isApplyToAllSelectDocument) {
        // add missing metadata item
        updatedList.forEach((editedItem) => {
          if (!newMetadataList.find(i => i.id === editedItem.id))
            newMetadataList.push(editedItem)
        })
      }
      return {
        document_id: item.id,
        metadata_list: newMetadataList,
      }
    }).filter(item => item.metadata_list.length > 0)
    return res
  }

  const handleSave = (editedList: MetadataItemInBatchEdit[], isApplyToAllSelectDocument: boolean) => {
    const backendList = formateToBackendList(editedList, isApplyToAllSelectDocument)
    console.log(backendList)
  }

  return {
    isShowEditModal,
    showEditModal,
    hideEditModal,
    originalList,
    handleSave,
  }
}

export default useBatchEditDocumentMetadata
