import { useDocLink } from '@/context/i18n'

export const useDatasetApiAccessUrl = () => {
  const docLink = useDocLink()

  return docLink('/api-reference/datasets', {
    'zh-Hans': '/api-reference/%E6%95%B0%E6%8D%AE%E9%9B%86',
    'ja-JP': '/api-reference/%E3%83%87%E3%83%BC%E3%82%BF%E3%82%BB%E3%83%83%E3%83%88',
  })
}
