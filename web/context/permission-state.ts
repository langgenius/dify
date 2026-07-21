'use client'

import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { consoleQuery } from '@/service/client'
import { emptyWorkspacePermissionKeys } from './app-context-normalizers'
import { currentWorkspaceIdAtom } from './workspace-state'

const workspacePermissionKeysQuery = consoleQuery.workspaces.current.rbac.myPermissions.get

export const workspacePermissionKeysQueryKey = (workspaceId: string) => {
  return [...workspacePermissionKeysQuery.queryKey({ input: {} }), { workspaceId }] as const
}

const workspacePermissionKeysQueryAtom = atomWithQuery((get) => {
  const workspaceId = get(currentWorkspaceIdAtom)

  return workspacePermissionKeysQuery.queryOptions({
    input: {},
    queryKey: workspacePermissionKeysQueryKey(workspaceId),
    enabled: Boolean(workspaceId),
  })
})

export const workspacePermissionKeysAtom = atom((get) => {
  return (
    get(workspacePermissionKeysQueryAtom).data?.workspace?.permission_keys ??
    emptyWorkspacePermissionKeys
  )
})

export const workspacePermissionKeysLoadingAtom = atom((get) => {
  return get(workspacePermissionKeysQueryAtom).isPending
})
