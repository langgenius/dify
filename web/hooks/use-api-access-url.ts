import { useDocLink } from '@/context/i18n'

export const useDatasetApiAccessUrl = () => {
  const docLink = useDocLink()

  return docLink('/api-reference/datasets/get-knowledge-base-list')
}
