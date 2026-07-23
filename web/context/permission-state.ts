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

export const workspacePermissionKeysLoadingAtom = atom((get) => {
  return get(workspacePermissionKeysQueryAtom).isPending
})
