import { useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

export function useDifyBuilderEnabled() {
  const { data, isSuccess } = useQuery(
    consoleQuery.features.get.queryOptions({
      retry: false,
      select: (features) => features.dify_builder_enabled,
    }),
  )
  return isSuccess && data === true
}
