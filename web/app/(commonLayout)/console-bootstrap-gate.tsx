'use client'

import type { ReactNode } from 'react'
import { useQueries } from '@tanstack/react-query'
import { isLegacyBase401, userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'

export function ConsoleBootstrapGate({ children }: { children: ReactNode }) {
  const [profileQuery, systemFeaturesQuery] = useQueries({
    queries: [userProfileQueryOptions(), systemFeaturesQueryOptions()],
  })

  if (profileQuery.isPending || systemFeaturesQuery.isPending) return null
  if (profileQuery.isError && isLegacyBase401(profileQuery.error)) return null
  if (profileQuery.isError) throw profileQuery.error
  if (systemFeaturesQuery.isError) throw systemFeaturesQuery.error

  return children
}
