'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { useAutoDisabledDocuments, useDocumentEnable, useInvalidDisabledDocument } from '@/service/knowledge/use-document'
import StatusWithAction from './status-with-action'

type Props = {
  datasetId: string
}

const AutoDisabledDocument: FC<Props> = ({
  datasetId,
}) => {
  const { t } = useTranslation()
  const { data, isLoading } = useAutoDisabledDocuments(datasetId)
  const invalidDisabledDocument = useInvalidDisabledDocument()
  const documentIds = data?.document_ids
  const hasDisabledDocument = documentIds && documentIds.length > 0
  const { mutateAsync: enableDocument } = useDocumentEnable()
  const handleEnableDocuments = useCallback(async () => {
    await enableDocument({ datasetId, documentIds })
    invalidDisabledDocument()
    Toast.notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
  }, [])
  if (!hasDisabledDocument || isLoading)
    return null

  return (
    <StatusWithAction
      type="info"
      description={t('documentsDisabled', { ns: 'dataset', num: documentIds?.length })}
      actionText={t('enable', { ns: 'dataset' })}
      onAction={handleEnableDocuments}
    />
  )
}
export default React.memo(AutoDisabledDocument)
