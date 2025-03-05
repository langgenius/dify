import { useBoolean } from 'ahooks'
import type { MetadataBatchEditToServer, MetadataItemInBatchEdit, MetadataItemWithValue } from '../types'
import type { SimpleDocumentDetail } from '@/models/datasets'
import { useMemo } from 'react'
import { isEqual } from 'lodash-es'
import { useBatchUpdateDocMetadata } from '@/service/knowledge/use-metadata'

type Props = {
  datasetId: string
  list: SimpleDocumentDetail[]
}

const useBatchEditDocumentMetadata = ({
  datasetId,
  list,
}: Props) => {
  const [isShowEditModal, {
    setTrue: showEditModal,
    setFalse: hideEditModal,
  }] = useBoolean(false)

  const metaDataList: MetadataItemWithValue[][] = (() => {
    const res: MetadataItemWithValue[][] = []
    list.forEach((item) => {
      if (item.doc_metadata) {
        res.push(item.doc_metadata.filter(item => item.id !== 'built-in'))
        return
      }
      res.push([])
    })
    return res
  })()

  // To check is key has multiple value
  const originalList: MetadataItemInBatchEdit[] = useMemo(() => {
    const idNameValue: Record<string, { value: string | number | null, isMultipleValue: boolean }> = {}

    const res: MetadataItemInBatchEdit[] = []
    metaDataList.forEach((metaData) => {
      metaData.forEach((item) => {
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
  }, [metaDataList])

  const formateToBackendList = (editedList: MetadataItemInBatchEdit[], isApplyToAllSelectDocument: boolean) => {
    // TODO: add list should be not in updateList; and updated not refresh cash
    const updatedList = editedList.filter((editedItem) => {
      const originalItem = originalList.find(i => i.id === editedItem.id)
      if (!originalItem) // added item
        return true
      if (!isEqual(originalItem, editedItem)) // no change
        return true
      return false
    })
    const removedList = originalList.filter((originalItem) => {
      const editedItem = editedList.find(i => i.id === originalItem.id)
      if (!editedItem) // removed item
        return true
      return false
    })

    const res: MetadataBatchEditToServer = list.map((item, i) => {
      // the new metadata will override the old one
      const oldMetadataList = item.doc_metadata || metaDataList[i]
      let newMetadataList: MetadataItemWithValue[] = oldMetadataList
        .filter((item) => {
          return item.id !== 'built-in' && !removedList.find(removedItem => removedItem.id === item.id)
        })

        .map(item => ({
          id: item.id,
          name: item.name,
          type: item.type,
          value: item.value,
        }))
      if (isApplyToAllSelectDocument) {
        // add missing metadata item
        updatedList.forEach((editedItem) => {
          if (!newMetadataList.find(i => i.id === editedItem.id))
            newMetadataList.push(editedItem)
        })
      }

      newMetadataList = newMetadataList.map((item) => {
        const editedItem = updatedList.find(i => i.id === item.id)
        if (editedItem)
          return editedItem
        return item
      })

      return {
        document_id: item.id,
        metadata_list: newMetadataList,
      }
    }).filter(item => item.metadata_list.length > 0)
    return res
  }

  const { mutate } = useBatchUpdateDocMetadata()

  const handleSave = (editedList: MetadataItemInBatchEdit[], isApplyToAllSelectDocument: boolean) => {
    const backendList = formateToBackendList(editedList, isApplyToAllSelectDocument)
    mutate({
      dataset_id: datasetId,
      metadata_list: backendList,
    })
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
