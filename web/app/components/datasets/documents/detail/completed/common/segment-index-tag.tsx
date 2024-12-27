import React, { type FC, useMemo } from 'react'
import { Chunk } from '@/app/components/base/icons/src/public/knowledge'
import cn from '@/utils/classnames'

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
    if (positionIdStr.length >= 2)
      return `${labelPrefix}-${positionId}`
    return `${labelPrefix}-${positionIdStr.padStart(2, '0')}`
  }, [positionId, labelPrefix])
  return (
    <div className={cn('flex items-center', className)}>
      <Chunk className={cn('w-3 h-3 p-[1px] text-text-tertiary mr-0.5', iconClassName)} />
      <div className={cn('text-text-tertiary system-xs-medium', labelClassName)}>
        {label || localPositionId}
      </div>
    </div>
  )
}

SegmentIndexTag.displayName = 'SegmentIndexTag'

export default React.memo(SegmentIndexTag)
