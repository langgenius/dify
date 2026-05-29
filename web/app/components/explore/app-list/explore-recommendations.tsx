'use client'

import type { App } from '@/models/explore'
import type { TryAppSelection } from '@/types/try-app'
import ContinueWork from '@/app/components/explore/continue-work'
import LearnDify from '@/app/components/explore/learn-dify'
import { RecommendationSectionSkeleton } from './loading-skeletons'

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
        ? <RecommendationSectionSkeleton className="mt-10" />
        : <ContinueWork className="mt-10" />}
      <LearnDify
        canCreate={canCreate}
        className="mt-4"
        loadingFallback={(
          <RecommendationSectionSkeleton
            className={isContinueWorkLoading ? 'mt-4' : 'mt-10'}
            hasDescription
          />
        )}
        onCreate={onCreate}
        onTry={onTry}
      />
    </>
  )
}
