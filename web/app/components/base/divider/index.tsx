import type { CSSProperties, FC } from 'react'
import React from 'react'
import { type VariantProps, cva } from 'class-variance-authority'
import classNames from '@/utils/classnames'

const dividerVariants = cva('',
  {
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
  },
)

type DividerProps = {
  className?: string
  style?: CSSProperties
} & VariantProps<typeof dividerVariants>

const Divider: FC<DividerProps> = ({ type, bgStyle, className = '', style }) => {
  return (
    <div className={classNames(dividerVariants({ type, bgStyle }), className)} style={style}></div>
  )
}

export default Divider
