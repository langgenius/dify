import type { FC } from 'react'
import * as React from 'react'
import { useMemo } from 'react'
import { Chunk } from '@/app/components/base/icons/src/vender/knowledge'
import { cn } from '@/utils/classnames'

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
      <Chunk className={cn('mr-0.5 h-3 w-3 p-[1px] text-text-tertiary', iconClassName)} />
      <div className={cn('system-xs-medium text-text-tertiary', labelClassName)}>
        {label || localPositionId}
      </div>
    </div>
  )
}

SegmentIndexTag.displayName = 'SegmentIndexTag'

export default React.memo(SegmentIndexTag)
