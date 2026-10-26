import { consoleQuery } from '@/service/console'

// Deployment configuration: it changes only with a redeploy, so the hydrated snapshot never goes stale.
export const knowledgeFsFeaturesQueryOptions = () =>
  consoleQuery.knowledgeFs.features.get.queryOptions({
    staleTime: Infinity,
  })
