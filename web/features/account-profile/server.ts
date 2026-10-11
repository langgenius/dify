import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import type { UserProfileWithMeta } from './client'
import { queryOptions } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import {
  getServerConsoleRequestHeaders,
  resolveServerConsoleApiUrl,
} from '@/service/console/server'

const ACCOUNT_PROFILE_PATH = '/account/profile'

export const serverUserProfileQueryOptions = () =>
  queryOptions<UserProfileWithMeta>({
    queryKey: consoleQuery.account.profile.get.queryKey(),
    queryFn: async () => {
      const profileUrl = resolveServerConsoleApiUrl(ACCOUNT_PROFILE_PATH)
      if (!profileUrl) throw new Error('Server account profile URL is not configured')

      const response = await fetch(profileUrl, {
        method: 'GET',
        headers: await getServerConsoleRequestHeaders(),
        cache: 'no-store',
      })

      if (!response.ok) throw response

      const profile: GetAccountProfileResponse = await response.clone().json()
      return {
        profile,
        meta: {
          currentVersion: response.headers.get('x-version'),
          currentEnv: response.headers.get('x-env'),
        },
      }
    },
    retry: false,
  })
