'use client'

import { useSetAtom } from 'jotai'
import { useHydrateAtoms } from 'jotai/react/utils'
import { useEffect } from 'react'
import { useParams } from '@/next/navigation'
import {
  deploymentRouteAppInstanceIdAtom,
  deploymentsRouteActiveAtom,
} from './route-state'

function routeAppInstanceId(params?: { appInstanceId?: string | string[] }) {
  return typeof params?.appInstanceId === 'string' ? params.appInstanceId : undefined
}

export function DeploymentsRouteStateHydrator() {
  const params = useParams<{ appInstanceId?: string | string[] }>()
  const appInstanceId = routeAppInstanceId(params)
  const setDeploymentsRouteActive = useSetAtom(deploymentsRouteActiveAtom)
  const setRouteAppInstanceId = useSetAtom(deploymentRouteAppInstanceIdAtom)

  useHydrateAtoms([
    [deploymentsRouteActiveAtom, true],
    [deploymentRouteAppInstanceIdAtom, appInstanceId],
  ] as const, { dangerouslyForceHydrate: true })

  useEffect(() => {
    return () => {
      setDeploymentsRouteActive(false)
      setRouteAppInstanceId(undefined)
    }
  }, [setDeploymentsRouteActive, setRouteAppInstanceId])

  return null
}
