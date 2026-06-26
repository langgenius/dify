import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'

export const createResourceCardActionClassName = 'group flex w-full cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-left system-sm-medium text-text-tertiary outline-hidden transition-colors hover:bg-background-default-dodge hover:text-text-secondary hover:shadow-xs hover:shadow-shadow-shadow-3 focus-visible:bg-background-default-dodge focus-visible:text-text-secondary focus-visible:shadow-xs focus-visible:shadow-shadow-shadow-3'
export const createResourceCardActionIconClassName = 'size-4 shrink-0 text-text-tertiary group-hover:text-text-secondary group-focus-visible:text-text-secondary'

type CreateResourceCardProps = {
  children: React.ReactNode
  footer: React.ReactNode
  className?: string
  isLoading?: boolean
  ref?: React.RefObject<HTMLDivElement | null>
}

const CreateResourceCard = ({
  children,
  footer,
  className,
  isLoading = false,
  ref,
}: CreateResourceCardProps) => {
  return (
    <div
      ref={ref}
      className={cn(
        'relative col-span-1 inline-flex h-41.5 flex-col overflow-hidden rounded-xl bg-background-default-dimmed transition-opacity',
        isLoading && 'pointer-events-none opacity-50',
        className,
      )}
    >
      <div className="flex min-h-0 grow flex-col justify-center p-2">
        <div className="flex w-full flex-col gap-0.5">
          {children}
        </div>
      </div>
      <div className="flex shrink-0 items-center border-t-[0.5px] border-divider-subtle p-2">
        {footer}
      </div>
    </div>
  )
}

export default React.memo(CreateResourceCard)
