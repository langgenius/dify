import type {
  MetadataBatchEditToServer,
  MetadataItemInBatchEdit,
  MetadataItemWithEdit,
  MetadataItemWithValue,
} from '../types'
import type { SimpleDocumentDetail } from '@/models/datasets'
import { useQueryClient } from '@tanstack/react-query'
import { mapAsync } from 'es-toolkit'
import { t } from 'i18next'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { useBatchUpdateDocMetadata } from '@/service/knowledge/use-metadata'
import { DataType, UpdateType } from '../types'

type Props = Readonly<{
  datasetId: string
  docList: Pick<SimpleDocumentDetail, 'id' | 'doc_metadata'>[]
  selectedDocumentIds?: string[]
  onUpdate: () => void
}>
const useBatchEditDocumentMetadata = ({
  datasetId,
  docList,
  selectedDocumentIds,
  onUpdate,
}: Props) => {
  const queryClient = useQueryClient()
  const requestIdRef = useRef(0)
  const isOpeningRef = useRef(false)
  const [session, setSession] = useState<{
    requestId: number
    datasetId: string
    documents: Props['docList']
  } | null>(null)
  const [loadingDatasetId, setLoadingDatasetId] = useState<string | null>(null)
  const activeSession = session?.datasetId === datasetId ? session : null
  const isShowEditModal = activeSession !== null
  const isLoadingMetadata = loadingDatasetId === datasetId
  const documents = activeSession?.documents ?? docList

  useEffect(() => {
    return () => {
      requestIdRef.current += 1
      isOpeningRef.current = false
      setSession(null)
      setLoadingDatasetId(null)
    }
  }, [datasetId])

  const hideEditModal = () => {
    requestIdRef.current += 1
    isOpeningRef.current = false
    setSession(null)
    setLoadingDatasetId(null)
  }
  const showEditModal = async () => {
    if (isOpeningRef.current) return
    isOpeningRef.current = true
    const requestId = ++requestIdRef.current
    const documentIds = [...new Set(selectedDocumentIds ?? docList.map((document) => document.id))]
    const currentDocuments = new Map(
      docList.map((document) => [
        document.id,
        {
          id: document.id,
          doc_metadata: document.doc_metadata?.map((item) => ({ ...item })),
        },
      ]),
    )
    setSession(null)
    setLoadingDatasetId(datasetId)
    try {
      const selectedDocuments = await mapAsync(
        documentIds,
        async (documentId) => {
          if (requestId !== requestIdRef.current) throw new Error('Metadata loading cancelled')
          const currentDocument = currentDocuments.get(documentId)
          if (currentDocument) return currentDocument

          const document = await queryClient.query(
            consoleQuery.datasets.byDatasetId.documents.byDocumentId.get.queryOptions({
              input: {
                params: { dataset_id: datasetId, document_id: documentId },
                query: { metadata: 'only' },
              },
              staleTime: 0,
              retry: false,
              context: { silent: true },
            }),
          )
          // Adapt the generated response to the metadata editor's supported field types.
          const metadata = (document.doc_metadata ?? [])
            .filter((item) => item.id !== 'built-in')
            .map((item): MetadataItemWithValue => {
              if (
                (item.type !== DataType.string &&
                  item.type !== DataType.number &&
                  item.type !== DataType.time) ||
                typeof item.value === 'boolean'
              )
                throw new Error('Unsupported document metadata')
              return { ...item, type: item.type, value: item.value ?? null }
            })
          return { id: documentId, doc_metadata: metadata }
        },
        { concurrency: 4 },
      )
      if (requestId !== requestIdRef.current) return
      setSession({ requestId, datasetId, documents: selectedDocuments })
    } catch {
      if (requestId === requestIdRef.current)
        toast.error(t(($) => $['api.actionFailed'], { ns: 'common' }))
    } finally {
      if (requestId === requestIdRef.current) {
        isOpeningRef.current = false
        setLoadingDatasetId(null)
      }
    }
  }
  const metaDataList: MetadataItemWithValue[][] = (() => {
    const res: MetadataItemWithValue[][] = []
    documents.forEach((item) => {
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
        value: string | number | null
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
    const res: MetadataBatchEditToServer = documents.map((document, docIndex) => {
      const oldMetadataList = metaDataList[docIndex]
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
        document_id: document.id,
        metadata_list: newMetadataList,
        partial_update: false,
      }
    })
    return res
  }
  const { mutateAsync } = useBatchUpdateDocMetadata()
  const handleSave = async (
    editedList: MetadataItemInBatchEdit[],
    addedList: MetadataItemInBatchEdit[],
    isApplyToAllSelectDocument: boolean,
  ) => {
    if (!activeSession) return
    const { requestId } = activeSession
    const backendList = formateToBackendList(editedList, addedList, isApplyToAllSelectDocument)
    try {
      await mutateAsync({
        dataset_id: activeSession.datasetId,
        metadata_list: backendList,
      })
      if (requestId !== requestIdRef.current) return
      onUpdate()
      hideEditModal()
      toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
    } catch {
      if (requestId === requestIdRef.current)
        toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
    }
  }
  return {
    isShowEditModal,
    isLoadingMetadata,
    documentCount: documents.length,
    showEditModal,
    hideEditModal,
    originalList,
    handleSave,
  }
}
export default useBatchEditDocumentMetadata
