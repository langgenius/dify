import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { MAIN_NAV_APP_CARD_GRID_CLASS_NAME } from '@/app/components/main-nav/app-card-grid'

const skeletonCardIds = Array.from(
  { length: 6 },
  (_, index) => `agent-roster-skeleton-card-${index}`,
)

export function AgentRosterSkeleton({ className }: { className?: string }) {
  const { t } = useTranslation(['common'])

  return (
    <div className={cn(MAIN_NAV_APP_CARD_GRID_CLASS_NAME, 'gap-2.5', className)}>
      <span role="status" className="sr-only col-span-full">
        {t(($) => $.loading)}
      </span>
      {skeletonCardIds.map((id) => (
        <div
          key={id}
          className="relative h-36.5 rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg shadow-xs shadow-shadow-shadow-3"
        >
          <div className="flex items-center gap-3 ps-3.5 pe-4 pt-3.5 pb-2">
            <SkeletonRectangle className="my-0 size-12 shrink-0 rounded-full opacity-20" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-1">
              <SkeletonRectangle className="my-0 h-3 w-36 max-w-full rounded-md opacity-20" />
              <SkeletonRectangle className="my-0 h-2 w-20 max-w-full rounded-md opacity-12" />
            </div>
          </div>
          <div className="px-4 py-1">
            <div className="flex min-h-8 flex-col gap-2 py-0.5">
              <SkeletonRectangle className="my-0 h-2 w-full rounded-md opacity-12" />
              <SkeletonRectangle className="my-0 h-2 w-3/4 rounded-md opacity-10" />
            </div>
          </div>
          <div className="flex items-center ps-4 pe-3 pt-2 pb-3">
            <SkeletonRectangle className="my-0 h-3 w-6 rounded-md opacity-12" />
            <SkeletonRectangle className="my-0 ms-2.5 h-3 w-28 rounded-md opacity-10" />
          </div>
        </div>
      ))}
    </div>
  )
}
