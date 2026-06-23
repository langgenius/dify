'use client'

import { atom } from 'jotai'
import {
  nextParamsAtom,
  nextPathnameAtom,
} from '@/app/components/next-route-state/atoms'

function isDeploymentsRoute(pathname: string) {
  return pathname === '/deployments' || pathname.startsWith('/deployments/')
}

export const deploymentsRouteActiveAtom = atom(get => isDeploymentsRoute(get(nextPathnameAtom)))

export const deploymentRouteAppInstanceIdAtom = atom((get) => {
  const appInstanceId = get(nextParamsAtom).appInstanceId

  return typeof appInstanceId === 'string' ? appInstanceId : undefined
})
