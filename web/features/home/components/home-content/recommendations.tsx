'use client'

import type { RecentAppResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { RecommendedAppResponse } from '@dify/contracts/api/console/explore/types.gen'
import type { TryAppSelection } from '@/types/try-app'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import dynamic from '@/next/dynamic'
import { ContinueWork } from '../continue-work/continue-work'

const LearnDify = dynamic(() => import('@/app/components/explore/learn-dify'), { ssr: false })

export function HomeRecommendations({
  canCreate,
  continueWorkApps,
  forceShowLearnDify,
  onCreate,
  onTry,
}: {
  canCreate: boolean
  continueWorkApps: RecentAppResponse[]
  forceShowLearnDify?: boolean
  onCreate: (app: RecommendedAppResponse) => void
  onTry: (params: TryAppSelection) => void
}) {
  return (
    <>
      <ContinueWork apps={continueWorkApps} />
      <LearnDify
        canCreate={canCreate}
        className="pb-0"
        forceVisible={forceShowLearnDify}
        onCreate={onCreate}
        onTry={onTry}
        stepByStepTourTarget={STEP_BY_STEP_TOUR_TARGETS.home}
      />
    </>
  )
}
