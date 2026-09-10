'use client'

import { useSyncExternalStore } from 'react'
import { getIsAmplitudeInitialized, subscribeAmplitudeInitialization } from './init'

const getServerAmplitudeInitialized = () => false

export function useAmplitudeInitialized() {
  return useSyncExternalStore(
    subscribeAmplitudeInitialization,
    getIsAmplitudeInitialized,
    getServerAmplitudeInitialized,
  )
}
