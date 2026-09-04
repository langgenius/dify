import type { ReactNode } from 'react'
import { getSystemFeatures } from '@/features/system-features/server'
import { redirect } from '@/next/navigation'

export default async function Layout({ children }: { children: ReactNode }) {
  const systemFeatures = await getSystemFeatures()

  if (!systemFeatures.knowledge_fs_enabled) redirect('/datasets')

  return children
}
