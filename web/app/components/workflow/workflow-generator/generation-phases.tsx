'use client'
import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'

/**
 * Approximate stage durations (ms) for the slim planner→builder pipeline.
 *
 * The endpoint is single-shot — we don't get real per-phase events from the
 * backend — but the user perception of "the system is doing things" is much
 * better than a static spinner. The schedule below targets the typical
 * 15–18 s response time. If the real response lands earlier the modal
 * unmounts this component; if it lands later we hold on the last phase
 * indefinitely (rather than cycling back) so the user doesn't think we
 * restarted.
 */
const PLANNING_MS = 3500
const BUILDING_MS = 12000

const GenerationPhases = () => {
  const { t } = useTranslation('workflow')
  const [phaseIndex, setPhaseIndex] = useState(0)

  useEffect(() => {
    if (phaseIndex === 0) {
      const timer = setTimeout(() => setPhaseIndex(1), PLANNING_MS)
      return () => clearTimeout(timer)
    }
    if (phaseIndex === 1) {
      const timer = setTimeout(() => setPhaseIndex(2), BUILDING_MS)
      return () => clearTimeout(timer)
    }
    // phaseIndex === 2 — terminal phase, no further timer.
  }, [phaseIndex])

  const label = (() => {
    if (phaseIndex === 0)
      return t('workflowGenerator.phases.planning')
    if (phaseIndex === 1)
      return t('workflowGenerator.phases.building')
    return t('workflowGenerator.phases.validating')
  })()

  return (
    <div className="flex h-full w-0 grow flex-col items-center justify-center space-y-3">
      <Loading />
      <div className="text-[13px] text-text-tertiary">{label}</div>
    </div>
  )
}

export default memo(GenerationPhases)
