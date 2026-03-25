import type { ReactNode } from 'react'
import {
  memo,
  useState,
} from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { cn } from '@/utils/classnames'

export type FieldTitleProps = {
  title?: string
  operation?: ReactNode
  subTitle?: string | ReactNode
  tooltip?: string
  warningDot?: boolean
  showArrow?: boolean
  disabled?: boolean
  collapsed?: boolean
  onCollapse?: (collapsed: boolean) => void
}
export const FieldTitle = memo(({
  title,
  operation,
  subTitle,
  tooltip,
  warningDot,
  showArrow,
  disabled,
  collapsed,
  onCollapse,
}: FieldTitleProps) => {
  const [collapsedLocal, setCollapsedLocal] = useState(true)
  const collapsedMerged = collapsed !== undefined ? collapsed : collapsedLocal

  return (
    <div className={cn('mb-0.5', !!subTitle && 'mb-1')}>
      <div
        className="group/collapse flex items-center justify-between py-1"
        onClick={() => {
          if (!disabled) {
            setCollapsedLocal(!collapsedMerged)
            onCollapse?.(!collapsedMerged)
          }
        }}
      >
        <div className="flex items-center text-text-secondary system-sm-semibold-uppercase">
          <span className="relative">
            {warningDot && (
              <span className="absolute -left-[9px] top-1/2 size-[5px] -translate-y-1/2 rounded-full bg-text-warning-secondary" />
            )}
            {title}
          </span>
          {
            showArrow && (
              <span
                aria-hidden
                className={cn(
                  'i-custom-vender-solid-general-arrow-down-round-fill h-4 w-4 cursor-pointer text-text-quaternary group-hover/collapse:text-text-secondary',
                  collapsedMerged && 'rotate-[270deg]',
                )}
              />
            )
          }
          {
            tooltip && (
              <Tooltip>
                <TooltipTrigger
                  delay={0}
                  render={(
                    <span className="ml-1 flex h-4 w-4 shrink-0 items-center justify-center">
                      <span aria-hidden className="i-ri-question-line h-3.5 w-3.5 text-text-quaternary hover:text-text-tertiary" />
                    </span>
                  )}
                />
                <TooltipContent>
                  {tooltip}
                </TooltipContent>
              </Tooltip>
            )
          }
        </div>
        {operation}
      </div>
      {
        subTitle
      }
    </div>
  )
})
