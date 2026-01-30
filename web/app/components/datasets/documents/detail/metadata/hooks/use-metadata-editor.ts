import type { DocType, FullDocumentDetail } from '@/models/datasets'
import { useCallback, useEffect, useState } from 'react'

export type MetadataState = {
  documentType?: DocType | ''
  metadata: Record<string, string>
}

type UseMetadataEditorOptions = {
  docDetail?: FullDocumentDetail
}

export function useMetadataEditor({ docDetail }: UseMetadataEditorOptions) {
  const doc_metadata = docDetail?.doc_metadata ?? {}
  const rawDocType = docDetail?.doc_type ?? ''
  const doc_type = rawDocType === 'others' ? '' : rawDocType

  const [editStatus, setEditStatus] = useState(!doc_type)
  const [metadataParams, setMetadataParams] = useState<MetadataState>(
    doc_type
      ? {
          documentType: doc_type as DocType,
          metadata: (doc_metadata || {}) as Record<string, string>,
        }
      : { metadata: {} },
  )
  const [showDocTypes, setShowDocTypes] = useState(!doc_type)
  const [tempDocType, setTempDocType] = useState<DocType | ''>('')

  useEffect(() => {
    if (docDetail?.doc_type) {
      setEditStatus(false)
      setShowDocTypes(false)
      setTempDocType(doc_type as DocType | '')
      setMetadataParams({
        documentType: doc_type as DocType | '',
        metadata: (docDetail?.doc_metadata || {}) as Record<string, string>,
      })
    }
  }, [docDetail?.doc_type, docDetail?.doc_metadata, doc_type])

  const confirmDocType = useCallback(() => {
    if (!tempDocType)
      return
    setMetadataParams({
      documentType: tempDocType,
      metadata: tempDocType === metadataParams.documentType ? metadataParams.metadata : {},
    })
    setEditStatus(true)
    setShowDocTypes(false)
  }, [tempDocType, metadataParams.documentType, metadataParams.metadata])

  const cancelDocType = useCallback(() => {
    setTempDocType(metadataParams.documentType ?? '')
    setEditStatus(true)
    setShowDocTypes(false)
  }, [metadataParams.documentType])

  const enableEdit = useCallback(() => {
    setEditStatus(true)
  }, [])

  const resetToInitial = useCallback(() => {
    setMetadataParams({
      documentType: doc_type || '',
      metadata: { ...docDetail?.doc_metadata },
    })
    setEditStatus(!doc_type)
    if (!doc_type)
      setShowDocTypes(true)
  }, [doc_type, docDetail?.doc_metadata])

  const updateMetadataField = useCallback((field: string, value: string) => {
    setMetadataParams(prev => ({
      ...prev,
      metadata: { ...prev.metadata, [field]: value },
    }))
  }, [])

  const openDocTypeSelector = useCallback(() => {
    setShowDocTypes(true)
  }, [])

  return {
    doc_type,
    editStatus,
    setEditStatus,
    metadataParams,
    showDocTypes,
    tempDocType,
    setTempDocType,
    confirmDocType,
    cancelDocType,
    enableEdit,
    resetToInitial,
    updateMetadataField,
    openDocTypeSelector,
  }
}
