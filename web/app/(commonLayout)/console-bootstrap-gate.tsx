'use client'

import type { ReactNode } from 'react'
import { useSuspenseQueries } from '@tanstack/react-query'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'

export function ConsoleBootstrapGate({ children }: { children: ReactNode }) {
  useSuspenseQueries({
    queries: [userProfileQueryOptions(), systemFeaturesQueryOptions()],
  })

  return children
}
