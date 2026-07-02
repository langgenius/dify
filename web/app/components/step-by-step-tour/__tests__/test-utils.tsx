import type { ReactNode } from 'react'
import type { StepByStepTourAccountState, StepByStepTourUiState } from '../types'
import { useHydrateAtoms } from 'jotai/utils'
import { useEffect } from 'react'
import { stepByStepTourUiStateAtom } from '../atoms'
import {
  useStepByStepTourAccountStateValue,
} from '../storage'

type StepByStepTourTestStateObserverProps = {
  onChange: (state: StepByStepTourAccountState) => void
}

export function StepByStepTourTestStateObserver({
  onChange,
}: StepByStepTourTestStateObserverProps) {
  // eslint-disable-next-line react/use-state -- Step-by-step tour storage hooks are not React useState calls.
  const state = useStepByStepTourAccountStateValue()

  useEffect(() => {
    onChange(state)
  }, [onChange, state])

  return null
}

type StepByStepTourTestUiStateHydratorProps = {
  children: ReactNode
  initialState: StepByStepTourUiState
}

export function StepByStepTourTestUiStateHydrator({
  children,
  initialState,
}: StepByStepTourTestUiStateHydratorProps) {
  useHydrateAtoms([[stepByStepTourUiStateAtom, initialState]], {
    dangerouslyForceHydrate: true,
  })

  return children
}
