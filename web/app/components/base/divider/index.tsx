import type { CSSProperties, FC } from 'react'
import React from 'react'
import { type VariantProps, cva } from 'class-variance-authority'
import classNames from '@/utils/classnames'

const dividerVariants = cva(
  'bg-divider-regular',
  {
    variants: {
      type: {
        horizontal: 'w-full h-[0.5px] my-2',
        vertical: 'w-[1px] h-full mx-2',
      },
    },
    defaultVariants: {
      type: 'horizontal',
    },
  },
)

type DividerProps = {
  className?: string
  style?: CSSProperties
} & VariantProps<typeof dividerVariants>

const Divider: FC<DividerProps> = ({ type, className = '', style }) => {
  return (
    <div className={classNames(dividerVariants({ type }), className)} style={style}></div>
  )
}

export default Divider
