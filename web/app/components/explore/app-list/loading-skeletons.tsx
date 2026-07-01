'use client'

import { useTranslation } from 'react-i18next'
import { SkeletonContainer, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'

function ExploreAppCardSkeleton() {
  return (
    <div className="col-span-1 flex h-[142px] flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg pb-3 shadow-xs shadow-shadow-shadow-3">
      <div className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2">
        <div className="relative shrink-0">
          <SkeletonRectangle className="size-10 shrink-0 animate-pulse rounded-lg" />
        </div>
        <div className="flex w-0 grow flex-col gap-1 py-px">
          <SkeletonRectangle className="my-0 h-4 w-3/5 animate-pulse" />
          <SkeletonRectangle className="my-0 h-3 w-16 animate-pulse" />
        </div>
      </div>
      <div className="flex shrink-0 items-start px-4 py-1">
        <div className="flex flex-1 flex-col gap-1">
          <SkeletonRectangle className="my-0 h-3 w-full animate-pulse" />
          <SkeletonRectangle className="my-0 h-3 w-4/5 animate-pulse" />
        </div>
      </div>
      <div className="relative flex h-[26px] w-full shrink-0 flex-col gap-2 overflow-hidden px-3">
        <div className="flex w-full shrink-0 items-center gap-1 rounded-lg p-1">
          <SkeletonRectangle className="my-0 h-5 w-20 animate-pulse rounded-[5px]" />
        </div>
      </div>
    </div>
  )
}

function RecommendationSectionSkeletonBody({
  hasDescription = false,
}: {
  hasDescription?: boolean
}) {
  if (hasDescription) {
    return (
      <SkeletonContainer className="-mx-4 rounded-2xl bg-background-section p-4">
        <div className="flex items-start justify-between gap-4 pb-2.5">
          <div className="min-w-0">
            <SkeletonRectangle className="h-5 w-48 animate-pulse" />
            <SkeletonRectangle className="mt-2 h-3 w-80 animate-pulse" />
          </div>
          <SkeletonRectangle className="size-8 shrink-0 animate-pulse rounded-lg" />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(296px,1fr))] gap-2.5">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg px-4 pt-4 pb-4 shadow-xs">
              <div className="flex flex-col items-start gap-2 pb-1">
                <SkeletonRectangle className="size-10 shrink-0 animate-pulse rounded-[10px]" />
                <SkeletonRectangle className="h-4 w-3/4 animate-pulse" />
              </div>
              <div className="flex flex-col gap-1">
                <SkeletonRectangle className="h-3 w-full animate-pulse" />
                <SkeletonRectangle className="h-3 w-4/5 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </SkeletonContainer>
    )
  }

  return (
    <SkeletonContainer>
      <div className="flex min-h-12 items-end justify-between gap-4 pb-2">
        <div className="min-w-0 flex-1">
          <SkeletonRectangle className="h-5 w-48 animate-pulse" />
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(296px,1fr))] gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="rounded-xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-4 py-3 shadow-md">
            <SkeletonRow>
              <SkeletonRectangle className="size-10 shrink-0 animate-pulse rounded-lg" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <SkeletonRectangle className="h-4 w-2/3 animate-pulse" />
                <SkeletonRectangle className="h-3 w-1/2 animate-pulse" />
              </div>
            </SkeletonRow>
          </div>
        ))}
      </div>
    </SkeletonContainer>
  )
}

function ExploreHeaderSkeletonBody() {
  return (
    <div className="sticky top-0 z-10 bg-background-body">
      <div className="flex items-center gap-2 px-8 pt-6">
        <div className="min-w-0 flex-1">
          <SkeletonRectangle className="h-6 w-32 animate-pulse" />
        </div>
        <SkeletonRectangle className="h-4 w-20 shrink-0 animate-pulse" />
      </div>
      <div className="flex items-start justify-between gap-2 px-8 pt-3 pb-3">
        <div className="flex min-w-0 flex-1 gap-1">
          {Array.from({ length: 4 }, (_, index) => (
            <SkeletonRectangle key={index} className="h-8 w-24 animate-pulse rounded-lg" />
          ))}
        </div>
        <SkeletonRectangle className="h-8 w-40 shrink-0 animate-pulse rounded-lg" />
      </div>
    </div>
  )
}

function ExploreAppListSkeletonBody() {
  return (
    <div className="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(296px,1fr))] content-start gap-3 px-8">
      {Array.from({ length: 8 }, (_, index) => (
        <ExploreAppCardSkeleton key={index} />
      ))}
    </div>
  )
}

function BannerSkeletonBody() {
  return (
    <div className="relative flex w-full flex-col items-start gap-4 px-8 pt-6 pb-4">
      <div className="flex w-full flex-col gap-1">
        <SkeletonRectangle className="my-0 h-6 w-[240px] max-w-full animate-pulse" />
        <SkeletonRectangle className="my-0 h-4 w-72 max-w-full animate-pulse" />
      </div>
      <SkeletonRectangle className="h-[168px] w-full animate-pulse rounded-2xl" />
    </div>
  )
}

export function ExploreHomeSkeleton({
  showBanner,
}: {
  showBanner: boolean
}) {
  const { t } = useTranslation()

  return (
    <div role="status" aria-label={t('loading', { ns: 'common' })} className="contents">
      {showBanner && <BannerSkeletonBody />}
      <section className="px-8 pb-5">
        <RecommendationSectionSkeletonBody />
      </section>
      <ExploreHeaderSkeletonBody />
      <div className="relative flex flex-1 shrink-0 grow flex-col pb-6">
        <ExploreAppListSkeletonBody />
      </div>
    </div>
  )
}
