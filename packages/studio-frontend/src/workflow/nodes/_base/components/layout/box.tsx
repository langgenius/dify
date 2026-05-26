import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'

export type BoxProps = {
  className?: string
  children?: ReactNode
  withBorderBottom?: boolean
}
export const Box = memo(({
  className,
  children,
  withBorderBottom,
}: BoxProps) => {
  return (
    <div
      className={cn(
        'py-2',
        withBorderBottom && 'border-b border-divider-subtle',
        className,
      )}
    >
      {children}
    </div>
  )
})
