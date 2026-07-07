'use client'

import { SkeletonContainer, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'

const DEPLOY_FORM_FIELD_SKELETON_KEYS = ['environment', 'release']

export function DeployFormSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-divider-subtle px-6 py-5 pr-14">
        <SkeletonContainer className="gap-2">
          <SkeletonRectangle className="h-5 w-44 animate-pulse" />
          <SkeletonRectangle className="h-3 w-72 animate-pulse" />
        </SkeletonContainer>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="flex flex-col gap-5">
          {DEPLOY_FORM_FIELD_SKELETON_KEYS.map(key => (
            <SkeletonContainer key={key} className="gap-2">
              <SkeletonRectangle className="h-3 w-24 animate-pulse" />
              <SkeletonRectangle className="my-0 h-9 w-full animate-pulse rounded-lg" />
            </SkeletonContainer>
          ))}

          <div className="rounded-xl border border-divider-subtle bg-background-default-subtle px-3 py-4">
            <SkeletonContainer className="gap-2">
              <SkeletonRectangle className="h-3 w-32 animate-pulse" />
              <SkeletonRectangle className="h-3 w-2/3 animate-pulse" />
              <SkeletonRectangle className="my-0 h-8 w-full animate-pulse rounded-lg" />
            </SkeletonContainer>
          </div>
        </div>
      </div>

      <SkeletonRow className="shrink-0 justify-end border-t border-divider-subtle bg-background-default-subtle px-6 py-4">
        <SkeletonRectangle className="my-0 h-8 w-18 animate-pulse rounded-lg" />
        <SkeletonRectangle className="my-0 h-8 w-22 animate-pulse rounded-lg" />
      </SkeletonRow>
    </div>
  )
}
