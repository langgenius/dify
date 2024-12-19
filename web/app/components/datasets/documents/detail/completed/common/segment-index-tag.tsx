import React, { type FC, useMemo } from 'react'
import { Chunk } from '@/app/components/base/icons/src/public/knowledge'
import cn from '@/utils/classnames'

type ISegmentIndexTagProps = {
  positionId?: string | number
  label?: string
  className?: string
  labelPrefix?: string
}

export const SegmentIndexTag: FC<ISegmentIndexTagProps> = ({
  positionId,
  label,
  className,
  labelPrefix = 'Chunk',
}) => {
  const localPositionId = useMemo(() => {
    const positionIdStr = String(positionId)
    if (positionIdStr.length >= 2)
      return `${labelPrefix}-${positionId}`
    return `${labelPrefix}-${positionIdStr.padStart(2, '0')}`
  }, [positionId, labelPrefix])
  return (
    <div className={cn('flex items-center', className)}>
      <Chunk className='w-3 h-3 p-[1px] text-text-tertiary mr-0.5' />
      <div className='text-text-tertiary system-xs-medium'>
        {label || localPositionId}
      </div>
    </div>
  )
}

SegmentIndexTag.displayName = 'SegmentIndexTag'

export default React.memo(SegmentIndexTag)
