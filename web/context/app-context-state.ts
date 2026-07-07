'use client'

import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import type { DefinedQueryObserverResult } from '@tanstack/react-query'
import type { UserProfileWithMeta } from '@/features/account-profile/client'
import { atom } from 'jotai'
import { atomWithQuery, atomWithSuspenseQuery, queryClientAtom } from 'jotai-tanstack-query'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { defaultSystemFeatures } from '@/features/system-features/config'
import { workspacePermissionKeysQueryOptions } from '@/service/access-control/use-permission-keys'
import { consoleQuery } from '@/service/client'
import { langGeniusVersionQueryOptions } from '@/service/lang-genius-version'
import {
  initialLangGeniusVersionInfo,
  initialWorkspaceInfo,
  userProfilePlaceholder,
} from './app-context-defaults'
import {
  emptyWorkspacePermissionKeys,
  getLangGeniusVersionInfo,
  getWorkspaceRoleFlags,
  normalizeCurrentWorkspace,
} from './app-context-normalizers'

type SuspenseQueryResult<T> = Omit<DefinedQueryObserverResult<T>, 'isPlaceholderData'>

const accountProfileQueryAtom = atomWithSuspenseQuery(() => userProfileQueryOptions())

const systemFeaturesQueryAtom = atomWithSuspenseQuery(() => systemFeaturesQueryOptions())

export const systemFeaturesAtom = atom((get): GetSystemFeaturesResponse => {
  const systemFeaturesQuery = get(systemFeaturesQueryAtom) as SuspenseQueryResult<GetSystemFeaturesResponse>

  return systemFeaturesQuery.data ?? defaultSystemFeatures
})

export const userProfileAtom = atom((get): GetAccountProfileResponse => {
  const accountProfileQuery = get(accountProfileQueryAtom) as SuspenseQueryResult<UserProfileWithMeta>

  return accountProfileQuery.data?.profile || userProfilePlaceholder
})

const profileMetaAtom = atom((get) => {
  const accountProfileQuery = get(accountProfileQueryAtom) as SuspenseQueryResult<UserProfileWithMeta>

  return accountProfileQuery.data?.meta ?? {
    currentVersion: null,
    currentEnv: null,
  }
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

export const workspaceRoleFlagsAtom = atom((get) => {
  return getWorkspaceRoleFlags(get(currentWorkspaceAtom))
})

const workspacePermissionKeysQueryAtom = atomWithQuery((get) => {
  const workspaceId = get(currentWorkspaceAtom).id

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

export const currentWorkspaceValidatingAtom = atom((get) => {
  return get(currentWorkspaceQueryAtom).isFetching
})

const versionQueryAtom = atomWithQuery((get) => {
  const meta = get(profileMetaAtom)
  const systemFeaturesQuery = get(systemFeaturesQueryAtom) as SuspenseQueryResult<GetSystemFeaturesResponse>
  const enabled = Boolean(meta.currentVersion && !systemFeaturesQuery.data?.branding.enabled)

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

export const refreshUserProfileAtom = atom(null, (get) => {
  const queryClient = get(queryClientAtom)
  queryClient.invalidateQueries({ queryKey: userProfileQueryOptions().queryKey })
})

export const refreshCurrentWorkspaceAtom = atom(null, (get) => {
  const queryClient = get(queryClientAtom)
  queryClient.invalidateQueries({ queryKey: consoleQuery.workspaces.current.post.key() })
})
