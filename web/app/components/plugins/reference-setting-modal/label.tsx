'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import * as React from 'react'

type Props = Readonly<{
  label: string
  description?: string
  tooltip?: string
}>

const Label: FC<Props> = ({ label, description, tooltip }) => {
  const tooltipIcon = (
    <span
      aria-label={tooltip}
      className="ml-1 flex size-4 shrink-0 cursor-pointer items-center justify-center"
    >
      <span aria-hidden className="i-ri-question-line size-3.5 text-text-quaternary" />
    </span>
  )

  return (
    <div>
      <div className={cn('flex h-6 items-center', description && 'h-4')}>
        <span className="system-sm-semibold text-text-secondary">{label}</span>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger render={tooltipIcon} />
            <TooltipContent>{tooltip}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {description && <div className="mt-1 body-xs-regular text-text-tertiary">{description}</div>}
    </div>
  )
}
export default React.memo(Label)
