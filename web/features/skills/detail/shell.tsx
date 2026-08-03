'use client'

import { SkeletonRectangle } from '@/app/components/base/skeleton'

export function DetailSkeleton() {
  return (
    <div className="flex h-0 min-w-0 grow flex-col overflow-hidden bg-background-body">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-divider-subtle px-6">
        <SkeletonRectangle className="my-0 size-10 rounded-[10px] opacity-20" />
        <div className="flex flex-col gap-2">
          <SkeletonRectangle className="my-0 h-3 w-40 rounded-md opacity-20" />
          <SkeletonRectangle className="my-0 h-2 w-28 rounded-md opacity-12" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <SkeletonRectangle className="my-0 h-full w-64 rounded-none opacity-10" />
        <SkeletonRectangle className="my-4 ml-4 h-[calc(100%-2rem)] flex-1 rounded-lg opacity-10" />
        <SkeletonRectangle className="my-0 h-full w-[420px] rounded-none opacity-10" />
      </div>
    </div>
  )
}
