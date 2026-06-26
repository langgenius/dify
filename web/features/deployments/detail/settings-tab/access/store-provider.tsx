'use client'

import type { ReactNode } from 'react'
import type { AccessControlDraft, AccessControlStoreApi } from './store'
import { useRef } from 'react'
import { AccessControlStoreContext, createAccessControlStore } from './store'

export function AccessControlDraftProvider({
  children,
  draftKey,
  initialDraft,
}: {
  children?: ReactNode
  draftKey: string
  initialDraft: AccessControlDraft
}) {
  const storeRef = useRef<{
    draftKey: string
    store: AccessControlStoreApi
  } | undefined>(undefined)

  if (!storeRef.current || storeRef.current.draftKey !== draftKey) {
    storeRef.current = {
      draftKey,
      store: createAccessControlStore(initialDraft),
    }
  }

  return (
    <AccessControlStoreContext value={storeRef.current.store}>
      {children}
    </AccessControlStoreContext>
  )
}
