import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect } from 'react'
import {
  activeStepByStepTourGuideGroupAtom,
  activeStepByStepTourGuideIndexAtom,
  activeStepByStepTourTaskIdAtom,
  resolveStepByStepTourGuideGroupAtom,
} from '@/app/components/step-by-step-tour/state'
import {
  getStepByStepTourGuides,
  STEP_BY_STEP_TOUR_TARGETS,
} from '@/app/components/step-by-step-tour/target-registry'

type UseAppListTourOptions = {
  canCreateApp: boolean
  hasAnyApp: boolean
  hasResolvedFirstPage: boolean
  hasStarredApps: boolean
  showFirstEmptyState: boolean
  showNoCreateEmptyState: boolean
}

export function useAppListTour({
  canCreateApp,
  hasAnyApp,
  hasResolvedFirstPage,
  hasStarredApps,
  showFirstEmptyState,
  showNoCreateEmptyState,
}: UseAppListTourOptions) {
  const activeTaskId = useAtomValue(activeStepByStepTourTaskIdAtom)
  const activeGuideIndex = useAtomValue(activeStepByStepTourGuideIndexAtom)
  const resolvedGuideGroup = useAtomValue(activeStepByStepTourGuideGroupAtom)
  const resolveGuideGroup = useSetAtom(resolveStepByStepTourGuideGroupAtom)
  const derivedGuideGroup = canCreateApp
    ? showFirstEmptyState
      ? 'studioEmpty'
      : hasAnyApp
        ? 'studioWithApps'
        : undefined
    : hasAnyApp
      ? 'studioNoCreateWithApps'
      : showNoCreateEmptyState
        ? 'studioNoCreateEmpty'
        : undefined
  const effectiveGuideGroup = resolvedGuideGroup ?? derivedGuideGroup
  const guides =
    activeTaskId === 'studio' && effectiveGuideGroup
      ? getStepByStepTourGuides('studio', effectiveGuideGroup)
      : []
  const activeGuide = guides[activeGuideIndex ?? 0]
  const shouldOpenFirstAppActionMenu =
    activeGuide?.target === STEP_BY_STEP_TOUR_TARGETS.studioWithAppsFirstAppCard
  const shouldHighlightNoCreateAppRow =
    activeGuide?.target === STEP_BY_STEP_TOUR_TARGETS.studioNoCreateFirstAppCard
  const shouldHighlightStarredAppRow = shouldHighlightNoCreateAppRow && hasStarredApps

  useEffect(() => {
    if (activeTaskId !== 'studio') return
    if (!hasResolvedFirstPage || !derivedGuideGroup) return
    if (resolvedGuideGroup === derivedGuideGroup) return

    resolveGuideGroup({
      taskId: 'studio',
      guideGroup: derivedGuideGroup,
    })
  }, [activeTaskId, derivedGuideGroup, hasResolvedFirstPage, resolveGuideGroup, resolvedGuideGroup])

  return {
    shouldHighlightAllAppsRow: shouldHighlightNoCreateAppRow && !shouldHighlightStarredAppRow,
    shouldHighlightStarredAppRow,
    shouldOpenFirstAppActionMenu,
  }
}
