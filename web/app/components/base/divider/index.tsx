import type { VariantProps } from 'class-variance-authority'
import type { CSSProperties, FC } from 'react'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '@/utils/classnames'

const dividerVariants = cva('', {
  variants: {
    type: {
      horizontal: 'w-full h-[0.5px] my-2 ',
      vertical: 'w-[1px] h-full mx-2',
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
    <div className={cn(dividerVariants({ type, bgStyle }), 'shrink-0', className)} style={style}></div>
  )
}

export default Divider
