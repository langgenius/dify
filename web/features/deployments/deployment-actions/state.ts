'use client'

import type { DeploymentActionAppInstance } from './types'
import { atom } from 'jotai'
import { atomWithLazy } from 'jotai/utils'

export const deploymentActionAppInstanceAtom = atomWithLazy<DeploymentActionAppInstance>(() => {
  throw new Error('Missing deployment action app instance.')
})

export const editDeploymentDialogOpenAtom = atom(false)
export const deleteDeploymentDialogOpenAtom = atom(false)

export const openEditDeploymentDialogAtom = atom(null, (_get, set) => {
  set(deleteDeploymentDialogOpenAtom, false)
  set(editDeploymentDialogOpenAtom, true)
})

export const openDeleteDeploymentDialogAtom = atom(null, (_get, set) => {
  set(editDeploymentDialogOpenAtom, false)
  set(deleteDeploymentDialogOpenAtom, true)
})

export const deploymentActionsLocalAtoms = [
  editDeploymentDialogOpenAtom,
  deleteDeploymentDialogOpenAtom,
] as const
