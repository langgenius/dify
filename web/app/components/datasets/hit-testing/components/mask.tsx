import * as React from 'react'
import { cn } from '@/utils/classnames'

type MaskProps = {
  className?: string
}

export const Mask = ({
  className,
}: MaskProps) => {
  return (
    <div className={cn(
      'h-12 bg-gradient-to-b from-components-panel-bg-transparent to-components-panel-bg',
      className,
    )}
    />
  )
}

export default React.memo(Mask)
