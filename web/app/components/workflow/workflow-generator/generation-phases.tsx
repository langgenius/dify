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

type Props = Readonly<{
  /**
   * Per-attempt nonce — typically ``Date.now()`` of when Generate was
   * clicked. The component resets ``phaseIndex`` whenever this changes so a
   * second Generate click starts the indicator from "Planning…" instead of
   * resuming wherever the previous attempt left off.
   */
  startedAt: number
}>

const GenerationPhases = ({ startedAt }: Props) => {
  const { t } = useTranslation('workflow')
  const [phaseIndex, setPhaseIndex] = useState(0)

  // Reset the indicator whenever a new attempt starts. Without this, a
  // failed first attempt followed by a quick retry would resume mid-phase
  // (or stuck on "Validating…") which looks like the system is wedged.
  // ``set-state-in-effect`` flags this pattern, but the reset is the
  // intent — driven by an external prop change, not by render-time state.
  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    setPhaseIndex(0)
  }, [startedAt])

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
