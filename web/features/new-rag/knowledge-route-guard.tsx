'use client'

import type { ReactNode } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useRouter } from '@/next/navigation'

export function KnowledgeRouteGuard({ children }: { children: ReactNode }) {
  const { data: knowledgeFsEnabled } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ knowledge_fs_enabled }) => knowledge_fs_enabled,
  })
  const router = useRouter()

  useEffect(() => {
    if (!knowledgeFsEnabled) router.replace('/datasets')
  }, [knowledgeFsEnabled, router])

  if (!knowledgeFsEnabled) return null

  return children
}
