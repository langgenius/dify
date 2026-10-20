'use client'

import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { consoleQuery } from '@/service/console'
import { emptyWorkspacePermissionKeys } from './app-context-normalizers'

const workspacePermissionKeysQueryAtom = atomWithQuery(() => {
  return consoleQuery.workspaces.current.rbac.myPermissions.get.queryOptions()
})

export const workspacePermissionKeysAtom = atom((get) => {
  return (
    get(workspacePermissionKeysQueryAtom).data?.workspace?.permission_keys ??
    emptyWorkspacePermissionKeys
  )
})

/** @public Used by New Knowledge on deploy/konwledge. */
export const datasetDefaultPermissionKeysAtom = atom((get) => {
  return get(workspacePermissionKeysQueryAtom).data?.dataset?.default_permission_keys ?? []
})

export const agentDefaultPermissionKeysAtom = atom((get) => {
  return get(workspacePermissionKeysQueryAtom).data?.agent?.default_permission_keys ?? []
})

export const workspacePermissionKeysLoadingAtom = atom((get) => {
  return get(workspacePermissionKeysQueryAtom).isPending
})

/** @public Used by New Knowledge on deploy/konwledge. */
export const workspacePermissionKeysFetchingAtom = atom((get) => {
  return get(workspacePermissionKeysQueryAtom).isFetching
})

/** @public Used by New Knowledge on deploy/konwledge. */
export const workspacePermissionKeysErrorAtom = atom((get) => {
  return get(workspacePermissionKeysQueryAtom).error
})

/** @public Used by New Knowledge on deploy/konwledge. */
export const retryWorkspacePermissionKeysAtom = atom(null, (get) => {
  return get(workspacePermissionKeysQueryAtom).refetch({ cancelRefetch: false })
})

/** @public Used by New Knowledge on deploy/konwledge. */
export const refreshWorkspacePermissionKeysAfterMutationDenialAtom = atom(null, (get) => {
  return get(workspacePermissionKeysQueryAtom).refetch({ cancelRefetch: true })
})
