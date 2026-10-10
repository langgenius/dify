import type {
  MetadataBatchEditToServer,
  MetadataItemInBatchEdit,
  MetadataItemWithEdit,
  MetadataItemWithValue,
} from '../types'
import type { SimpleDocumentDetail } from '@/models/datasets'
import { useMutation } from '@tanstack/react-query'
import { useBoolean } from 'ahooks'
import { t } from 'i18next'
import { useMemo } from 'react'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { UpdateType } from '../types'
import { toMetadataDetail } from '../utils/to-metadata-detail'

type Props = Readonly<{
  datasetId: string
  docList: SimpleDocumentDetail[]
  selectedDocumentIds?: string[]
  onUpdate: () => void
}>
const useBatchEditDocumentMetadata = ({
  datasetId,
  docList,
  selectedDocumentIds,
  onUpdate,
}: Props) => {
  const [isShowEditModal, { setTrue: showEditModal, setFalse: hideEditModal }] = useBoolean(false)
  const metaDataList: MetadataItemWithValue[][] = (() => {
    const res: MetadataItemWithValue[][] = []
    docList.forEach((item) => {
      if (item.doc_metadata) {
        res.push(item.doc_metadata.filter((item) => item.id !== 'built-in'))
        return
      }
      res.push([])
    })
    return res
  })()
  // To check is key has multiple value
  const originalList: MetadataItemInBatchEdit[] = useMemo(() => {
    const idNameValue: Record<
      string,
      {
        value: MetadataItemWithValue['value']
        isMultipleValue: boolean
      }
    > = {}
    const res: MetadataItemInBatchEdit[] = []
    metaDataList.forEach((metaData) => {
      metaData.forEach((item) => {
        if (idNameValue[item.id]?.isMultipleValue) return
        const itemInRes = res.find((i) => i.id === item.id)
        if (!idNameValue[item.id]) {
          idNameValue[item.id] = {
            value: item.value,
            isMultipleValue: false,
          }
        }
        if (itemInRes && itemInRes.value !== item.value) {
          idNameValue[item.id]!.isMultipleValue = true
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
  const toCleanMetadataItem = (
    item: MetadataItemWithValue | MetadataItemWithEdit | MetadataItemInBatchEdit,
  ): MetadataItemWithValue => ({
    id: item.id,
    name: item.name,
    type: item.type,
    value: item.value ?? null,
  })
  const formateToBackendList = (
    editedList: MetadataItemWithEdit[],
    addedList: MetadataItemInBatchEdit[],
    isApplyToAllSelectDocument: boolean,
  ) => {
    const updatedList = editedList.filter((editedItem) => {
      return editedItem.updateType === UpdateType.changeValue
    })
    const removedList = originalList.filter((originalItem) => {
      const editedItem = editedList.find((i) => i.id === originalItem.id)
      if (!editedItem)
        // removed item
        return true
      return false
    })
    // Use selectedDocumentIds if available, otherwise fall back to docList
    const documentIds = selectedDocumentIds || docList.map((doc) => doc.id)
    const res: MetadataBatchEditToServer = documentIds.map((documentId) => {
      // Find the document in docList to get its metadata
      const docIndex = docList.findIndex((doc) => doc.id === documentId)
      const oldMetadataList = docIndex >= 0 ? metaDataList[docIndex] : []
      let newMetadataList: MetadataItemWithValue[] = [...(oldMetadataList ?? []), ...addedList]
        .filter((item) => {
          return !removedList.find((removedItem) => removedItem.id === item.id)
        })
        .map(toCleanMetadataItem)
      if (isApplyToAllSelectDocument) {
        // add missing metadata item
        updatedList.forEach((editedItem) => {
          if (!newMetadataList.find((i) => i.id === editedItem.id) && !editedItem.isMultipleValue)
            newMetadataList.push(toCleanMetadataItem(editedItem))
        })
      }
      newMetadataList = newMetadataList.map((item) => {
        const editedItem = updatedList.find((i) => i.id === item.id)
        if (editedItem) return toCleanMetadataItem(editedItem)
        return item
      })
      return {
        document_id: documentId,
        metadata_list: newMetadataList.map(toMetadataDetail),
        partial_update: docIndex < 0,
      }
    })
    return res
  }
  const { mutateAsync } = useMutation(
    consoleQuery.datasets.byDatasetId.documents.metadata.post.mutationOptions(),
  )
  const handleSave = async (
    editedList: MetadataItemInBatchEdit[],
    addedList: MetadataItemInBatchEdit[],
    isApplyToAllSelectDocument: boolean,
  ) => {
    const backendList = formateToBackendList(editedList, addedList, isApplyToAllSelectDocument)
    await mutateAsync({
      params: { dataset_id: datasetId },
      body: { operation_data: backendList },
    })
    onUpdate()
    hideEditModal()
    toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
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
