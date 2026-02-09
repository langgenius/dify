import type { MetadataBatchEditToServer, MetadataItemInBatchEdit, MetadataItemWithEdit, MetadataItemWithValue } from '../types'
import type { SimpleDocumentDetail } from '@/models/datasets'
import { useBoolean } from 'ahooks'
import { t } from 'i18next'
import { useCallback, useMemo } from 'react'
import Toast from '@/app/components/base/toast'
import { useBatchUpdateDocMetadata, useDatasetMetaData } from '@/service/knowledge/use-metadata'
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
  const { data: datasetMetaData } = useDatasetMetaData(datasetId)

  const metadataIdByName = useMemo(() => {
    const idByName: Record<string, string> = {}
    datasetMetaData?.doc_metadata?.forEach((metadata) => {
      if (metadata.id && metadata.id !== 'built-in')
        idByName[metadata.name] = metadata.id
    })
    return idByName
  }, [datasetMetaData?.doc_metadata])

  const resolveMetadataId = useCallback((item: { id?: string | null, name: string }) => {
    if (item.id && item.id !== 'built-in')
      return item.id
    return metadataIdByName[item.name] || ''
  }, [metadataIdByName])

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
        const metadataId = resolveMetadataId(item)
        if (!metadataId)
          return

        if (idNameValue[metadataId]?.isMultipleValue)
          return
        const itemInRes = res.find(i => i.id === metadataId)
        if (!idNameValue[metadataId]) {
          idNameValue[metadataId] = {
            value: item.value,
            isMultipleValue: false,
          }
        }

        if (itemInRes && itemInRes.value !== item.value) {
          idNameValue[metadataId].isMultipleValue = true
          itemInRes.isMultipleValue = true
          itemInRes.value = null
          return
        }
        if (!itemInRes) {
          res.push({
            ...item,
            id: metadataId,
            isMultipleValue: false,
          })
        }
      })
    })
    return res
  }, [metaDataList, resolveMetadataId])

  const toServerMetadataItem = (item: { id?: string | null, name: string, type: string, value: string | number | null | undefined }): MetadataItemWithValue | null => {
    const metadataId = resolveMetadataId(item)
    if (!metadataId)
      return null
    return {
      id: metadataId,
      name: item.name,
      type: item.type as MetadataItemWithValue['type'],
      value: item.value ?? null,
    }
  }

  const formateToBackendList = (editedList: MetadataItemWithEdit[], addedList: MetadataItemInBatchEdit[], isApplyToAllSelectDocument: boolean) => {
    const updatedList = editedList.filter((editedItem) => {
      return editedItem.updateType === UpdateType.changeValue
    })
    const updatedEntries = updatedList
      .map((editedItem) => {
        const serverItem = toServerMetadataItem(editedItem)
        if (!serverItem)
          return null
        return {
          serverItem,
          isMultipleValue: editedItem.isMultipleValue,
        }
      })
      .filter(item => !!item)
    const updatedMetadataMap = new Map(updatedEntries.map(item => [item.serverItem.id, item]))
    const editedMetadataIds = new Set(editedList
      .map(item => resolveMetadataId(item))
      .filter(Boolean))
    const removedList = originalList.filter(originalItem => !editedMetadataIds.has(originalItem.id))
    const removedMetadataIds = new Set(removedList
      .map(item => resolveMetadataId(item))
      .filter(Boolean))

    // Use selectedDocumentIds if available, otherwise fall back to docList
    const documentIds = selectedDocumentIds || docList.map(doc => doc.id)
    const res: MetadataBatchEditToServer = documentIds.map((documentId) => {
      // Find the document in docList to get its metadata
      const docIndex = docList.findIndex(doc => doc.id === documentId)
      const oldMetadataList = docIndex >= 0 ? metaDataList[docIndex] : []
      let newMetadataList: MetadataItemWithValue[] = [...oldMetadataList, ...addedList]
        .map(item => toServerMetadataItem(item))
        .filter(item => !!item)
        .filter(item => !removedMetadataIds.has(item.id))
      if (isApplyToAllSelectDocument) {
        // add missing metadata item
        updatedEntries.forEach((updatedItem) => {
          if (!newMetadataList.find(i => i.id === updatedItem.serverItem.id) && !updatedItem.isMultipleValue)
            newMetadataList.push(updatedItem.serverItem)
        })
      }

      newMetadataList = newMetadataList.map((item) => {
        const updatedItem = updatedMetadataMap.get(item.id)
        if (updatedItem)
          return updatedItem.serverItem
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
