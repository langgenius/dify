'use client'

import { atom } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { atomWithResolvedSuspenseQuery } from '@/utils/query-atoms'

const accountProfileQueryAtom = atomWithResolvedSuspenseQuery(() => userProfileQueryOptions())

export const userProfileAtom = atom((get) => {
  return get(accountProfileQueryAtom).data.profile
})

export const userProfileIdAtom = atom((get) => {
  return get(userProfileAtom).id
})

export const userProfileEmailAtom = atom((get) => {
  return get(userProfileAtom).email
})

export const accountProfileMetaAtom = atom((get) => {
  return get(accountProfileQueryAtom).data.meta
})

export const refreshUserProfileAtom = atom(null, (get) => {
  const queryClient = get(queryClientAtom)
  queryClient.invalidateQueries({ queryKey: userProfileQueryOptions().queryKey })
})
