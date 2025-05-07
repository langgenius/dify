import type { ReactNode } from 'react'
import { memo } from 'react'
import Tooltip from '@/app/components/base/tooltip'
import cn from '@/utils/classnames'

export type FieldTitleProps = {
  title: string
  operation?: ReactNode
  subTitle?: string | ReactNode
  tooltip?: string
}
export const FieldTitle = memo(({
  title,
  operation,
  subTitle,
  tooltip,
}: FieldTitleProps) => {
  return (
    <div className={cn('mb-0.5', !!subTitle && 'mb-1')}>
      <div className='flex items-center justify-between py-1'>
        <div className='system-sm-semibold-uppercase flex items-center text-text-secondary'>
          {title}
          {
            tooltip && (
              <Tooltip
                popupContent={tooltip}
                triggerClassName='w-4 h-4 ml-1'
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
