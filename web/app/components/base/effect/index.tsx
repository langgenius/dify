import * as React from 'react'
import { cn } from '@/utils/classnames'

type EffectProps = {
  className?: string
}

const Effect = ({
  className,
}: EffectProps) => {
  return (
    <div
      className={cn('absolute size-[112px] rounded-full bg-util-colors-blue-brand-blue-brand-500 blur-[80px]', className)}
    />
  )
}

export default React.memo(Effect)
