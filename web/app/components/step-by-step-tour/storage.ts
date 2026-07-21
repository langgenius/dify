'use client'

import { createLocalStorageState } from 'foxact/create-local-storage-state'

type StepByStepTourShellMode = 'expanded' | 'collapsed'

export const STEP_BY_STEP_TOUR_SHELL_MODE_STORAGE_KEY = 'step-by-step-tour-shell-mode'

const [
  _useStepByStepTourShellMode,
  useStepByStepTourShellModeValue,
  useSetStepByStepTourShellMode,
] = createLocalStorageState<StepByStepTourShellMode>(
  STEP_BY_STEP_TOUR_SHELL_MODE_STORAGE_KEY,
  'expanded',
  { raw: true },
)

export { useSetStepByStepTourShellMode, useStepByStepTourShellModeValue }
