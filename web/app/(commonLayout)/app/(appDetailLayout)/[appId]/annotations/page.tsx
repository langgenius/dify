import { Suspense } from 'react'
import Main from '@/app/components/app/log-annotation'
import { PageType } from '@/app/components/base/features/new-feature-panel/annotation-reply/type'
import { SkeletonContainer, SkeletonRectangle } from '@/app/components/base/skeleton'

export default async function Page({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params
  return (
    <Suspense
      fallback={
        <SkeletonContainer className="gap-4 p-6" aria-busy="true">
          <SkeletonRectangle className="h-6 w-48" />
          <SkeletonRectangle className="h-10 w-full" />
          <SkeletonRectangle className="h-96 w-full" />
        </SkeletonContainer>
      }
    >
      <Main appId={appId} pageType={PageType.annotation} />
    </Suspense>
  )
}
