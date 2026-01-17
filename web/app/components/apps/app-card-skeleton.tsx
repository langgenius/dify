'use client'

import * as React from 'react'
import { SkeletonContainer, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'

type AppCardSkeletonProps = {
  count?: number
}

/**
 * Skeleton placeholder for App cards during loading states.
 * Matches the visual layout of AppCard component.
 */
export const AppCardSkeleton = React.memo(({ count = 6 }: AppCardSkeletonProps) => {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="h-[160px] rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg p-4"
        >
          <SkeletonContainer className="h-full">
            <SkeletonRow>
              <SkeletonRectangle className="h-10 w-10 animate-pulse rounded-lg" />
              <div className="flex flex-1 flex-col gap-1">
                <SkeletonRectangle className="h-4 w-2/3 animate-pulse" />
                <SkeletonRectangle className="h-3 w-1/3 animate-pulse" />
              </div>
            </SkeletonRow>
            <div className="mt-4 flex flex-col gap-2">
              <SkeletonRectangle className="h-3 w-full animate-pulse" />
              <SkeletonRectangle className="h-3 w-4/5 animate-pulse" />
            </div>
          </SkeletonContainer>
        </div>
      ))}
    </>
  )
})

AppCardSkeleton.displayName = 'AppCardSkeleton'
