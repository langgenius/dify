import { cn } from '@langgenius/dify-ui/cn'
import { SkeletonContainer, SkeletonPoint, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'

type ToolCardSkeletonGridProps = {
  className?: string
  count?: number
  variant?: ToolCardSkeletonVariant
}

type ToolCardSkeletonVariant = 'default' | 'integrations-default' | 'integrations-labeled' | 'mcp'

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

const IntegrationsDefaultToolCardSkeleton = () => (
  <div className="group/tool-provider relative flex min-w-[min(100%,496px)] flex-1 cursor-pointer flex-col overflow-hidden rounded-xl bg-background-section-burn p-[3px]">
    <div className="relative flex w-full items-center gap-3 overflow-hidden rounded-[10px] border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-3">
      <SkeletonRectangle className="size-10 shrink-0 animate-pulse rounded-lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-px">
        <SkeletonRectangle className="h-4 w-2/5 animate-pulse" />
        <SkeletonRectangle className="h-3 w-3/5 animate-pulse" />
      </div>
    </div>
    <div className="flex h-[26px] w-full items-center gap-2 px-3 pt-1.5 pb-1">
      <SkeletonRectangle className="h-3 w-20 animate-pulse" />
      <SkeletonPoint />
      <SkeletonRectangle className="h-3 w-24 animate-pulse" />
    </div>
  </div>
)

const IntegrationsLabeledToolCardSkeleton = () => (
  <div className="relative flex min-w-0 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg pb-3 shadow-xs">
    <div className="flex w-full shrink-0 items-center gap-3 px-4 pt-4 pb-2">
      <SkeletonRectangle className="size-10 shrink-0 animate-pulse rounded-lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-px">
        <SkeletonRectangle className="h-4 w-2/5 animate-pulse" />
        <SkeletonRectangle className="h-3 w-1/3 animate-pulse" />
      </div>
    </div>
    <div className="w-full px-4 pt-1 pb-2">
      <SkeletonContainer className="min-h-8 gap-0">
        <SkeletonRectangle className="h-3 w-full animate-pulse" />
        <SkeletonRectangle className="h-3 w-4/5 animate-pulse" />
      </SkeletonContainer>
    </div>
    <div className="flex h-6 w-full shrink-0 items-center gap-2 px-4 py-1">
      <SkeletonRectangle className="h-3 w-16 animate-pulse" />
      <SkeletonRectangle className="h-3 w-20 animate-pulse" />
    </div>
  </div>
)

const MCPCardSkeleton = () => (
  <div className="relative flex flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs">
    <div className="flex shrink-0 items-center gap-3 rounded-t-xl p-4">
      <SkeletonRectangle className="size-10 shrink-0 animate-pulse rounded-lg" />
      <div className="min-w-0 grow">
        <SkeletonRectangle className="mb-2 h-4 w-2/5 animate-pulse" />
        <SkeletonRectangle className="h-3 w-3/5 animate-pulse" />
      </div>
    </div>
    <div className="flex items-center gap-1 rounded-b-xl pt-1.5 pr-2.5 pb-2.5 pl-4">
      <div className="flex w-0 grow items-center gap-2">
        <SkeletonRectangle className="h-3 w-16 animate-pulse" />
        <SkeletonPoint />
        <SkeletonRectangle className="h-3 w-24 animate-pulse" />
      </div>
      <SkeletonRectangle className="h-5 w-20 shrink-0 animate-pulse rounded-md" />
    </div>
  </div>
)

const skeletonByVariant = {
  'default': ToolCardSkeleton,
  'integrations-default': IntegrationsDefaultToolCardSkeleton,
  'integrations-labeled': IntegrationsLabeledToolCardSkeleton,
  'mcp': MCPCardSkeleton,
}

const ToolCardSkeletonGrid = ({
  className,
  count = 6,
  variant = 'default',
}: ToolCardSkeletonGridProps) => {
  const Skeleton = skeletonByVariant[variant]

  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={cn(className)}>
          <Skeleton />
        </div>
      ))}
    </>
  )
}

export default ToolCardSkeletonGrid
