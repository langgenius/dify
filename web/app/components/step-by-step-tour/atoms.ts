import type { StepByStepTourUiState } from './types'
import { atom, useAtomValue, useSetAtom } from 'jotai'
import { createDefaultStepByStepTourUiState } from './constants'

export const stepByStepTourUiStateAtom = atom<StepByStepTourUiState>(
  createDefaultStepByStepTourUiState(),
)
const stepByStepTourSkipRecoveryVisibleAtom = atom(false)

export const useStepByStepTourUiStateValue = () => useAtomValue(stepByStepTourUiStateAtom)

export const useSetStepByStepTourUiState = () => useSetAtom(stepByStepTourUiStateAtom)

export const useStepByStepTourSkipRecoveryVisible = () =>
  useAtomValue(stepByStepTourSkipRecoveryVisibleAtom)

export const useSetStepByStepTourSkipRecoveryVisible = () =>
  useSetAtom(stepByStepTourSkipRecoveryVisibleAtom)
