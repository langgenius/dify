'use client'

import type { ReactNode } from 'react'
import type { KnowledgeSpaceContextValue } from './knowledge-space-context'
import { KnowledgeSpaceContext } from './knowledge-space-context'

export function KnowledgeSpaceProvider({
  children,
  refetch,
  space,
}: KnowledgeSpaceContextValue & { children: ReactNode }) {
  return <KnowledgeSpaceContext value={{ refetch, space }}>{children}</KnowledgeSpaceContext>
}
