'use client'

import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { consoleQuery } from '@/service/client'
import { initialWorkspaceSummary } from './app-context-defaults'
import { getWorkspaceRoleFlags, normalizeCurrentWorkspaceSummary } from './app-context-normalizers'

const currentWorkspaceQueryAtom = atomWithQuery(() => {
  return consoleQuery.workspaces.current.summary.get.queryOptions({
    select: normalizeCurrentWorkspaceSummary,
  })
})

export const currentWorkspaceAtom = atom((get) => {
  return get(currentWorkspaceQueryAtom).data ?? initialWorkspaceSummary
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

/**
 * Retained for future permission checks when RBAC is disabled.
 *
 * @public
 */
export const isCurrentWorkspaceEditorAtom = atom((get) => {
  return get(workspaceRoleFlagsAtom).isCurrentWorkspaceEditor
})

export const isCurrentWorkspaceDatasetOperatorAtom = atom((get) => {
  return get(workspaceRoleFlagsAtom).isCurrentWorkspaceDatasetOperator
})

export const currentWorkspaceLoadingAtom = atom((get) => {
  return get(currentWorkspaceQueryAtom).isPending
})
