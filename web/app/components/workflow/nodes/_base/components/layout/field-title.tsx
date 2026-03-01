import type { ReactNode } from 'react'
import {
  memo,
  useState,
} from 'react'
import { ArrowDownRoundFill } from '@/app/components/base/icons/src/vender/solid/general'
import Tooltip from '@/app/components/base/tooltip'
import { cn } from '@/utils/classnames'

export type FieldTitleProps = {
  title?: string
  operation?: ReactNode
  subTitle?: string | ReactNode
  tooltip?: string
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
        <div className="system-sm-semibold-uppercase flex items-center text-text-secondary">
          {title}
          {
            showArrow && (
              <ArrowDownRoundFill
                className={cn(
                  'h-4 w-4 cursor-pointer text-text-quaternary group-hover/collapse:text-text-secondary',
                  collapsedMerged && 'rotate-[270deg]',
                )}
              />
            )
          }
          {
            tooltip && (
              <Tooltip
                popupContent={tooltip}
                triggerClassName="w-4 h-4 ml-1"
              />
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
