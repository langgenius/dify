import type { ReactNode } from 'react'
import { getQueryClientServer } from '@/context/query-client-server'
import { redirect } from '@/next/navigation'
import { serverConsoleQuery } from '@/service/server'

export default async function Layout({ children }: { children: ReactNode }) {
  const systemFeatures = await getQueryClientServer().ensureQueryData(
    serverConsoleQuery.systemFeatures.get.queryOptions(),
  )

  if (!systemFeatures.knowledge_fs_enabled) redirect('/datasets')

  return children
}
