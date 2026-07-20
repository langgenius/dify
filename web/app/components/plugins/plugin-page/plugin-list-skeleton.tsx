'use client'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { SkeletonContainer, SkeletonPoint, SkeletonRectangle } from '@/app/components/base/skeleton'

const PluginCardSkeleton = () => (
  <div
    data-testid="plugin-card-skeleton"
    className="relative overflow-hidden rounded-xl border-[1.5px] border-background-section-burn bg-background-section-burn p-1"
  >
    <div className="relative rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-4 pb-3 shadow-xs">
      <div className="flex">
        <SkeletonRectangle className="size-10 shrink-0 animate-pulse rounded-xl" />
        <div className="ml-3 w-0 grow">
          <div className="flex h-5 items-center">
            <SkeletonRectangle className="h-4 w-2/5 animate-pulse" />
          </div>
          <SkeletonContainer className="mt-0.5 h-4 gap-0">
            <SkeletonRectangle className="h-3 w-4/5 animate-pulse" />
          </SkeletonContainer>
        </div>
      </div>
    </div>
    <div className="mt-1.5 mb-1 flex h-4 items-center gap-x-2 px-4">
      <SkeletonRectangle className="h-3 w-20 animate-pulse" />
      <SkeletonPoint />
      <SkeletonRectangle className="h-3 w-24 animate-pulse" />
    </div>
  </div>
)

type PluginListSkeletonProps = {
  contentFrameClassName: string
}

const PluginListSkeleton = ({ contentFrameClassName }: PluginListSkeletonProps) => {
  const { t } = useTranslation()

  return (
    <div
      role="status"
      aria-label={t(($) => $.loading, { ns: 'common' })}
      className={cn('min-h-0 grow self-stretch bg-components-panel-bg', contentFrameClassName)}
    >
      <div className="grid grid-cols-1 gap-3 pb-3 lg:grid-cols-2">
        {Array.from({ length: 6 }, (_, index) => (
          <PluginCardSkeleton key={index} />
        ))}
      </div>
    </div>
  )
}

export default PluginListSkeleton
