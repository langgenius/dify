'use client'

import { atom } from 'jotai'
import {
  nextParamsAtom,
} from '@/app/components/next-route-state/atoms'

export const deploymentRouteAppInstanceIdAtom = atom((get) => {
  const appInstanceId = get(nextParamsAtom).appInstanceId

  return typeof appInstanceId === 'string' ? appInstanceId : undefined
})
