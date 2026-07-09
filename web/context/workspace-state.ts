'use client'

import { atom } from 'jotai'
import { atomWithQuery, queryClientAtom } from 'jotai-tanstack-query'
import { consoleQuery } from '@/service/client'
import { initialWorkspaceInfo } from './app-context-defaults'
import {
  getWorkspaceRoleFlags,
  normalizeCurrentWorkspace,
} from './app-context-normalizers'

const currentWorkspaceQueryAtom = atomWithQuery(() => {
  return consoleQuery.workspaces.current.post.queryOptions({
    select: normalizeCurrentWorkspace,
  })
})

export const currentWorkspaceAtom = atom((get) => {
  return get(currentWorkspaceQueryAtom).data ?? initialWorkspaceInfo
})

export const currentWorkspaceIdAtom = atom((get) => {
  return get(currentWorkspaceAtom).id
})

const workspaceRoleFlagsAtom = atom((get) => {
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

export const currentWorkspaceLoadingAtom = atom((get) => {
  return get(currentWorkspaceQueryAtom).isPending
})

export const refreshCurrentWorkspaceAtom = atom(null, (get) => {
  const queryClient = get(queryClientAtom)
  queryClient.invalidateQueries({ queryKey: consoleQuery.workspaces.current.post.key() })
})
