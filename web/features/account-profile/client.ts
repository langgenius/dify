import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import { queryOptions } from '@tanstack/react-query'
import { IS_DEV } from '@/config'
import { consoleClient, consoleQuery } from '@/service/console'
import { isUnauthorizedError } from '@/service/http-error'

export type UserProfileWithMeta = {
  profile: GetAccountProfileResponse
  meta: {
    currentVersion: string | null
    currentEnv: string | null
  }
}

export const userProfileQueryOptions = () =>
  queryOptions<UserProfileWithMeta>({
    queryKey: consoleQuery.account.profile.get.queryKey(),
    queryFn: async () => {
      let responseHeaders: Headers | undefined
      const profile = await consoleClient.account.profile.get(undefined, {
        context: {
          silent: true,
          onResponseHeaders: (headers) => {
            responseHeaders = headers
          },
        },
      })
      return {
        profile,
        meta: {
          currentVersion: responseHeaders?.get('x-version') ?? null,
          currentEnv: IS_DEV ? 'DEVELOPMENT' : (responseHeaders?.get('x-env') ?? null),
        },
      }
    },
    retry: (failureCount, error) => !isUnauthorizedError(error) && failureCount < 3,
  })
