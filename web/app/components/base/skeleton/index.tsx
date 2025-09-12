import type { ComponentProps, FC } from 'react'
import classNames from '@/utils/classnames'

type SkeletonProps = ComponentProps<'div'>

export const SkeletonContainer: FC<SkeletonProps> = (props) => {
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
    <div className={classNames('my-1 h-2 rounded-sm bg-text-quaternary opacity-20', className)} {...rest}>
      {children}
    </div>
  )
}

export const SkeletonPoint: FC<SkeletonProps> = (props) => {
  const { className, ...rest } = props
  return (
    <div className={classNames('text-xs font-medium text-text-quaternary', className)} {...rest}>·</div>
  )
}
/** Usage
 * <SkeletonContainer>
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
