'use client'

import { atom } from 'jotai'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { atomWithResolvedSuspenseQuery } from '@/utils/query-atoms'

const accountProfileQueryAtom = atomWithResolvedSuspenseQuery(() => userProfileQueryOptions())

export const userProfileAtom = atom((get) => {
  return get(accountProfileQueryAtom).data.profile
})

export const accountProfileMetaAtom = atom((get) => {
  return get(accountProfileQueryAtom).data.meta
})
