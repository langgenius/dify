'use client'

import { useSyncExternalStore } from 'react'
import { getIsAmplitudeInitialized, subscribeAmplitudeInitialization } from './init-state'

const getServerAmplitudeInitialized = () => false

export function useAmplitudeInitialized() {
  return useSyncExternalStore(
    subscribeAmplitudeInitialization,
    getIsAmplitudeInitialized,
    getServerAmplitudeInitialized,
  )
}
