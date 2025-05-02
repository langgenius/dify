import type { FC } from 'react'
import React, { useMemo } from 'react'
import cn from '@/utils/classnames'

type Props = {
  className?: string
  text: string
  descriptionLineRows: number
}

const Description: FC<Props> = ({
  className,
  text,
  descriptionLineRows,
}) => {
  const lineClassName = useMemo(() => {
    if (descriptionLineRows === 1)
      return 'h-4 truncate'
    else if (descriptionLineRows === 2)
      return 'h-8 line-clamp-2'
    else
      return 'h-12 line-clamp-3'
  }, [descriptionLineRows])
  return (
    <div className={cn('text-text-tertiary system-xs-regular', lineClassName, className)}>
      {text}
    </div>
  )
}

export default Description
