'use client'

import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'

const skeletonRows = ['primary', 'secondary', 'tertiary'] as const

export function SkillCardSkeletonCards() {
  return (
    <>
      {skeletonRows.map((row) => (
        <div
          key={row}
          className="relative h-42 rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg shadow-xs shadow-shadow-shadow-3"
        >
          <div className="flex items-center gap-3 px-4 pt-4 pb-2">
            <SkeletonRectangle className="my-0 size-10 shrink-0 rounded-[10px] opacity-20" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <SkeletonRectangle className="my-0 h-3 w-36 max-w-full rounded-md opacity-20" />
              <SkeletonRectangle className="my-0 h-2 w-24 max-w-full rounded-md opacity-12" />
            </div>
          </div>
          <div className="px-4 py-1">
            <SkeletonRectangle className="my-0 h-2 w-full rounded-md opacity-12" />
            <SkeletonRectangle className="my-0 mt-2 h-2 w-3/4 rounded-md opacity-10" />
          </div>
          <div className="flex gap-1 px-4 pt-2">
            <SkeletonRectangle className="my-0 h-5 w-14 rounded-md opacity-12" />
            <SkeletonRectangle className="my-0 h-5 w-20 rounded-md opacity-10" />
          </div>
        </div>
      ))}
    </>
  )
}

export function SkillCardSkeleton() {
  const { t } = useTranslation(['common'])

  return (
    <>
      <span role="status" className="sr-only col-span-full">
        {t(($) => $.loading)}
      </span>
      <SkillCardSkeletonCards />
    </>
  )
}
