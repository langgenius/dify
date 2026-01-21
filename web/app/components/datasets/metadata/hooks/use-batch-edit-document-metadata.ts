import type { MetadataBatchEditToServer, MetadataItemInBatchEdit, MetadataItemWithEdit, MetadataItemWithValue } from '../types'
import type { SimpleDocumentDetail } from '@/models/datasets'
import { useBoolean } from 'ahooks'
import { t } from 'i18next'
import { useMemo } from 'react'
import Toast from '@/app/components/base/toast'
import { useBatchUpdateDocMetadata } from '@/service/knowledge/use-metadata'
import { UpdateType } from '../types'

type Props = {
  datasetId: string
  docList: SimpleDocumentDetail[]
  selectedDocumentIds?: string[]
  onUpdate: () => void
}

const useBatchEditDocumentMetadata = ({
  datasetId,
  docList,
  selectedDocumentIds,
  onUpdate,
}: Props) => {
  const [isShowEditModal, {
    setTrue: showEditModal,
    setFalse: hideEditModal,
  }] = useBoolean(false)

  const metaDataList: MetadataItemWithValue[][] = (() => {
    const res: MetadataItemWithValue[][] = []
    docList.forEach((item) => {
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

  const formateToBackendList = (editedList: MetadataItemWithEdit[], addedList: MetadataItemInBatchEdit[], isApplyToAllSelectDocument: boolean) => {
    const updatedList = editedList.filter((editedItem) => {
      return editedItem.updateType === UpdateType.changeValue
    })
    const removedList = originalList.filter((originalItem) => {
      const editedItem = editedList.find(i => i.id === originalItem.id)
      if (!editedItem) // removed item
        return true
      return false
    })

    // Use selectedDocumentIds if available, otherwise fall back to docList
    const documentIds = selectedDocumentIds || docList.map(doc => doc.id)
    const res: MetadataBatchEditToServer = documentIds.map((documentId) => {
      // Find the document in docList to get its metadata
      const docIndex = docList.findIndex(doc => doc.id === documentId)
      const oldMetadataList = docIndex >= 0 ? metaDataList[docIndex] : []
      let newMetadataList: MetadataItemWithValue[] = [...oldMetadataList, ...addedList]
        .filter((item) => {
          return !removedList.find(removedItem => removedItem.id === item.id)
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
          if (!newMetadataList.find(i => i.id === editedItem.id) && !editedItem.isMultipleValue)
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
        document_id: documentId,
        metadata_list: newMetadataList,
        partial_update: docIndex < 0,
      }
    })
    return res
  }

  const { mutateAsync } = useBatchUpdateDocMetadata()

  const handleSave = async (editedList: MetadataItemInBatchEdit[], addedList: MetadataItemInBatchEdit[], isApplyToAllSelectDocument: boolean) => {
    const backendList = formateToBackendList(editedList, addedList, isApplyToAllSelectDocument)
    await mutateAsync({
      dataset_id: datasetId,
      metadata_list: backendList,
    })
    onUpdate()
    hideEditModal()
    Toast.notify({
      type: 'success',
      message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }),
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
