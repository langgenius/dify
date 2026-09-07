'use client'

import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { consoleQuery } from '@/service/client'
import { emptyWorkspacePermissionKeys } from './app-context-normalizers'

const workspacePermissionKeysQueryAtom = atomWithQuery(() =>
  consoleQuery.workspaces.current.rbac.myPermissions.get.queryOptions(),
)

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

export const workspacePermissionKeysErrorAtom = atom((get) => {
  return get(workspacePermissionKeysQueryAtom).error
})
