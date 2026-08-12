import type { ReactNode } from 'react'
import {
  getSystemFeaturesQueryClient,
  systemFeaturesServerQueryOptions,
} from '@/features/system-features/server'
import { redirect } from '@/next/navigation'

export default async function Layout({ children }: { children: ReactNode }) {
  const systemFeatures = await getSystemFeaturesQueryClient().ensureQueryData(
    systemFeaturesServerQueryOptions(),
  )

  if (!systemFeatures.knowledge_fs_enabled) redirect('/datasets')

  return children
}
