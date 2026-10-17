import type { ReactNode } from 'react'
import { getKnowledgeFsFeatures } from '@/features/knowledge-fs-availability/server'
import { redirect } from '@/next/navigation'

export default async function Layout({ children }: { children: ReactNode }) {
  const knowledgeFsFeatures = await getKnowledgeFsFeatures()

  if (!knowledgeFsFeatures.enabled) redirect('/datasets')

  return children
}
