'use client'
import type { FC } from 'react'
import { toast } from '@langgenius/dify-ui/toast'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  useAutoDisabledDocuments,
  useDocumentEnable,
  useInvalidDisabledDocument,
} from '@/service/knowledge/use-document'
import StatusWithAction from './status-with-action'

type Props = Readonly<{
  datasetId: string
}>

const AutoDisabledDocument: FC<Props> = ({ datasetId }) => {
  const { t } = useTranslation()
  const { data, isLoading } = useAutoDisabledDocuments(datasetId)
  const invalidDisabledDocument = useInvalidDisabledDocument()
  const documentIds = data?.document_ids
  const { mutateAsync: enableDocument } = useDocumentEnable()
  if (!documentIds?.length || isLoading) return null

  const handleEnableDocuments = async () => {
    await enableDocument({ datasetId, documentIds })
    invalidDisabledDocument()
    toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
  }

  return (
    <StatusWithAction
      type="info"
      description={t(($) => $.documentsDisabled, { ns: 'dataset', num: documentIds?.length })}
      actionText={t(($) => $.enable, { ns: 'dataset' })}
      onAction={handleEnableDocuments}
    />
  )
}
export default React.memo(AutoDisabledDocument)
