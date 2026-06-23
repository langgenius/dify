'use client'

import { skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { consoleQuery } from '@/service/client'

export type DeploymentActionDialogType = 'edit' | 'delete'

export const deploymentActionDialogAtom = atom<{
  appInstanceId: string
  type: DeploymentActionDialogType
} | undefined>(undefined)

export const editDeploymentInstanceQueryAtom = atomWithQuery((get) => {
  const actionDialog = get(deploymentActionDialogAtom)
  const appInstanceId = actionDialog?.type === 'edit' ? actionDialog.appInstanceId : undefined

  return consoleQuery.enterprise.appInstanceService.getAppInstance.queryOptions({
    input: appInstanceId
      ? {
          params: { appInstanceId },
        }
      : skipToken,
    enabled: Boolean(appInstanceId),
  })
})

export const setDeploymentActionDialogOpenAtom = atom(null, (get, set, {
  appInstanceId,
  type,
  open,
}: {
  appInstanceId: string
  type: DeploymentActionDialogType
  open: boolean
}) => {
  if (open) {
    set(deploymentActionDialogAtom, { appInstanceId, type })
    return
  }

  const currentDialog = get(deploymentActionDialogAtom)
  if (currentDialog?.appInstanceId === appInstanceId && currentDialog.type === type)
    set(deploymentActionDialogAtom, undefined)
})

export const openDeploymentActionDialogAtom = atom(null, (_get, set, {
  appInstanceId,
  type,
}: {
  appInstanceId: string
  type: DeploymentActionDialogType
}) => {
  set(deploymentActionDialogAtom, { appInstanceId, type })
})

export const deploymentActionsLocalAtoms = [
  deploymentActionDialogAtom,
] as const
