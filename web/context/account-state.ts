'use client'

import { atom } from 'jotai'
import { atomWithQuery, queryClientAtom } from 'jotai-tanstack-query'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { atomWithResolvedSuspenseQuery } from '@/utils/query-atoms'

const accountProfileQueryAtom = atomWithResolvedSuspenseQuery(() => userProfileQueryOptions())

const accountProfilePendingQueryAtom = atomWithQuery(() => userProfileQueryOptions())

/**
 * Render-path only — throws while the profile query is pending.
 * atomEffect / non-render readers must use `userProfileOrNullAtom` instead.
 */
export const userProfileAtom = atom((get) => {
  return get(accountProfileQueryAtom).data.profile
})

export const userProfileIdAtom = atom((get) => {
  return get(userProfileAtom).id
})

export const userProfileEmailAtom = atom((get) => {
  return get(userProfileAtom).email
})

/**
 * Render-path only — throws while the profile query is pending.
 * atomEffect / non-render readers must use `accountProfileMetaOrNullAtom` instead.
 */
export const accountProfileMetaAtom = atom((get) => {
  return get(accountProfileQueryAtom).data.meta
})

/** Pending-safe: `null` until the profile query resolves. For atomEffect / non-render readers. */
export const userProfileOrNullAtom = atom((get) => {
  return get(accountProfilePendingQueryAtom).data?.profile ?? null
})

/** Pending-safe: `null` until the profile query resolves. For atomEffect / non-render readers. */
export const accountProfileMetaOrNullAtom = atom((get) => {
  return get(accountProfilePendingQueryAtom).data?.meta ?? null
})

export const refreshUserProfileAtom = atom(null, (get) => {
  const queryClient = get(queryClientAtom)
  queryClient.invalidateQueries({ queryKey: userProfileQueryOptions().queryKey })
})
