import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { MembersHeaderCard } from './members-header-card'

const rowKeys = ['first', 'second', 'third']

export const MembersPageSkeleton = () => (
  <div aria-hidden className="flex flex-col">
    <MembersHeaderCard>
      <div className="flex min-w-0 grow basis-48 items-center gap-3">
        <SkeletonRectangle className="my-0 size-12 shrink-0 rounded-xl" />
        <div className="flex grow flex-col gap-2">
          <SkeletonRectangle className="my-0 h-3 w-48" />
          <SkeletonRectangle className="my-0 w-20" />
        </div>
      </div>
      <SkeletonRectangle className="my-0 h-8 w-20 rounded-lg" />
    </MembersHeaderCard>
    <div className="grid grid-cols-[--spacing(65)_--spacing(30)_1fr] items-center border-b border-divider-regular py-2.5">
      <SkeletonRectangle className="mx-3 my-0 w-12" />
      <SkeletonRectangle className="my-0 w-16" />
      <SkeletonRectangle className="mx-3 my-0 w-10" />
    </div>
    {rowKeys.map((key) => (
      <div
        key={key}
        className="grid grid-cols-[--spacing(65)_--spacing(30)_1fr] items-center border-b border-divider-subtle py-2"
      >
        <div className="flex items-center gap-2 px-3">
          <SkeletonRectangle className="my-0 size-6 shrink-0 rounded-full" />
          <div className="flex grow flex-col gap-1.5 py-1">
            <SkeletonRectangle className="my-0 w-32" />
            <SkeletonRectangle className="my-0 w-40" />
          </div>
        </div>
        <SkeletonRectangle className="my-0 w-14" />
        <SkeletonRectangle className="mx-3 my-0 h-5 w-14 rounded-md" />
      </div>
    ))}
  </div>
)
