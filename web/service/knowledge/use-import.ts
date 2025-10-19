import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get } from '../base'
import type { DataSourceNotionWorkspace } from '@/models/common'

type PreImportNotionPagesParams = {
  datasetId: string
  credentialId: string
}

const PRE_IMPORT_NOTION_PAGES_QUERY_KEY = 'notion-pre-import-pages'

export const usePreImportNotionPages = ({
  datasetId,
  credentialId,
}: PreImportNotionPagesParams) => {
  return useQuery({
    queryKey: [PRE_IMPORT_NOTION_PAGES_QUERY_KEY, datasetId, credentialId],
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

export const useInvalidPreImportNotionPages = () => {
  const queryClient = useQueryClient()
  return ({
    datasetId,
    credentialId,
  }: PreImportNotionPagesParams) => {
    queryClient.invalidateQueries(
      {
        queryKey: [PRE_IMPORT_NOTION_PAGES_QUERY_KEY, datasetId, credentialId],
      },
    )
  }
}
