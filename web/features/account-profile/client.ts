import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import type { Query } from '@tanstack/react-query'
import { queryOptions } from '@tanstack/react-query'
import { IS_DEV } from '@/config'
import { consoleClient, consoleQuery } from '@/service/console'
import { isUnauthorizedError } from '@/service/http-error'
import { shouldRefreshAvatarUrls } from '@/utils/avatar'

export type UserProfileWithMeta = {
  profile: GetAccountProfileResponse
  meta: {
    currentVersion: string | null
    currentEnv: string | null
  }
}

const refetchForAvatarExpiry = ({ state }: Query<UserProfileWithMeta>): true | 'always' =>
  shouldRefreshAvatarUrls([state.data?.profile.avatar_url]) ? 'always' : true

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
    refetchOnMount: refetchForAvatarExpiry,
    refetchOnWindowFocus: refetchForAvatarExpiry,
    refetchOnReconnect: refetchForAvatarExpiry,
    retry: (failureCount, error) => !isUnauthorizedError(error) && failureCount < 3,
  })
