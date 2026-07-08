'use client'

import { atom } from 'jotai'
import { atomWithQuery, queryClientAtom } from 'jotai-tanstack-query'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { workspacePermissionKeysQueryOptions } from '@/service/access-control/use-permission-keys'
import { consoleQuery } from '@/service/client'
import { langGeniusVersionQueryOptions } from '@/service/lang-genius-version'
import { atomWithPrefetchedQuery } from '@/utils/atom-with-prefetched-query'
import {
  initialLangGeniusVersionInfo,
  initialWorkspaceInfo,
} from './app-context-defaults'
import {
  emptyWorkspacePermissionKeys,
  getLangGeniusVersionInfo,
  getWorkspaceRoleFlags,
  normalizeCurrentWorkspace,
} from './app-context-normalizers'

const accountProfileQueryAtom = atomWithPrefetchedQuery(() => userProfileQueryOptions())

const systemFeaturesQueryAtom = atomWithPrefetchedQuery(() => systemFeaturesQueryOptions())

const systemFeaturesAtom = atom((get) => {
  return get(systemFeaturesQueryAtom).data
})

export const userProfileAtom = atom((get) => {
  return get(accountProfileQueryAtom).data.profile
})

export const userProfileIdAtom = atom((get) => {
  return get(userProfileAtom).id
})

export const userProfileEmailAtom = atom((get) => {
  return get(userProfileAtom).email
})

const profileMetaAtom = atom((get) => {
  return get(accountProfileQueryAtom).data.meta
})

const currentWorkspaceQueryAtom = atomWithQuery(() => {
  return consoleQuery.workspaces.current.post.queryOptions({
    select: normalizeCurrentWorkspace,
  })
})

const normalizedCurrentWorkspaceAtom = atom((get) => {
  return get(currentWorkspaceQueryAtom).data ?? initialWorkspaceInfo
})

export const currentWorkspaceAtom = atom((get) => {
  return get(normalizedCurrentWorkspaceAtom)
})

export const currentWorkspaceIdAtom = atom((get) => {
  return get(currentWorkspaceAtom).id
})

export const workspaceRoleFlagsAtom = atom((get) => {
  return getWorkspaceRoleFlags(get(currentWorkspaceAtom))
})

export const isCurrentWorkspaceOwnerAtom = atom((get) => {
  return get(workspaceRoleFlagsAtom).isCurrentWorkspaceOwner
})

export const isCurrentWorkspaceManagerAtom = atom((get) => {
  return get(workspaceRoleFlagsAtom).isCurrentWorkspaceManager
})

export const isCurrentWorkspaceEditorAtom = atom((get) => {
  return get(workspaceRoleFlagsAtom).isCurrentWorkspaceEditor
})

export const isCurrentWorkspaceDatasetOperatorAtom = atom((get) => {
  return get(workspaceRoleFlagsAtom).isCurrentWorkspaceDatasetOperator
})

const workspacePermissionKeysQueryAtom = atomWithQuery((get) => {
  const workspaceId = get(currentWorkspaceIdAtom)

  return workspacePermissionKeysQueryOptions(workspaceId)
})

export const workspacePermissionKeysAtom = atom((get) => {
  return get(workspacePermissionKeysQueryAtom).data?.workspace?.permission_keys ?? emptyWorkspacePermissionKeys
})

export const workspacePermissionKeysLoadingAtom = atom((get) => {
  return get(workspacePermissionKeysQueryAtom).isPending
})

export const currentWorkspaceLoadingAtom = atom((get) => {
  return get(currentWorkspaceQueryAtom).isPending
})

export const datasetRbacEnabledAtom = atom((get) => {
  return get(systemFeaturesAtom).rbac_enabled
})

const versionQueryAtom = atomWithQuery((get) => {
  const meta = get(profileMetaAtom)
  const systemFeaturesQuery = get(systemFeaturesQueryAtom)
  const enabled = Boolean(meta.currentVersion && !systemFeaturesQuery.data.branding.enabled)

  return langGeniusVersionQueryOptions(meta.currentVersion, enabled)
})

export const langGeniusVersionInfoAtom = atom((get) => {
  const meta = get(profileMetaAtom)
  const versionData = get(versionQueryAtom).data

  if (!versionData)
    return initialLangGeniusVersionInfo

  return getLangGeniusVersionInfo({
    meta,
    versionData,
  })
})

export const langGeniusCurrentVersionAtom = atom((get) => {
  return get(langGeniusVersionInfoAtom).current_version
})

export const refreshUserProfileAtom = atom(null, (get) => {
  const queryClient = get(queryClientAtom)
  queryClient.invalidateQueries({ queryKey: userProfileQueryOptions().queryKey })
})

export const refreshCurrentWorkspaceAtom = atom(null, (get) => {
  const queryClient = get(queryClientAtom)
  queryClient.invalidateQueries({ queryKey: consoleQuery.workspaces.current.post.key() })
})
