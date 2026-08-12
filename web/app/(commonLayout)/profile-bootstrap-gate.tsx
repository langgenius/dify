'use client'

import type { ReactNode } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { userProfileQueryOptions } from '@/features/account-profile/client'

export function ProfileBootstrapGate({ children }: { children: ReactNode }) {
  useSuspenseQuery(userProfileQueryOptions())

  return children
}
