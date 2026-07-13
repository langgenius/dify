import { SkeletonContainer, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'

type DatasetCardSkeletonProps = {
  label: string
  count?: number
}

const DatasetCardSkeleton = ({ label, count = 6 }: DatasetCardSkeletonProps) => (
  <div className="contents" role="status" aria-label={label} aria-live="polite">
    {Array.from({ length: count }, (_, index) => (
      <div
        key={index}
        className="h-47.5 rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg p-4 shadow-xs shadow-shadow-shadow-3"
      >
        <SkeletonContainer className="h-full">
          <SkeletonRow>
            <SkeletonRectangle className="size-10 animate-pulse rounded-lg" />
            <div className="flex flex-1 flex-col gap-1">
              <SkeletonRectangle className="h-4 w-2/3 animate-pulse" />
              <SkeletonRectangle className="h-3 w-1/3 animate-pulse" />
            </div>
          </SkeletonRow>
          <div className="mt-4 flex flex-col gap-2">
            <SkeletonRectangle className="h-3 w-full animate-pulse" />
            <SkeletonRectangle className="h-3 w-4/5 animate-pulse" />
          </div>
          <div className="mt-auto flex items-center justify-between">
            <SkeletonRectangle className="h-3 w-24 animate-pulse" />
            <SkeletonRectangle className="h-3 w-16 animate-pulse" />
          </div>
        </SkeletonContainer>
      </div>
    ))}
  </div>
)

export default DatasetCardSkeleton
