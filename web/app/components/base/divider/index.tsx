import type { VariantProps } from 'class-variance-authority'
import type { CSSProperties, FC } from 'react'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '@/utils/classnames'

const dividerVariants = cva('', {
  variants: {
    type: {
      horizontal: 'my-2 h-[0.5px] w-full',
      vertical: 'mx-2 h-full w-[1px]',
    },
    bgStyle: {
      gradient: 'bg-gradient-to-r from-divider-regular to-background-gradient-mask-transparent',
      solid: 'bg-divider-regular',
    },
  },
  defaultVariants: {
    type: 'horizontal',
    bgStyle: 'solid',
  },
})

export type DividerProps = {
  className?: string
  style?: CSSProperties
} & VariantProps<typeof dividerVariants>

const Divider: FC<DividerProps> = ({ type, bgStyle, className = '', style }) => {
  return (
    <div className={cn(dividerVariants({ type, bgStyle }), 'shrink-0', className)} style={style} data-testid="divider"></div>
  )
}

export default Divider
