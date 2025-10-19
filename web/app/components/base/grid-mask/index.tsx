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
      <div className={classNames('absolute inset-0 z-0 h-full w-full opacity-70', canvasClassName, Style.gridBg)} />
      <div className={classNames('absolute z-[1] h-full w-full rounded-lg bg-grid-mask-background', gradientClassName)} />
      <div className='relative z-[2]'>{children}</div>
    </div>
  )
}

export default GridMask
