'use client'

import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { workspacePermissionKeysQueryOptions } from '@/service/access-control/use-permission-keys'
import { emptyWorkspacePermissionKeys } from './app-context-normalizers'
import { currentWorkspaceIdAtom } from './workspace-state'

const workspacePermissionKeysQueryAtom = atomWithQuery((get) => {
  const workspaceId = get(currentWorkspaceIdAtom)

  return workspacePermissionKeysQueryOptions(workspaceId)
})

export const workspacePermissionKeysAtom = atom((get) => {
  return (
    get(workspacePermissionKeysQueryAtom).data?.workspace?.permission_keys ??
    emptyWorkspacePermissionKeys
  )
})

export const datasetDefaultPermissionKeysAtom = atom((get) => {
  return get(workspacePermissionKeysQueryAtom).data?.dataset?.default_permission_keys ?? []
})

export const workspacePermissionKeysLoadingAtom = atom((get) => {
  return get(workspacePermissionKeysQueryAtom).isPending
})

export const workspacePermissionKeysFetchingAtom = atom((get) => {
  return get(workspacePermissionKeysQueryAtom).isFetching
})

export const workspacePermissionKeysErrorAtom = atom((get) => {
  return get(workspacePermissionKeysQueryAtom).error
})

export const retryWorkspacePermissionKeysAtom = atom(null, (get) => {
  void get(workspacePermissionKeysQueryAtom).refetch()
})
