import { useQuery } from '@tanstack/react-query'
import { preImportNotionPages } from '../datasets'

type PreImportNotionPagesParams = {
  url: string
  datasetId?: string
}

export const usePreImportNotionPages = ({ datasetId }: PreImportNotionPagesParams) => {
  return useQuery({
    queryKey: ['notion-pre-import-pages'],
    queryFn: async () => {
      return preImportNotionPages({ url: '/notion/pre-import/pages', datasetId })
    },
  })
}
