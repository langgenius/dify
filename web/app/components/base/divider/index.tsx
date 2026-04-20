import type { VariantProps } from 'class-variance-authority'
import type { CSSProperties, FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { cva } from 'class-variance-authority'
import * as React from 'react'

const dividerVariants = cva('', {
  variants: {
    type: {
      horizontal: 'my-2 h-[0.5px] w-full',
      vertical: 'mx-2 h-full w-px',
    },
    bgStyle: {
      gradient: 'bg-linear-to-r from-divider-regular to-background-gradient-mask-transparent',
      solid: 'bg-divider-regular',
    },
  },
  defaultVariants: {
    type: 'horizontal',
    bgStyle: 'solid',
  },
})

type DividerProps = {
  className?: string
  style?: CSSProperties
} & VariantProps<typeof dividerVariants>

const Divider: FC<DividerProps> = ({ type, bgStyle, className = '', style }) => {
  return (
    <div className={cn(dividerVariants({ type, bgStyle }), 'shrink-0', className)} style={style} data-testid="divider"></div>
  )
}

export default Divider
