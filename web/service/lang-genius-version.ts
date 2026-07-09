import { consoleQuery } from './client'

export const langGeniusVersionQueryOptions = (currentVersion?: string | null, enabled?: boolean) => {
  return consoleQuery.version.get.queryOptions({
    input: {
      query: {
        current_version: currentVersion ?? '',
      },
    },
    enabled: !!currentVersion && (enabled ?? true),
  })
}
