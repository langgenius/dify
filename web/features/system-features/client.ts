import { consoleQuery } from '@/service/client'

export const systemFeaturesQueryOptions = () => consoleQuery.systemFeatures.get.queryOptions()
