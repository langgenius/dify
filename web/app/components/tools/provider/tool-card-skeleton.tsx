import { cn } from '@langgenius/dify-ui/cn'
import { SkeletonContainer, SkeletonPoint, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'

type ToolCardSkeletonGridProps = {
  className?: string
  count?: number
}

const ToolCardSkeleton = () => (
  <div className="relative overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs">
    <div className="p-4 pb-3">
      <div className="flex">
        <SkeletonRectangle className="my-0 size-10 shrink-0 animate-pulse rounded-md" />
        <div className="ml-3 w-0 grow">
          <div className="flex h-5 items-center">
            <SkeletonRectangle className="h-4 w-2/3 animate-pulse" />
          </div>
          <SkeletonRow className="mt-0.5 h-4">
            <SkeletonRectangle className="w-[41px] animate-pulse" />
            <SkeletonPoint />
            <SkeletonRectangle className="w-1/3 animate-pulse" />
          </SkeletonRow>
        </div>
      </div>
      <SkeletonContainer className="mt-3 h-8 gap-0">
        <SkeletonRectangle className="h-3 w-full animate-pulse" />
        <SkeletonRectangle className="h-3 w-4/5 animate-pulse" />
      </SkeletonContainer>
      <div className="flex h-5 items-center gap-2">
        <SkeletonRectangle className="h-3 w-12 animate-pulse" />
        <SkeletonRectangle className="h-3 w-20 animate-pulse" />
      </div>
    </div>
  </div>
)

const ToolCardSkeletonGrid = ({
  className,
  count = 6,
}: ToolCardSkeletonGridProps) => (
  <>
    {Array.from({ length: count }, (_, index) => (
      <div key={index} className={cn(className)}>
        <ToolCardSkeleton />
      </div>
    ))}
  </>
)

export default ToolCardSkeletonGrid
