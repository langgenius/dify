'use client'

import type { Release } from '@dify/contracts/enterprise/types.gen'
import { skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { atomWithLazy } from 'jotai/utils'
import { consoleQuery } from '@/service/client'
import { deploymentRouteAppInstanceIdAtom } from '../../../route-state'

export type ReleaseActionItem = {
  releaseId: string
  releaseRows: Release[]
}

export const releaseActionItemAtom = atomWithLazy<ReleaseActionItem>(() => {
  throw new Error('Missing release action item.')
})

export const deployReleaseMenuOpenAtom = atom(false)
export const editReleaseDialogOpenAtom = atom(false)
export const deleteReleaseDialogOpenAtom = atom(false)

export const deployReleaseMenuEnvironmentDeploymentsQueryAtom = atomWithQuery((get) => {
  const appInstanceId = get(deploymentRouteAppInstanceIdAtom)
  const menuOpen = get(deployReleaseMenuOpenAtom)

  return consoleQuery.enterprise.deploymentService.listEnvironmentDeployments.queryOptions({
    input: appInstanceId
      ? {
          params: { appInstanceId },
        }
      : skipToken,
    enabled: Boolean(appInstanceId && menuOpen),
  })
})

export const deployReleaseMenuAppInstanceQueryAtom = atomWithQuery((get) => {
  const appInstanceId = get(deploymentRouteAppInstanceIdAtom)
  const menuOpen = get(deployReleaseMenuOpenAtom)

  return consoleQuery.enterprise.appInstanceService.getAppInstance.queryOptions({
    input: appInstanceId
      ? {
          params: { appInstanceId },
        }
      : skipToken,
    enabled: Boolean(appInstanceId && menuOpen),
  })
})

export const openEditReleaseDialogAtom = atom(null, (_get, set) => {
  set(deployReleaseMenuOpenAtom, false)
  set(deleteReleaseDialogOpenAtom, false)
  set(editReleaseDialogOpenAtom, true)
})

export const openDeleteReleaseDialogAtom = atom(null, (_get, set) => {
  set(deployReleaseMenuOpenAtom, false)
  set(editReleaseDialogOpenAtom, false)
  set(deleteReleaseDialogOpenAtom, true)
})

export const releaseActionLocalAtoms = [
  deployReleaseMenuOpenAtom,
  editReleaseDialogOpenAtom,
  deleteReleaseDialogOpenAtom,
] as const
