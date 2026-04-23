import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'

type MaskProps = {
  className?: string
}

const Mask = ({
  className,
}: MaskProps) => {
  return (
    <div className={cn(
      'h-12 bg-linear-to-b from-components-panel-bg-transparent to-components-panel-bg',
      className,
    )}
    />
  )
}

export default React.memo(Mask)
