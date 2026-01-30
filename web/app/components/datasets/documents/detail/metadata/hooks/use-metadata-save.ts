import type { MetadataState } from './use-metadata-editor'
import type { CommonResponse } from '@/models/common'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { ToastContext } from '@/app/components/base/toast'
import { modifyDocMetadata } from '@/service/datasets'
import { asyncRunSafe } from '@/utils'

type UseMetadataSaveOptions = {
  datasetId: string
  documentId: string
  metadataParams: MetadataState
  doc_type: string
  onSuccess: () => void
  onUpdate: () => void
}

export function useMetadataSave({
  datasetId,
  documentId,
  metadataParams,
  doc_type,
  onSuccess,
  onUpdate,
}: UseMetadataSaveOptions) {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const [saveLoading, setSaveLoading] = useState(false)

  const handleSave = useCallback(async () => {
    setSaveLoading(true)
    const [e] = await asyncRunSafe<CommonResponse>(modifyDocMetadata({
      datasetId,
      documentId,
      body: {
        doc_type: metadataParams.documentType || doc_type || '',
        doc_metadata: metadataParams.metadata,
      },
    }) as Promise<CommonResponse>)

    if (!e)
      notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
    else
      notify({ type: 'error', message: t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }) })

    onUpdate()
    onSuccess()
    setSaveLoading(false)
  }, [datasetId, documentId, metadataParams, doc_type, notify, t, onUpdate, onSuccess])

  return {
    saveLoading,
    handleSave,
  }
}
