import { serverConsoleQuery } from '@/service/server'

export const serverSystemFeaturesQueryOptions = () =>
  serverConsoleQuery.systemFeatures.get.queryOptions()
