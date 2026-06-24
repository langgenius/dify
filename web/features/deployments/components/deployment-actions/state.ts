'use client'

import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { atomWithLazy } from 'jotai/utils'
import { consoleQuery } from '@/service/client'

export const deploymentActionAppInstanceIdAtom = atomWithLazy<string>(() => {
  throw new Error('Missing deployment action app instance id.')
})

export const editDeploymentDialogOpenAtom = atom(false)
export const deleteDeploymentDialogOpenAtom = atom(false)

export const deploymentActionAppInstanceQueryOptionsAtom = atom((get) => {
  const appInstanceId = get(deploymentActionAppInstanceIdAtom)

  return consoleQuery.enterprise.appInstanceService.getAppInstance.queryOptions({
    input: {
      params: { appInstanceId },
    },
  })
})

export const deploymentActionAppInstanceQueryAtom = atomWithQuery((get) => {
  return get(deploymentActionAppInstanceQueryOptionsAtom)
})

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
