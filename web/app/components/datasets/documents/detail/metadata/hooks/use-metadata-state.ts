'use client'
import type { CommonResponse } from '@/models/common'
import type { DocType, FullDocumentDetail } from '@/models/datasets'
import { toast } from '@langgenius/dify-ui/toast'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  canEdit?: boolean
}
export function useMetadataState({ docDetail, onUpdate, canEdit = false }: UseMetadataStateOptions) {
  const { doc_metadata = {} } = docDetail || {}
  const rawDocType = docDetail?.doc_type ?? ''
  const docType = normalizeDocType(rawDocType)
  const shouldSelectDocType = canEdit && !rawDocType
  const { t } = useTranslation()
  const datasetId = useDocumentContext(s => s.datasetId)
  const documentId = useDocumentContext(s => s.documentId)
  // If no documentType yet, start in editing + showDocTypes mode
  const [editStatus, setEditStatus] = useState(shouldSelectDocType)
  const [metadataParams, setMetadataParams] = useState<MetadataState>(rawDocType
    ? { documentType: docType, metadata: (doc_metadata || {}) as Record<string, string> }
    : { metadata: {} })
  const [showDocTypes, setShowDocTypes] = useState(shouldSelectDocType)
  const [tempDocType, setTempDocType] = useState<DocType | ''>('')
  const [saveLoading, setSaveLoading] = useState(false)
  // Sync local state when the upstream docDetail changes (e.g. after save or navigation).
  // These setters are intentionally called together to batch-reset multiple pieces
  // of derived editing state that cannot be expressed as pure derived values.
  useEffect(() => {
    if (!rawDocType)
      return

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
  }, [docDetail?.doc_metadata, docType, rawDocType])
  useEffect(() => {
    if (rawDocType && canEdit)
      return

    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setEditStatus(canEdit && !rawDocType)
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setShowDocTypes(canEdit && !rawDocType)
  }, [canEdit, rawDocType])
  const updateShowDocTypes = (show: boolean) => {
    if (!canEdit)
      return

    setShowDocTypes(show)
  }
  const confirmDocType = () => {
    if (!canEdit)
      return

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
    if (!canEdit)
      return

    setTempDocType(metadataParams.documentType ?? '')
    setEditStatus(true)
    setShowDocTypes(false)
  }
  const enableEdit = () => {
    if (!canEdit)
      return

    setEditStatus(true)
  }
  const cancelEdit = () => {
    if (!canEdit)
      return

    setMetadataParams({ documentType: docType || '', metadata: { ...docDetail?.doc_metadata } })
    setEditStatus(!docType)
    if (!docType)
      setShowDocTypes(true)
  }
  const saveMetadata = async () => {
    if (!canEdit)
      return

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
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
    else
      toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
    onUpdate?.()
    setEditStatus(false)
    setSaveLoading(false)
  }
  const updateMetadataField = (field: string, value: string) => {
    if (!canEdit)
      return

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
    setShowDocTypes: updateShowDocTypes,
    confirmDocType,
    cancelDocType,
    enableEdit,
    cancelEdit,
    saveMetadata,
    updateMetadataField,
  }
}
