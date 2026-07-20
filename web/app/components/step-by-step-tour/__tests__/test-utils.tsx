import type { ReactNode } from 'react'
import type { StepByStepTourSessionState, StepByStepTourTaskId } from '../types'
import { useAtomValue } from 'jotai'
import { useHydrateAtoms } from 'jotai/utils'
import { useEffect } from 'react'
import {
  activeStepByStepTourGuideGroupAtom,
  activeStepByStepTourGuideIndexAtom,
  activeStepByStepTourGuideIndexesAtom,
  activeStepByStepTourTaskIdAtom,
  completedStepByStepTourTaskIdsAtom,
  manuallyDisabledStepByStepTourWorkspaceIdsAtom,
  manuallyEnabledStepByStepTourWorkspaceIdsAtom,
  stepByStepTourFirstWorkspaceIdAtom,
  stepByStepTourSessionAtom,
  stepByStepTourSkippedAtom,
} from '../state'
import { useStepByStepTourShellModeValue } from '../storage'

export type StepByStepTourTestState = StepByStepTourSessionState & {
  completedTaskIds: StepByStepTourTaskId[]
  firstWorkspaceId?: string
  manuallyDisabledWorkspaceIds: string[]
  manuallyEnabledWorkspaceIds: string[]
  minimized: boolean
  skipped: boolean
  updatedAt?: string | null
}

type StepByStepTourTestStateObserverProps = {
  onChange: (state: StepByStepTourTestState) => void
}

export function StepByStepTourTestStateObserver({
  onChange,
}: StepByStepTourTestStateObserverProps) {
  const activeTaskId = useAtomValue(activeStepByStepTourTaskIdAtom)
  const activeGuideIndex = useAtomValue(activeStepByStepTourGuideIndexAtom)
  const activeGuideGroup = useAtomValue(activeStepByStepTourGuideGroupAtom)
  const activeGuideIndexes = useAtomValue(activeStepByStepTourGuideIndexesAtom)
  const completedTaskIds = useAtomValue(completedStepByStepTourTaskIdsAtom)
  const firstWorkspaceId = useAtomValue(stepByStepTourFirstWorkspaceIdAtom)
  const manuallyDisabledWorkspaceIds = useAtomValue(manuallyDisabledStepByStepTourWorkspaceIdsAtom)
  const manuallyEnabledWorkspaceIds = useAtomValue(manuallyEnabledStepByStepTourWorkspaceIdsAtom)
  const skipped = useAtomValue(stepByStepTourSkippedAtom)
  const shellMode = useStepByStepTourShellModeValue()

  useEffect(() => {
    onChange({
      activeTaskId,
      activeGuideIndex,
      activeGuideGroup,
      activeGuideIndexes,
      completedTaskIds,
      firstWorkspaceId,
      manuallyDisabledWorkspaceIds,
      manuallyEnabledWorkspaceIds,
      minimized: Boolean(activeTaskId) || shellMode === 'collapsed',
      skipped,
      updatedAt: null,
    })
  }, [
    activeGuideGroup,
    activeGuideIndex,
    activeGuideIndexes,
    activeTaskId,
    completedTaskIds,
    firstWorkspaceId,
    manuallyDisabledWorkspaceIds,
    manuallyEnabledWorkspaceIds,
    onChange,
    shellMode,
    skipped,
  ])

  return null
}

type StepByStepTourTestUiStateHydratorProps = {
  children: ReactNode
  initialState: StepByStepTourSessionState
}

export function StepByStepTourTestUiStateHydrator({
  children,
  initialState,
}: StepByStepTourTestUiStateHydratorProps) {
  useHydrateAtoms([[stepByStepTourSessionAtom, initialState]], {
    dangerouslyForceHydrate: true,
  })

  return children
}
