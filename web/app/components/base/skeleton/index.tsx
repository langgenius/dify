import type { ComponentProps, FC } from 'react'
import classNames from '@/utils/classnames'

type SkeletonProps = ComponentProps<'div'>

export const SkeletonContanier: FC<SkeletonProps> = (props) => {
  const { className, children, ...rest } = props
  return (
    <div className={classNames('flex flex-col gap-1', className)} {...rest}>
      {children}
    </div>
  )
}

export const SkeletonRow: FC<SkeletonProps> = (props) => {
  const { className, children, ...rest } = props
  return (
    <div className={classNames('flex items-center gap-2', className)} {...rest}>
      {children}
    </div>
  )
}

export const SkeletonRectangle: FC<SkeletonProps> = (props) => {
  const { className, children, ...rest } = props
  return (
    <div className={classNames('h-2 rounded-sm opacity-20 bg-text-tertiary my-1', className)} {...rest}>
      {children}
    </div>
  )
}

export const SkeletonPoint: FC = () =>
  <div className='text-text-quaternary text-xs font-medium'>·</div>

/** Usage
 * <SkeletonContanier>
 *  <SkeletonRow>
 *    <SkeletonRectangle className="w-96" />
 *    <SkeletonPoint />
 *    <SkeletonRectangle className="w-96" />
 *  </SkeletonRow>
 *  <SkeletonRow>
 *    <SkeletonRectangle className="w-96" />
 *  </SkeletonRow>
 * <SkeletonRow>
 */
