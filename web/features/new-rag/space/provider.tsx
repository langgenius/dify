'use client'

import type { ReactNode } from 'react'
import type { KnowledgeSpaceContextValue } from './context'
import { KnowledgeSpaceContext } from './context'

export function KnowledgeSpaceProvider({
  children,
  refetch,
  space,
}: KnowledgeSpaceContextValue & { children: ReactNode }) {
  return <KnowledgeSpaceContext value={{ refetch, space }}>{children}</KnowledgeSpaceContext>
}
