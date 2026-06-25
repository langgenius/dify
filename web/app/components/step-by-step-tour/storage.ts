'use client'

import type { StepByStepTourAccountState } from './types'
import { createLocalStorageState } from 'foxact/create-local-storage-state'
import {
  createDefaultStepByStepTourAccountState,
  STEP_BY_STEP_TOUR_STORAGE_KEY,
} from './constants'

const [
  _useStepByStepTourAccountState,
  useStepByStepTourAccountStateValue,
  useSetStepByStepTourAccountState,
] = createLocalStorageState<StepByStepTourAccountState>(
  STEP_BY_STEP_TOUR_STORAGE_KEY,
  createDefaultStepByStepTourAccountState(),
)

export {
  useSetStepByStepTourAccountState,
  useStepByStepTourAccountStateValue,
}
