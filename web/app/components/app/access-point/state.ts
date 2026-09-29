'use client'

import type { ReactNode } from 'react'
import { skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { selectAtom, useHydrateAtoms } from 'jotai/utils'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { consoleQuery } from '@/service/console'
import { AppModeEnum } from '@/types/app'
import { getAppACLCapabilities } from '@/utils/permission'

export const BUILT_IN_ENVIRONMENT_ID = 'built-in'

const accessPointAppIdAtom = atom<string | null>(null)
const appDetailQueryAtom = atomWithQuery((get) => {
  const appId = get(accessPointAppIdAtom)
  return consoleQuery.apps.byAppId.get.queryOptions({
    input: appId ? { params: { app_id: appId } } : skipToken,
  })
})

export const accessPointAppDetailAtom = selectAtom(appDetailQueryAtom, (query) => query.data)
const accountProfileQueryAtom = atomWithQuery(() => userProfileQueryOptions())

export const accessPointCapabilitiesAtom = atom((get) => {
  const appDetail = get(accessPointAppDetailAtom)
  return getAppACLCapabilities(appDetail?.permission_keys, {
    currentUserId: get(accountProfileQueryAtom).data?.profile.id,
    resourceMaintainer: appDetail?.maintainer,
    workspacePermissionKeys: get(workspacePermissionKeysAtom),
  })
})

export const accessPointEnvironmentQueryEnabledAtom = atom((get) => {
  const appDetail = get(accessPointAppDetailAtom)
  return (
    (appDetail?.mode === AppModeEnum.WORKFLOW || appDetail?.mode === AppModeEnum.ADVANCED_CHAT) &&
    get(accessPointCapabilitiesAtom).canViewAccessPoint
  )
})

export function AccessPointStateBoundary({
  appId,
  children,
}: {
  appId: string
  children: ReactNode
}) {
  useHydrateAtoms([[accessPointAppIdAtom, appId]] as const, {
    dangerouslyForceHydrate: true,
  })

  return children
}

const appEnvironmentsQueryAtom = atomWithQuery((get) => {
  const appId = get(accessPointAppIdAtom)
  const enabled = get(accessPointEnvironmentQueryEnabledAtom)

  return consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryOptions({
    input: appId
      ? {
          params: {
            app_id: appId,
          },
        }
      : skipToken,
    enabled,
  })
})

const appEnvironmentsAtom = selectAtom(appEnvironmentsQueryAtom, (query) => query.data?.data)

export const inUseAppEnvironmentsAtom = atom(
  (get) =>
    get(appEnvironmentsAtom)?.filter(
      (environment) => environment.in_use && environment.id !== BUILT_IN_ENVIRONMENT_ID,
    ) ?? [],
)
