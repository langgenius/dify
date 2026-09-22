import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useMemo } from 'react'

type ISegmentIndexTagProps = {
  positionId?: string | number
  label?: string
  className?: string
  labelPrefix?: string
  iconClassName?: string
  labelClassName?: string
}

export const SegmentIndexTag: FC<ISegmentIndexTagProps> = ({
  positionId,
  label,
  className,
  labelPrefix = 'Chunk',
  iconClassName,
  labelClassName,
}) => {
  const localPositionId = useMemo(() => {
    const positionIdStr = String(positionId)
    if (positionIdStr.length >= 2) return `${labelPrefix}-${positionId}`
    return `${labelPrefix}-${positionIdStr.padStart(2, '0')}`
  }, [positionId, labelPrefix])
  return (
    <div className={cn('flex items-center', className)}>
      <span
        aria-hidden
        className={cn(
          'mr-0.5 i-custom-vender-knowledge-chunk size-3 [mask-clip:content-box] [mask-origin:content-box] p-px text-text-tertiary',
          iconClassName,
        )}
      />
      <div className={cn('system-xs-medium text-text-tertiary', labelClassName)}>
        {label || localPositionId}
      </div>
    </div>
  )
}

SegmentIndexTag.displayName = 'SegmentIndexTag'

export default React.memo(SegmentIndexTag)
