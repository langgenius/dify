'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import StatusWithAction from './status-with-action'
import { useAutoDisabledDocuments, useDocumentEnable, useInvalidDisabledDocument } from '@/service/knowledge/use-document'
import Toast from '@/app/components/base/toast'
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
    Toast.notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
  }, [])
  if (!hasDisabledDocument || isLoading)
    return null

  return (
    <StatusWithAction
      type='info'
      description={t('dataset.documentsDisabled', { num: documentIds?.length })}
      actionText={t('dataset.enable')}
      onAction={handleEnableDocuments}
    />
  )
}
export default React.memo(AutoDisabledDocument)
