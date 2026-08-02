import { Suspense } from 'react'
import { HomeAppListContent } from '@/app/components/explore/app-list'
import {
  MiddleSkeleton,
  TemplatesSkeleton,
} from '@/app/components/explore/app-list/loading-skeletons'
import { HomeBanner } from '@/app/components/explore/banner/home-banner'
import { BannerSkeleton } from '@/app/components/explore/banner/skeleton'
import { HomeHydrationBoundary } from './home-hydration-boundary'
import { HomeTitle } from './home-title'

export default function Home() {
  return (
    <>
      <HomeTitle />
      <div className="flex h-full min-h-0 flex-col overflow-hidden border-l-[0.5px] border-divider-regular">
        <div className="flex flex-1 flex-col overflow-y-auto">
          <Suspense fallback={<BannerSkeleton />}>
            <HomeBanner />
          </Suspense>
          <Suspense
            fallback={
              <>
                <MiddleSkeleton />
                <TemplatesSkeleton />
              </>
            }
          >
            <HomeHydrationBoundary>
              <HomeAppListContent />
            </HomeHydrationBoundary>
          </Suspense>
        </div>
      </div>
    </>
  )
}
