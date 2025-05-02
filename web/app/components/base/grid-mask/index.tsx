import type { FC } from 'react'
import Style from './style.module.css'
import classNames from '@/utils/classnames'

type GridMaskProps = {
  children: React.ReactNode
  wrapperClassName?: string
  canvasClassName?: string
  gradientClassName?: string
}
const GridMask: FC<GridMaskProps> = ({
  children,
  wrapperClassName,
  canvasClassName,
  gradientClassName,
}) => {
  return (
    <div className={classNames('relative bg-saas-background', wrapperClassName)}>
      <div className={classNames('absolute inset-0 w-full h-full z-0 opacity-70', canvasClassName, Style.gridBg)} />
      <div className={classNames('absolute w-full h-full z-[1] bg-grid-mask-background rounded-lg', gradientClassName)} />
      <div className='relative z-[2]'>{children}</div>
    </div>
  )
}

export default GridMask
