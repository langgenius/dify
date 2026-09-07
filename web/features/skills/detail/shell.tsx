'use client'

import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { SkillBuilderGridTexture } from './builder-grid-texture'

export function DetailSkeleton() {
  return (
    <div aria-busy="true" className="flex h-0 min-w-0 grow overflow-hidden bg-background-body">
      <aside aria-hidden className="flex h-full w-62 shrink-0 bg-background-body p-1">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-components-panel-bg">
          <div className="flex h-12 shrink-0 items-center gap-1 px-2">
            <SkeletonRectangle className="my-0 size-6 rounded-md opacity-12" />
            <SkeletonRectangle className="my-0 h-3 w-16 rounded-md opacity-20" />
            <div className="ml-auto flex gap-1">
              <SkeletonRectangle className="my-0 size-6 rounded-md opacity-12" />
              <SkeletonRectangle className="my-0 size-6 rounded-md opacity-12" />
            </div>
          </div>
          <div className="flex items-start gap-2 p-3">
            <SkeletonRectangle className="my-0 size-10 shrink-0 rounded-[10px] opacity-20" />
            <div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
              <SkeletonRectangle className="my-0 h-3 w-32 max-w-full rounded-md opacity-20" />
              <SkeletonRectangle className="my-0 h-2 w-24 max-w-full rounded-md opacity-12" />
            </div>
          </div>
          <div className="mx-3 h-px bg-divider-subtle" />
          <div className="flex h-12 shrink-0 items-center justify-between px-3">
            <SkeletonRectangle className="my-0 h-2 w-16 rounded-md opacity-12" />
            <SkeletonRectangle className="my-0 size-6 rounded-md opacity-12" />
          </div>
          <div className="flex flex-col gap-1 px-2">
            <SkeletonRectangle className="my-0 h-8 w-full rounded-lg opacity-20" />
            <SkeletonRectangle className="my-0 h-7 w-4/5 rounded-lg opacity-12" />
            <SkeletonRectangle className="my-0 h-7 w-3/5 rounded-lg opacity-12" />
          </div>
          <div className="mt-auto flex flex-col gap-3 border-t border-divider-subtle p-3">
            <SkeletonRectangle className="my-0 h-2 w-32 max-w-full rounded-md opacity-12" />
            <SkeletonRectangle className="my-0 h-8 w-full rounded-lg opacity-12" />
          </div>
        </div>
      </aside>

      <main
        aria-hidden
        className="my-1 mr-1 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-background-default inset-ring-[0.5px] inset-ring-divider-subtle"
      >
        <div className="flex h-11 shrink-0 items-center border-b-[0.5px] border-divider-subtle bg-components-panel-bg-alt px-3">
          <SkeletonRectangle className="my-0 h-3 w-20 rounded-md opacity-20" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden px-12 py-8">
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            <div className="flex flex-col gap-2">
              <SkeletonRectangle className="my-0 h-2 w-12 rounded-md opacity-12" />
              <SkeletonRectangle className="my-0 h-3 w-44 rounded-md opacity-20" />
            </div>
            <div className="flex flex-col gap-2">
              <SkeletonRectangle className="my-0 h-2 w-20 rounded-md opacity-12" />
              <SkeletonRectangle className="my-0 h-3 w-3/4 rounded-md opacity-20" />
              <SkeletonRectangle className="my-0 h-3 w-1/2 rounded-md opacity-12" />
            </div>
            <SkeletonRectangle className="my-0 h-8 w-28 rounded-lg opacity-12" />
            <div className="h-px bg-divider-subtle" />
            <SkeletonRectangle className="my-0 h-4 w-36 rounded-md opacity-20" />
            <div className="flex flex-col gap-3 pt-3">
              <SkeletonRectangle className="my-0 h-3 w-full rounded-md opacity-12" />
              <SkeletonRectangle className="my-0 h-3 w-11/12 rounded-md opacity-12" />
              <SkeletonRectangle className="my-0 h-3 w-4/5 rounded-md opacity-12" />
            </div>
          </div>
        </div>
      </main>

      <aside
        aria-hidden
        className="relative my-1 mr-1 flex w-99 shrink-0 flex-col overflow-hidden rounded-lg inset-ring-[0.5px] inset-ring-divider-subtle"
      >
        <div className="pointer-events-none absolute inset-0 z-0 bg-linear-to-b from-background-gradient-bg-fill-chat-bg-1 to-background-gradient-bg-fill-chat-bg-2" />
        <SkillBuilderGridTexture className="pointer-events-none absolute top-0 left-0 z-2" />
        <SkillBuilderGridTexture className="pointer-events-none absolute bottom-0 left-0 z-1 origin-center scale-y-[-1]" />
        <div className="relative z-10 flex h-12 shrink-0 items-center justify-between px-4">
          <SkeletonRectangle className="my-0 h-3 w-24 rounded-md opacity-20" />
          <div className="flex gap-2">
            <SkeletonRectangle className="my-0 size-6 rounded-md opacity-12" />
            <SkeletonRectangle className="my-0 size-6 rounded-md opacity-12" />
          </div>
        </div>
        <div className="relative z-10 flex min-h-0 flex-1 flex-col px-4 pb-4">
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <SkeletonRectangle className="my-0 size-12 rounded-2xl opacity-20" />
            <SkeletonRectangle className="my-0 h-3 w-52 max-w-full rounded-md opacity-20" />
            <SkeletonRectangle className="my-0 h-2 w-64 max-w-full rounded-md opacity-12" />
            <SkeletonRectangle className="my-0 h-2 w-44 max-w-full rounded-md opacity-12" />
          </div>
          <div className="rounded-xl bg-background-default p-3 shadow-xs">
            <SkeletonRectangle className="my-0 h-3 w-32 rounded-md opacity-12" />
            <div className="mt-8 flex items-center gap-2">
              <SkeletonRectangle className="my-0 h-8 flex-1 rounded-lg opacity-12" />
              <SkeletonRectangle className="my-0 size-8 rounded-lg opacity-20" />
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}
