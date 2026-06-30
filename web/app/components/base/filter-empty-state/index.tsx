import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type FilterEmptyStateProps = {
  title: ReactNode
  className?: string
}

const CARD_COUNT = 16

const FilterEmptyState = ({
  title,
  className,
}: FilterEmptyStateProps) => {
  return (
    <div className={cn('pointer-events-none absolute inset-0 z-20 grid grid-cols-4 grid-rows-4 gap-3 px-8 pt-2', className)}>
      {Array.from({ length: CARD_COUNT }).map((_, index) => (
        <div key={index} className="rounded-xl bg-background-default-lighter opacity-75" />
      ))}
      <div className="absolute inset-0 bg-linear-to-b from-background-body/0 to-background-body" />
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden p-2">
        <div className="flex flex-col items-center justify-center gap-3">
          <div className="flex size-14 items-center justify-center rounded-lg">
            <div className="flex size-full min-w-px items-center justify-center overflow-hidden rounded-xl border border-dashed border-divider-regular bg-components-card-bg p-1">
              <span aria-hidden className="i-ri-robot-2-line size-6 text-text-tertiary" />
            </div>
          </div>
          <p className="system-sm-regular whitespace-nowrap text-text-tertiary">
            {title}
          </p>
        </div>
      </div>
    </div>
  )
}

export default FilterEmptyState
