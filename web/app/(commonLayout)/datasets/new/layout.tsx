import type { ReactNode } from 'react'
import { redirect } from '@/next/navigation'
import { consoleClient } from '@/service/console'

export default async function Layout({ children }: { children: ReactNode }) {
  const features = await consoleClient.features.get()

  if (!features.enable_knowledge_fs) redirect('/datasets')

  return children
}
