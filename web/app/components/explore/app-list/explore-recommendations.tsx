'use client'

import type { App } from '@/models/explore'
import type { App as WorkspaceApp } from '@/types/app'
import type { TryAppSelection } from '@/types/try-app'
import ContinueWork from '@/app/components/explore/continue-work'
import dynamic from '@/next/dynamic'

const LearnDify = dynamic(() => import('@/app/components/explore/learn-dify'), { ssr: false })

export function ExploreRecommendations({
  canCreate,
  continueWorkApps,
  onCreate,
  onTry,
}: {
  canCreate: boolean
  continueWorkApps: WorkspaceApp[]
  onCreate: (app: App) => void
  onTry: (params: TryAppSelection) => void
}) {
  return (
    <>
      <ContinueWork apps={continueWorkApps} />
      <LearnDify
        canCreate={canCreate}
        className="pb-0"
        onCreate={onCreate}
        onTry={onTry}
      />
    </>
  )
}
