'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'

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
        <div className={cn('system-xl-semibold text-text-primary', titleClassName)}>{title}</div>
        {description && <div className={cn('mt-1 system-sm-regular text-text-tertiary', descriptionClassName)}>{description}</div>}
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
        <div className="system-md-semibold text-text-primary">{title}</div>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger
              render={(
                <button
                  type="button"
                  className="flex h-4 w-4 items-center justify-center text-text-quaternary transition-colors hover:text-text-tertiary"
                  aria-label={title}
                >
                  <span aria-hidden="true" className="i-ri-question-line h-3.5 w-3.5" />
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
