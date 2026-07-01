import { atom, useAtomValue, useSetAtom } from 'jotai'

const stepByStepTourSkipRecoveryVisibleAtom = atom(false)

export const useStepByStepTourSkipRecoveryVisible = () =>
  useAtomValue(stepByStepTourSkipRecoveryVisibleAtom)

export const useSetStepByStepTourSkipRecoveryVisible = () =>
  useSetAtom(stepByStepTourSkipRecoveryVisibleAtom)
