'use client'

import type { App } from '@/models/explore'
import type { TryAppSelection } from '@/types/try-app'
import ContinueWork from '@/app/components/explore/continue-work'
import dynamic from '@/next/dynamic'
import { RecommendationSectionSkeleton } from './loading-skeletons'

const LearnDify = dynamic(() => import('@/app/components/explore/learn-dify'), { ssr: false })

export function ExploreRecommendations({
  canCreate,
  isContinueWorkLoading,
  onCreate,
  onTry,
}: {
  canCreate: boolean
  isContinueWorkLoading: boolean
  onCreate: (app: App) => void
  onTry: (params: TryAppSelection) => void
}) {
  return (
    <>
      {isContinueWorkLoading
        ? <RecommendationSectionSkeleton className="pb-4" />
        : <ContinueWork className="pb-4" />}
      <LearnDify
        canCreate={canCreate}
        className="pb-0"
        loadingFallback={(
          <RecommendationSectionSkeleton
            className="pb-0"
            hasDescription
          />
        )}
        onCreate={onCreate}
        onTry={onTry}
      />
    </>
  )
}
