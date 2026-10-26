'use client'

import { usePrefetchQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

export function AppDetailPrefetch({ appId }: { appId: string }) {
  usePrefetchQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: { params: { app_id: appId } },
    }),
  )
  return null
}
