import { consoleQuery } from '@/service/console'

export const systemFeaturesQueryOptions = () =>
  consoleQuery.systemFeatures.get.queryOptions({
    staleTime: Infinity,
  })
