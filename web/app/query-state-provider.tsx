'use client'

import type { ReactNode } from 'react'
import { QueryStateProvider as UrlStateProvider } from 'nuqs-jotai'
import { newRagQueryGroups } from '@/features/new-rag/query-groups'

/** Registered once under the root NuqsAdapter; feature scopes retain their own state. */
export function QueryStateProvider({ children }: { children: ReactNode }) {
  return <UrlStateProvider groups={newRagQueryGroups}>{children}</UrlStateProvider>
}
