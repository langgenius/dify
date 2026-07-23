'use client'

import type { ReactNode } from 'react'
import { useAtomValue } from 'jotai'
import { useEffect } from 'react'
import { systemFeaturesAtom } from '@/context/system-features-state'
import { useRouter } from '@/next/navigation'

export function KnowledgeRouteGuard({ children }: { children: ReactNode }) {
  const { knowledge_fs_enabled: knowledgeFsEnabled } = useAtomValue(systemFeaturesAtom)
  const router = useRouter()

  useEffect(() => {
    if (!knowledgeFsEnabled) router.replace('/datasets')
  }, [knowledgeFsEnabled, router])

  if (!knowledgeFsEnabled) return null

  return children
}
