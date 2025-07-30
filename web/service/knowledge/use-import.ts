import { useQuery } from '@tanstack/react-query'
import { get } from '../base'
import type { DataSourceNotionWorkspace } from '@/models/common'

type PreImportNotionPagesParams = {
  credentialId: string
  datasetId: string
}

export const usePreImportNotionPages = ({
  credentialId,
  datasetId,
}: PreImportNotionPagesParams) => {
  return useQuery({
    queryKey: ['notion-pre-import-pages', credentialId, datasetId],
    queryFn: async () => {
      return get<{ notion_info: DataSourceNotionWorkspace[] }>('/notion/pre-import/pages', {
        params: {
          dataset_id: datasetId,
          credential_id: credentialId,
        },
      })
    },
    retry: 0,
  })
}
