'use client'

import { atom } from 'jotai'
import { currentWorkspaceAtom, currentWorkspaceLoadingAtom } from '@/context/workspace-state'
import { deploymentEditionAtom } from '@/features/system-features/state'

export const canReadNetworkAccessAtom = atom((get) => {
  if (get(currentWorkspaceLoadingAtom) || get(deploymentEditionAtom) !== 'CLOUD') return false
  const { id, role } = get(currentWorkspaceAtom)
  return Boolean(id) && (role === 'owner' || role === 'admin' || role === 'editor')
})

export const canManageNetworkAccessPoliciesAtom = atom((get) => {
  if (!get(canReadNetworkAccessAtom)) return false
  const { role } = get(currentWorkspaceAtom)
  return role === 'owner' || role === 'admin'
})
