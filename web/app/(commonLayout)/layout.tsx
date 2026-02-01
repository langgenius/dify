import type { ReactNode } from 'react'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import GA, { GaType } from '@/app/components/base/ga'
import Zendesk from '@/app/components/base/zendesk'
import { getQueryClientServer } from '@/context/query-client-server'
import { serverFetchWithAuth } from '@/utils/ssr-fetch'
import { CommonLayoutClient } from './layout-client'

const IS_DEV = process.env.NODE_ENV === 'development'

async function fetchUserProfileForSSR() {
  const { data: profile, headers } = await serverFetchWithAuth('/account/profile')
  return {
    profile,
    meta: {
      currentVersion: headers.get('x-version'),
      currentEnv: IS_DEV ? 'DEVELOPMENT' : headers.get('x-env'),
    },
  }
}

export default async function CommonLayout({ children }: { children: ReactNode }) {
  const queryClient = getQueryClientServer()

  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: ['common', 'user-profile'],
      queryFn: fetchUserProfileForSSR,
    }),
    queryClient.prefetchQuery({
      queryKey: ['common', 'current-workspace'],
      queryFn: async () => {
        const { data } = await serverFetchWithAuth('/workspaces/current', 'POST', {})
        return data
      },
    }),
  ])

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <GA gaType={GaType.admin} />
      <CommonLayoutClient>{children}</CommonLayoutClient>
      <Zendesk />
    </HydrationBoundary>
  )
}
