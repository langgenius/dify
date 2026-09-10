'use client'

import type { RecommendedAppResponse } from '@dify/contracts/api/console/explore/types.gen'
import { useSuspenseQuery } from '@tanstack/react-query'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import dynamic from '@/next/dynamic'
import { consoleQuery } from '@/service/console'
import { ContinueWork } from '../continue-work/continue-work'

const LearnDify = dynamic(() => import('@/app/components/explore/learn-dify'), { ssr: false })

export function HomeRecommendations({
  canCreate,
  forceShowLearnDify,
  onCreate,
  onTry,
}: {
  canCreate: boolean
  forceShowLearnDify?: boolean
  onCreate: (app: RecommendedAppResponse) => void
  onTry: (app: RecommendedAppResponse) => void
}) {
  const { data: recentApps } = useSuspenseQuery({
    ...consoleQuery.apps.recent.get.queryOptions({
      input: { query: { limit: 8 } },
    }),
  })

  return (
    <>
      <ContinueWork apps={recentApps.data} />
      <LearnDify
        canCreate={canCreate}
        className="pb-0"
        forceVisible={forceShowLearnDify}
        onCreate={onCreate}
        onTry={({ app }) => onTry(app)}
        stepByStepTourTarget={STEP_BY_STEP_TOUR_TARGETS.home}
      />
    </>
  )
}
