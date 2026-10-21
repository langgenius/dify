import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useTranslation } from 'react-i18next'

type Props = {
  dataset: Pick<
    DatasetDetailWithPartialMembersResponse,
    'vector_indexing_status' | 'vector_indexing_error'
  >
}

export const VectorIndexStatus = ({ dataset }: Props) => {
  const { t } = useTranslation(['datasetDocuments'])
  const status = dataset.vector_indexing_status
  if (status !== 'indexing' && status !== 'error') return null

  return (
    <div role="status" className="flex items-center gap-2 px-4 py-2 text-xs text-text-secondary">
      <StatusDot status={status === 'error' ? 'error' : 'normal'} />
      <span>
        {status === 'error'
          ? dataset.vector_indexing_error ||
            t(($) => $['list.status.error'], { ns: 'datasetDocuments' })
          : t(($) => $['list.status.indexing'], { ns: 'datasetDocuments' })}
      </span>
    </div>
  )
}
