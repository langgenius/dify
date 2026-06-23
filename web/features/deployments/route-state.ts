'use client'

import { atom } from 'jotai'

export const deploymentsRouteActiveAtom = atom(false)
export const deploymentRouteAppInstanceIdAtom = atom<string | undefined>(undefined)
