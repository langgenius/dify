'use client'
import type { FC } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import StatusWithAction from './status-with-action'

type Props = Readonly<{
  datasetId: string
}>

const AutoDisabledDocument: FC<Props> = ({ datasetId }) => {
  const { t } = useTranslation(['common', 'dataset'])
  const queryClient = useQueryClient()
  const autoDisableLogsQuery = consoleQuery.datasets.byDatasetId.autoDisableLogs.get.queryOptions({
    input: { params: { dataset_id: datasetId } },
  })
  const { data, isLoading } = useQuery(autoDisableLogsQuery)
  const documentIds = data?.document_ids
  const { mutateAsync: changeDocumentStatus } = useMutation(
    consoleQuery.datasets.byDatasetId.documents.status.byAction.batch.patch.mutationOptions(),
  )
  if (!documentIds?.length || isLoading) return null

  const handleEnableDocuments = async () => {
    await changeDocumentStatus({
      params: { dataset_id: datasetId, action: 'enable' },
      query: { document_id: documentIds },
    })
    queryClient.invalidateQueries({ queryKey: autoDisableLogsQuery.queryKey })
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
