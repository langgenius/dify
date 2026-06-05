import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import { queryOptions } from '@tanstack/react-query'
import { IS_DEV } from '@/config'
// eslint-disable-next-line no-restricted-imports
import { get } from '@/service/base'
import { consoleQuery } from '@/service/client'

export type UserProfileWithMeta = {
  profile: GetAccountProfileResponse
  meta: {
    currentVersion: string | null
    currentEnv: string | null
  }
}

export const isLegacyBase401 = (err: unknown): boolean =>
  err instanceof Response && err.status === 401

export const userProfileQueryOptions = () =>
  queryOptions<UserProfileWithMeta>({
    queryKey: consoleQuery.account.profile.get.queryKey(),
    queryFn: async () => {
      const response = await get<Response>('/account/profile', {}, {
        needAllResponseContent: true,
        silent: true,
      })
      const profile: GetAccountProfileResponse = await response.clone().json()
      return {
        profile,
        meta: {
          currentVersion: response.headers.get('x-version'),
          currentEnv: IS_DEV
            ? 'DEVELOPMENT'
            : response.headers.get('x-env'),
        },
      }
    },
    retry: (failureCount, error) => !isLegacyBase401(error) && failureCount < 3,
  })
