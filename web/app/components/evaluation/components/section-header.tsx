'use client'

import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { cn } from '@/utils/classnames'

type SectionHeaderProps = {
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
  titleClassName?: string
  descriptionClassName?: string
}

type InlineSectionHeaderProps = {
  title: string
  tooltip?: ReactNode
  action?: ReactNode
  className?: string
}

const SectionHeader = ({
  title,
  description,
  action,
  className,
  titleClassName,
  descriptionClassName,
}: SectionHeaderProps) => {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div>
        <div className={cn('text-text-primary system-md-semibold', titleClassName)}>{title}</div>
        {description && <div className={cn('mt-1 text-text-tertiary system-sm-regular', descriptionClassName)}>{description}</div>}
      </div>
      {action}
    </div>
  )
}

export const InlineSectionHeader = ({
  title,
  tooltip,
  action,
  className,
}: InlineSectionHeaderProps) => {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <div className="flex min-h-6 items-center gap-1">
        <div className="text-text-primary system-md-semibold">{title}</div>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger
              render={(
                <button
                  type="button"
                  className="flex h-4 w-4 items-center justify-center text-text-quaternary transition-colors hover:text-text-tertiary"
                  aria-label={title}
                >
                  <span aria-hidden="true" className="i-ri-information-line h-3.5 w-3.5" />
                </button>
              )}
            />
            <TooltipContent>
              {tooltip}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      {action}
    </div>
  )
}

export default SectionHeader
