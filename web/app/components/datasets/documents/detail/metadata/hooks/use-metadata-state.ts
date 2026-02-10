'use client'
import type { CommonResponse } from '@/models/common'
import type { DocType, FullDocumentDetail } from '@/models/datasets'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { ToastContext } from '@/app/components/base/toast'
import { modifyDocMetadata } from '@/service/datasets'
import { asyncRunSafe } from '@/utils'
import { useDocumentContext } from '../../context'

type MetadataState = {
  documentType?: DocType | ''
  metadata: Record<string, string>
}

/**
 * Normalize raw doc_type: treat 'others' as empty string.
 */
const normalizeDocType = (rawDocType: string): DocType | '' => {
  return rawDocType === 'others' ? '' : rawDocType as DocType | ''
}

type UseMetadataStateOptions = {
  docDetail?: FullDocumentDetail
  onUpdate?: () => void
}

export function useMetadataState({ docDetail, onUpdate }: UseMetadataStateOptions) {
  const { doc_metadata = {} } = docDetail || {}
  const rawDocType = docDetail?.doc_type ?? ''
  const docType = normalizeDocType(rawDocType)

  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const datasetId = useDocumentContext(s => s.datasetId)
  const documentId = useDocumentContext(s => s.documentId)

  // If no documentType yet, start in editing + showDocTypes mode
  const [editStatus, setEditStatus] = useState(!docType)
  const [metadataParams, setMetadataParams] = useState<MetadataState>(
    docType
      ? { documentType: docType, metadata: (doc_metadata || {}) as Record<string, string> }
      : { metadata: {} },
  )
  const [showDocTypes, setShowDocTypes] = useState(!docType)
  const [tempDocType, setTempDocType] = useState<DocType | ''>('')
  const [saveLoading, setSaveLoading] = useState(false)

  // Sync local state when the upstream docDetail changes (e.g. after save or navigation).
  // These setters are intentionally called together to batch-reset multiple pieces
  // of derived editing state that cannot be expressed as pure derived values.
  useEffect(() => {
    if (docDetail?.doc_type) {
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
      setEditStatus(false)
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
      setShowDocTypes(false)
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
      setTempDocType(docType)
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
      setMetadataParams({
        documentType: docType,
        metadata: (docDetail?.doc_metadata || {}) as Record<string, string>,
      })
    }
  }, [docDetail?.doc_type, docDetail?.doc_metadata, docType])

  const confirmDocType = () => {
    if (!tempDocType)
      return
    setMetadataParams({
      documentType: tempDocType,
      // Clear metadata when switching to a different doc type
      metadata: tempDocType === metadataParams.documentType ? metadataParams.metadata : {},
    })
    setEditStatus(true)
    setShowDocTypes(false)
  }

  const cancelDocType = () => {
    setTempDocType(metadataParams.documentType ?? '')
    setEditStatus(true)
    setShowDocTypes(false)
  }

  const enableEdit = () => {
    setEditStatus(true)
  }

  const cancelEdit = () => {
    setMetadataParams({ documentType: docType || '', metadata: { ...(docDetail?.doc_metadata || {}) } })
    setEditStatus(!docType)
    if (!docType)
      setShowDocTypes(true)
  }

  const saveMetadata = async () => {
    setSaveLoading(true)
    const [e] = await asyncRunSafe<CommonResponse>(modifyDocMetadata({
      datasetId,
      documentId,
      body: {
        doc_type: metadataParams.documentType || docType || '',
        doc_metadata: metadataParams.metadata,
      },
    }) as Promise<CommonResponse>)
    if (!e)
      notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
    else
      notify({ type: 'error', message: t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }) })
    onUpdate?.()
    setEditStatus(false)
    setSaveLoading(false)
  }

  const updateMetadataField = (field: string, value: string) => {
    setMetadataParams(prev => ({ ...prev, metadata: { ...prev.metadata, [field]: value } }))
  }

  return {
    docType,
    editStatus,
    showDocTypes,
    tempDocType,
    saveLoading,
    metadataParams,
    setTempDocType,
    setShowDocTypes,
    confirmDocType,
    cancelDocType,
    enableEdit,
    cancelEdit,
    saveMetadata,
    updateMetadataField,
  }
}
