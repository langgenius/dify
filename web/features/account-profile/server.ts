import type { UserProfileWithMeta } from './client'
import { queryOptions } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/console'
import '@/service/console/server'

export const serverUserProfileQueryOptions = () =>
  queryOptions<UserProfileWithMeta>({
    queryKey: consoleQuery.account.profile.get.queryKey(),
    queryFn: async () => {
      let responseHeaders: Headers | undefined
      const profile = await consoleClient.account.profile.get(undefined, {
        context: {
          onResponseHeaders: (headers) => {
            responseHeaders = headers
          },
        },
      })
      return {
        profile,
        meta: {
          currentVersion: responseHeaders?.get('x-version') ?? null,
          currentEnv: responseHeaders?.get('x-env') ?? null,
        },
      }
    },
    retry: false,
  })
