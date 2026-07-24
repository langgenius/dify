import type { ReactNode } from 'react'
import { getQueryClientServer } from '@/context/query-client-server'
import { serverSystemFeaturesQueryOptions } from '@/features/system-features/server'
import { redirect } from '@/next/navigation'

export default async function Layout({ children }: { children: ReactNode }) {
  const systemFeatures = await getQueryClientServer().ensureQueryData(
    serverSystemFeaturesQueryOptions(),
  )

  if (!systemFeatures.knowledge_fs_enabled) redirect('/datasets')

  return children
}
