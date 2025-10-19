import { useMemo } from 'react'
import { useGetLanguage } from '@/context/i18n'

export const useDatasetApiAccessUrl = () => {
  const locale = useGetLanguage()

  const apiReferenceUrl = useMemo(() => {
    if (locale === 'zh_Hans')
      return 'https://docs.dify.ai/api-reference/%E6%95%B0%E6%8D%AE%E9%9B%86'
    if (locale === 'ja_JP')
      return 'https://docs.dify.ai/api-reference/%E3%83%87%E3%83%BC%E3%82%BF%E3%82%BB%E3%83%83%E3%83%88'
    return 'https://docs.dify.ai/api-reference/datasets'
  }, [locale])

  return apiReferenceUrl
}
